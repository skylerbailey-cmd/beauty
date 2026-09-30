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
    return res.status(401).json({ error: 'Sign in to continue.', useGoogle: true });
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
  return {
    configured: billing.configured(),
    status,
    may_sell: live,
    comped: status === 'comped',
    trialing: status === 'trialing',
    trial_end: sub?.trial_end || null,
    current_period_end: sub?.current_period_end || null,
    cancel_at_period_end: !!sub?.cancel_at_period_end,
    canceled_at: sub?.canceled_at || null,
    has_customer: !!sub?.stripe_customer_id,
    monthly_cents: billing.MONTHLY_CENTS,
    trial_days: billing.TRIAL_DAYS,
  };
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
      const sub = await pgDb.getSubscription(userId);
      if (sub && pgDb.LIVE_SUB_STATUSES.has(sub.status)) {
        return res.status(400).json({ error: 'This shop is already subscribed.' });
      }

      const settings = await pgDb.getSettings(userId);
      const { getUser } = require('../db');
      const email = (getUser(userId) || {}).email || '';

      const customerId = await customerFor(userId, email, settings?.store_name);
      const price = await billing.monthlyPriceId();
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
          trial_period_days: billing.TRIAL_DAYS,
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
        customer_update: { address: 'auto' },
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
router.post('/cancel', requireSignedIn, requireBilling, async (req, res) => {
  const userId = req.session.userId;
  try {
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

// Stripe's own billing pages: change the card, read past invoices. Hosted by
// them, so none of it is built — or held — here.
router.post('/portal', requireSignedIn, requireBilling, async (req, res) => {
  const userId = req.session.userId;
  try {
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
