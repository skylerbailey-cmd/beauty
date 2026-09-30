'use strict';

// Paying for a shop, and stopping paying for it.
//
// Two rules run through all of this:
//
//   The session decides which company is being billed. Never a company id in
//   the request body — that would let anyone with an account cancel somebody
//   else's subscription, or point their card at another shop's bill.
//
//   Stripe is the authority, Postgres is the copy. Every write here is
//   followed by writing back what Stripe actually said, and the webhook keeps
//   that copy current afterwards. Nothing decides whether a shop may trade by
//   calling Stripe with a customer standing at the till.

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const billing = require('../lib/billing');
const { rateLimit } = require('../lib/rate-limit');
const { appDomain } = require('../lib/tenancy');

function requireSignedIn(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  next();
}

function requireBilling(req, res, next) {
  if (!billing.configured()) {
    return res.status(503).json({
      error: 'Billing is not switched on for this server yet.',
      not_configured: true,
    });
  }
  next();
}

// Where to send somebody back to after Stripe.
//
// Not a constant: signup happens on app.<domain> and the register lives on
// <shop>.<domain>, so a fixed base would land a shop coming back from the
// billing portal on the wrong host — or, with appDomain() alone, on the
// marketing site.
//
// The host is taken from the request but only used when it really is one of
// ours. A Host header is set by whoever is calling, so trusting it unchecked
// turns every success_url into an open redirect that Stripe will happily
// send a paying customer to.
function returnBase(req) {
  const domain = appDomain();
  const host = String(req.headers?.host || '').toLowerCase().split(':')[0];
  const ours = domain && (host === domain || host.endsWith(`.${domain}`));
  if (ours) return `https://${host}`;
  return domain ? `https://app.${domain}` : '';
}

// What this shop's subscription is, in the words the screen uses.
//
// `may_sell` is the one the register asks about, and it is deliberately not
// "has a subscription row": a shop that never signed up, a shop whose card
// failed a fortnight ago and a shop that cancelled last month all answer the
// same way, and the register does not need to know which.
function describe(sub) {
  const status = sub?.status || '';
  const live = pgDb.LIVE_SUB_STATUSES.has(status);
  const asleep = live && sub?.plan === 'sleep';
  return {
    configured: billing.configured(),
    status,
    plan: sub?.plan || 'full',
    asleep,
    may_sell: live && !asleep,
    comped: status === 'comped',
    trialing: status === 'trialing',
    trial_end: sub?.trial_end || null,
    current_period_end: sub?.current_period_end || null,
    cancel_at_period_end: !!sub?.cancel_at_period_end,
    canceled_at: sub?.canceled_at || null,
    has_customer: !!sub?.stripe_customer_id,
    // When a cancelled shop's books go (services/retention.js): 30 days after
    // the subscription stops — or will stop, for one cancelled but running.
    deletes_on: deletesOnFor(sub),
    monthly_cents: billing.MONTHLY_CENTS,
    sleep_cents: billing.SLEEP_CENTS,
    trial_days: billing.TRIAL_DAYS,
  };
}

function deletesOnFor(sub) {
  const { deletesOn } = require('../services/retention');
  if (sub?.status === 'canceled') {
    const stopped = sub.ended_at || sub.current_period_end || sub.canceled_at;
    return stopped ? deletesOn(stopped, sub.deletion_warned_at) : null;
  }
  if (sub?.cancel_at_period_end && sub.current_period_end) return deletesOn(sub.current_period_end);
  return null;
}

router.get('/status', requireSignedIn, async (req, res) => {
  const sub = await pgDb.getSubscription(req.session.userId);
  res.json(describe(sub));
});

// ─── Starting to pay ────────────────────────────────────────────────────────

// A Stripe customer for this company, made once and kept.
async function customerFor(userId, email, storeName) {
  const existing = await pgDb.getSubscription(userId);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await billing.stripe().customers.create({
    email: email || undefined,
    name: storeName || undefined,
    // The company id, so a customer that somehow arrives without a row here
    // can still be traced back to a shop by hand.
    metadata: { skysale_company_id: userId },
  });
  await pgDb.saveSubscription(userId, { stripe_customer_id: customer.id });
  return customer.id;
}

