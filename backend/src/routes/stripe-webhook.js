'use strict';

// What Stripe tells us, after the fact.
//
// Everything that matters about a subscription happens when nobody is
// looking: the trial ends and the first charge goes through, a card expires
// and a renewal fails, somebody cancels from Stripe's own billing page. An
// integration that only reads the page people land on after checkout knows
// about none of it, and would go on letting a shop trade months after their
// card stopped working.
//
// Two things make this safe to act on:
//
//   The signature is verified against the raw body, before anything is read
//   out of it. This endpoint is public — anyone can POST to it — and without
//   that check "your subscription is active" is a sentence any stranger can
//   say to us.
//
//   Events are resolved through Stripe's own objects, not through metadata.
//   The subscription names its customer, and the customer is what we keyed
//   this shop on. Metadata is a fallback for the case where a customer row
//   somehow arrived without ours, not the first thing we trust.

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const billing = require('../lib/billing');

// The events worth acting on. Anything else Stripe sends is acknowledged and
// ignored — returning an error for events we don't handle makes Stripe retry
// them forever and eventually disable the endpoint.
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
]);

// Which shop an event belongs to. Through the object graph first — the
// customer id is the key this server stores — and only then the metadata we
// set ourselves, for a subscription whose customer row we somehow missed.
async function companyFor(object) {
  const customerId = typeof object?.customer === 'string'
    ? object.customer : object?.customer?.id || '';
  if (customerId) {
    const row = await pgDb.companyForStripeCustomer(customerId);
    if (row) return row.user_id;
  }
  const subId = typeof object?.subscription === 'string'
    ? object.subscription : object?.subscription?.id || object?.id || '';
  if (subId) {
    const row = await pgDb.companyForStripeSubscription(subId);
    if (row) return row.user_id;
  }
  const tagged = object?.metadata?.skysale_company_id
    || object?.client_reference_id
    || object?.subscription_details?.metadata?.skysale_company_id;
  return tagged || null;
}

// Pull the subscription fresh rather than trusting the shape inside the
// event: an invoice event carries only an id, and a subscription event from
// an older API version can be missing the period fields entirely.
async function recordSubscription(userId, subscriptionId) {
  if (!userId || !subscriptionId) return;
  const sub = await billing.stripe().subscriptions.retrieve(subscriptionId);
  await pgDb.saveSubscription(userId, billing.summarise(sub));
}

// express.raw, because the signature is over the exact bytes Stripe sent. A
// parsed-and-restringified body does not match and every event is rejected.
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!billing.configured() || !secret) {
    // Nothing is set up, so nothing can be verified. Say so plainly rather
    // than accepting unverified events.
    return res.status(503).send('billing not configured');
  }

  let event;
  try {
    event = billing.stripe().webhooks.constructEvent(
      req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    // Deliberately terse, and never the exception text — an unsigned caller
    // should learn nothing from the reply.
    console.error('[stripe] rejected an unverified webhook');
    return res.status(400).send('bad signature');
  }

  if (!HANDLED.has(event.type)) return res.json({ received: true });

  try {
    const object = event.data.object;
    const userId = await companyFor(object);
    if (!userId) {
      console.warn(`[stripe] ${event.type} matched no company`);
      return res.json({ received: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const subId = typeof object.subscription === 'string'
          ? object.subscription : object.subscription?.id;
        const customerId = typeof object.customer === 'string'
          ? object.customer : object.customer?.id;
        if (customerId) await pgDb.saveSubscription(userId, { stripe_customer_id: customerId });
        await recordSubscription(userId, subId);
        break;
      }
      case 'customer.subscription.deleted':
        // Gone for good — keep the row so the account page can say what
        // happened and offer to start again, but nothing is live.
        await pgDb.saveSubscription(userId, {
          status: object.status || 'canceled',
          cancel_at_period_end: false,
          canceled_at: object.canceled_at ? new Date(object.canceled_at * 1000) : new Date(),
          ended_at: object.ended_at ? new Date(object.ended_at * 1000) : new Date(),
          current_period_end: billing.periodEnd(object),
        });
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.trial_will_end':
        await pgDb.saveSubscription(userId, billing.summarise(object));
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // The invoice says which subscription it was for; that subscription
        // is where the status actually lives.
        const subId = typeof object.subscription === 'string'
          ? object.subscription
          : object.subscription?.id
            || object.parent?.subscription_details?.subscription
            || object.lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
        await recordSubscription(userId, subId);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe] ${event.type} failed:`, err.message);
    // 500 so Stripe retries — a dropped event leaves a shop marked wrong.
    return res.status(500).send('handler failed');
  }

  res.json({ received: true });
});

module.exports = router;
module.exports.HANDLED = HANDLED;