router.post('/checkout',
  requireSignedIn, requireBilling,
  rateLimit({ limit: 10, windowMs: 60 * 1000, name: 'checkout' }),
  async (req, res) => {
    const userId = req.session.userId;
    try {
      // Already paying is a reason to refuse; being comped is not. A shop
      // carried on the house is exactly the one that needs a way to start
      // paying — an existing shop moving onto a plan, which is otherwise a
      // dead end with no button on it.
      const sub = await pgDb.getSubscription(userId);
      if (sub?.stripe_subscription_id && ['trialing', 'active'].includes(sub.status)) {
        return res.status(400).json({ error: 'This shop is already subscribed.' });
      }

      const settings = await pgDb.getSettings(userId);
      const { getUser } = require('../db');
      const email = (getUser(userId) || {}).email || '';

      const customerId = await customerFor(userId, email, settings?.store_name);
      // A shop whose subscription has ended can come back asleep, to keep its
      // books without trading. No free trial on that: there is nothing to try.
      const asleep = req.body?.plan === 'sleep';
      const price = await billing.priceIdFor(asleep ? 'sleep' : 'full');
      const back = String(req.body?.return_to || '').startsWith('/')
        ? req.body.return_to : '/signup.html';

      const session = await billing.stripe().checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        // No hardcoded list of payment methods here on purpose. Left out,
        // Stripe offers whatever this account and this customer can actually
        // use, which is more than cards; naming them locks the rest out.
        line_items: [{ price, quantity: 1 }],
        subscription_data: {
          ...(asleep ? {} : { trial_period_days: billing.TRIAL_DAYS }),
          metadata: { skysale_company_id: userId },
        },
        // The card is taken now and charged when the trial ends, so a shop
        // that walks away during the trial is never charged and a shop that
        // stays needs to do nothing.
        payment_method_collection: 'always',
        allow_promotion_codes: true,
        // Sales tax, VAT or GST worked out from where the shop actually is.
        //
        // This collects NOTHING, and reports no error, until there is an
        // active tax registration for that jurisdiction in the Stripe
        // Dashboard — and tax that was not collected at the time cannot be
        // collected afterwards. Switching this on is half the job.
        automatic_tax: { enabled: true },
        // The customer already exists by the time we get here, so without
        // this Checkout would tax whatever address is saved against them —
        // which for a brand new customer is none at all, and tax silently
        // comes out at zero. This takes the address they type in.
        //
        // `name` is not optional decoration: asking an existing customer for
        // a tax ID is refused outright unless Checkout is also allowed to
        // write back the business name it collects. Without it the very
        // first signup fails with "Tax ID collection requires updating
        // business name on the customer".
        customer_update: { address: 'auto', name: 'auto' },
        // A shop with a tax ID gets the reverse-charge treatment it is due
        // rather than being charged as if it were a consumer.
        tax_id_collection: { enabled: true },
        client_reference_id: userId,
        integration_identifier: billing.integrationIdentifier('signup'),
        success_url: `${returnBase(req)}${back}?billing=done&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnBase(req)}${back}?billing=cancelled`,
      });

      res.json({ url: session.url });
    } catch (err) {
      // Never the raw Stripe error: it can carry request ids and key hints,
      // and this endpoint is reachable by anyone with an account.
      console.error('[billing] checkout failed:', err.message);
      res.status(500).json({ error: 'Could not start checkout. Try again in a moment.' });
    }
  });

// Coming back from Checkout. The webhook is what actually records the
// subscription — this only pulls it forward so the page does not sit on
// "pending" while the event makes its way over.
router.post('/sync', requireSignedIn, requireBilling, async (req, res) => {
  const userId = req.session.userId;
  try {
    const row = await pgDb.getSubscription(userId);
    if (!row?.stripe_customer_id) return res.json(describe(row));

    const subs = await billing.stripe().subscriptions.list({
      customer: row.stripe_customer_id, status: 'all', limit: 1,
    });
    const live = subs.data[0];
    if (live) await pgDb.saveSubscription(userId, billing.summarise(live));
    res.json(describe(await pgDb.getSubscription(userId)));
  } catch (err) {
    console.error('[billing] sync failed:', err.message);
    res.status(500).json({ error: 'Could not check the subscription.' });
  }
});

// ─── Stopping ───────────────────────────────────────────────────────────────

// Cancelling runs the shop to the end of the month it has already paid for.
// Ending it the moment the button is pressed would take days they have paid
// for and turn a cancellation into a refund request — and it would close a
// till mid-shift.
// It takes a manager's name and code: ending the subscription ends the shop's
// books 30 days later.
router.post('/cancel', requireSignedIn, requireBilling, async (req, res) => {
  const userId = req.session.userId;
  try {
    if (!(await managerOf(userId, req.body?.manager_name, req.body?.manager_pin))) {
      return res.status(403).json({ error: 'Only a manager can cancel the subscription. Enter a manager name and code.' });
    }
    const row = await pgDb.getSubscription(userId);
    if (!row?.stripe_subscription_id) {
      return res.status(400).json({ error: 'There is no subscription to cancel.' });
    }
    const updated = await billing.stripe().subscriptions.update(
      row.stripe_subscription_id, { cancel_at_period_end: true });
    await pgDb.saveSubscription(userId, billing.summarise(updated));
    res.json(describe(await pgDb.getSubscription(userId)));
  } catch (err) {
    console.error('[billing] cancel failed:', err.message);
    res.status(500).json({ error: 'Could not cancel. Try again in a moment.' });
  }
});

// Changed their mind before it lapsed.
router.post('/resume', requireSignedIn, requireBilling, async (req, res) => {
  const userId = req.session.userId;
  try {
    const row = await pgDb.getSubscription(userId);
    if (!row?.stripe_subscription_id) {
      return res.status(400).json({ error: 'There is no subscription to resume.' });
    }
    const updated = await billing.stripe().subscriptions.update(
      row.stripe_subscription_id, { cancel_at_period_end: false });
    await pgDb.saveSubscription(userId, billing.summarise(updated));
    res.json(describe(await pgDb.getSubscription(userId)));
  } catch (err) {
    console.error('[billing] resume failed:', err.message);
    res.status(500).json({ error: 'Could not resume. Try again in a moment.' });
  }
});

// ─── Sleep ──────────────────────────────────────────────────────────────────
//
// Putting a shop to sleep swaps its subscription onto the $15 price. It keeps
// everything and sells nothing until it wakes. Both directions take a
// manager's name and code: one stops the till, the other charges the card.

async function managerOf(userId, name, pin) {
  if (!pin) return null;
  const emp = await pgDb.verifyEmployeePin(String(pin), userId, name);
  if (!emp || !['manager', 'admin'].includes(emp.role)) return null;
  if (name && emp.name.trim().toLowerCase() !== String(name).trim().toLowerCase()) return null;
  return emp;
}

// The one item on the subscription, whose price is what changes. Named by id
// in the update: a price given without the item's id is added alongside the
// old one, and the shop would be billed for both.
async function currentItem(subscriptionId) {
  const sub = await billing.stripe().subscriptions.retrieve(subscriptionId);
  return { sub, item: sub.items?.data?.[0] || null };
}

router.post('/sleep', requireSignedIn, requireBilling,
  rateLimit({ limit: 10, windowMs: 60 * 1000, name: 'sleep' }),
  async (req, res) => {
    const userId = req.session.userId;
    try {
      if (!(await managerOf(userId, req.body?.manager_name, req.body?.manager_pin))) {
        return res.status(403).json({ error: 'Only a manager can put the shop to sleep. Enter a manager name and code.' });
      }
      const row = await pgDb.getSubscription(userId);
      if (!row?.stripe_subscription_id || !['trialing', 'active'].includes(row.status)) {
        return res.status(400).json({ error: 'Only a shop with a running subscription can be put to sleep.' });
      }
      const { sub, item } = await currentItem(row.stripe_subscription_id);
      if (billing.planOf(sub) === 'sleep') {
        await pgDb.saveSubscription(userId, billing.summarise(sub));
        return res.json(describe(await pgDb.getSubscription(userId)));
      }
      const updated = await billing.stripe().subscriptions.update(row.stripe_subscription_id, {
        items: [{ id: item.id, price: await billing.priceIdFor('sleep') }],
        // What is left of the month already paid at the full price comes back
        // as credit against the next bills, rather than being lost.
        proration_behavior: 'create_prorations',
        // Sleeping instead of leaving: a cancellation that was waiting to
        // happen is called off, or the shop would sleep for a fortnight and
        // then lose the subscription anyway.
        cancel_at_period_end: false,
      });
      await pgDb.saveSubscription(userId, billing.summarise(updated));
      res.json(describe(await pgDb.getSubscription(userId)));
    } catch (err) {
      console.error('[billing] sleep failed:', err.message);
      res.status(500).json({ error: 'Could not put the shop to sleep. Try again in a moment.' });
    }
  });

router.post('/wake', requireSignedIn, requireBilling,
  rateLimit({ limit: 10, windowMs: 60 * 1000, name: 'wake' }),
  async (req, res) => {
    const userId = req.session.userId;
    try {
      if (!(await managerOf(userId, req.body?.manager_name, req.body?.manager_pin))) {
        return res.status(403).json({ error: 'Only a manager can wake the shop. Enter a manager name and code.' });
      }
      const row = await pgDb.getSubscription(userId);
      if (!row?.stripe_subscription_id) {
        return res.status(400).json({ error: 'There is no subscription to wake.' });
      }
      const { sub, item } = await currentItem(row.stripe_subscription_id);
      if (billing.planOf(sub) !== 'sleep') {
        await pgDb.saveSubscription(userId, billing.summarise(sub));
        return res.json(describe(await pgDb.getSubscription(userId)));
      }
      const updated = await billing.stripe().subscriptions.update(row.stripe_subscription_id, {
        items: [{ id: item.id, price: await billing.priceIdFor('full') }],
        // The rest of this month at the full price, charged now...
        proration_behavior: 'always_invoice',
        // ...and the switch only happens if that charge goes through. A card
        // that is refused leaves the shop asleep, not selling on credit.
        payment_behavior: 'pending_if_incomplete',
      });
      await pgDb.saveSubscription(userId, billing.summarise(updated));
      if (updated.pending_update) {
        return res.status(402).json({
          ...describe(await pgDb.getSubscription(userId)),
          error: 'The card was not charged, so the shop is still asleep. Update the card and try again.',
        });
      }
      res.json(describe(await pgDb.getSubscription(userId)));
    } catch (err) {
      console.error('[billing] wake failed:', err.message);
      res.status(500).json({ error: 'Could not wake the shop. Try again in a moment.' });
    }
  });

// Stripe's own billing pages: change the card, read past invoices. Hosted by
// them, so none of it is built — or held — here.
// A manager's too: Stripe's page can change the card, and — depending on how
// the portal is set up in the Dashboard — cancel.
router.post('/portal', requireSignedIn, requireBilling, async (req, res) => {
  const userId = req.session.userId;
  try {
    if (!(await managerOf(userId, req.body?.manager_name, req.body?.manager_pin))) {
      return res.status(403).json({ error: 'Only a manager can open the billing page. Enter a manager name and code.' });
    }
    const row = await pgDb.getSubscription(userId);
    if (!row?.stripe_customer_id) {
      return res.status(400).json({ error: 'There is nothing to manage yet.' });
    }
    const back = String(req.body?.return_to || '').startsWith('/')
      ? req.body.return_to : '/pos.html';
    const session = await billing.stripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${returnBase(req)}${back}`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing] portal failed:', err.message);
    res.status(500).json({ error: 'Could not open the billing page.' });
  }
});

module.exports = router;
module.exports.describe = describe;
