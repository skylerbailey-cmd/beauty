'use strict';

// What a shop pays to use SkySale, and the Stripe account it is paid into.
//
// One subscription per shop. A company IS a store location here — its own
// till, own staff, own books — so an owner with two shops signs each one up
// and each one is $115 a month. There is no seat counting and no metering to
// get wrong: the only question Stripe is ever asked is whether this company
// is paid up.
//
// Card details never reach this server. Payment goes through Stripe Checkout,
// which is hosted by Stripe on their own domain, so the card is typed into
// their page and we are told the answer afterwards. That keeps this codebase
// out of PCI scope entirely, and it is why there is no card form anywhere in
// the signup flow.

const MONTHLY_CENTS = 11500;          // $115.00 per store location, per month
const TRIAL_DAYS = 14;
const PRICE_LOOKUP_KEY = 'skysale_location_monthly';
const PRODUCT_NAME = 'SkySale — store location';

// Sleep: a shop that is closed for a season, or winding down, keeps its books
// — every sale, customer, report and payroll figure stays and stays readable —
// for a fraction of the price, and takes no sales, returns or exchanges until
// it wakes. It is the same subscription on a different price, so waking is a
// switch back, not a signup, and nothing about the shop has to be set up again.
const SLEEP_CENTS = 1500;             // $15.00 per store location, per month
const SLEEP_LOOKUP_KEY = 'skysale_location_sleep_monthly';

const PLANS = {
  full: {
    lookupKey: PRICE_LOOKUP_KEY, cents: MONTHLY_CENTS, name: PRODUCT_NAME,
    description: 'One SkySale store location — register, reports, payroll and reconciliation.',
  },
  sleep: {
    lookupKey: SLEEP_LOOKUP_KEY, cents: SLEEP_CENTS, name: 'SkySale — store location, asleep',
    description: 'One SkySale store location, asleep — its records kept and readable; no new sales.',
  },
};

// Stripe's own tax code for software as a service. Never invent one of these
// or recall it from memory: a wrong code does not error, it quietly taxes
// nothing, and tax that was not collected cannot be collected afterwards.
// https://docs.stripe.com/tax/tax-codes
const SAAS_TAX_CODE = 'txcd_10103001';

// Pinned, so a change Stripe makes to their default cannot quietly change the
// shape of what comes back and break a paycheck-shaped decision.
const API_VERSION = '2026-08-26.dahlia';

let client = null;
const cachedPriceIds = {};

// The key lives in the environment, never in the repository. A restricted key
// (rk_…) with write access to Customers, Checkout Sessions, Subscriptions and
// the Billing Portal is all this needs — a full secret key can move money
// anywhere in the account and is not worth the blast radius.
function stripeKey() {
  return process.env.STRIPE_SECRET_KEY || '';
}

function configured() {
  return !!stripeKey();
}

function stripe() {
  if (!configured()) {
    const e = new Error('Billing is not set up on this server yet.');
    e.code = 'STRIPE_NOT_CONFIGURED';
    throw e;
  }
  if (!client) {
    const Stripe = require('stripe');
    client = new Stripe(stripeKey(), { apiVersion: API_VERSION });
  }
  return client;
}

// Checkout sessions are tagged so the Dashboard can tell where a signup came
// from. The random tail is Stripe's own convention for these labels.
function integrationIdentifier(kind) {
  const tail = Array.from({ length: 8 },
    () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
  return `skysale_${kind}_${tail}`;
}

// A plan's monthly price, found by its lookup key or created the first time.
//
// Looked up rather than pasted into an environment variable: a price id typed
// into config by hand is a thing that can point at the wrong amount in the
// wrong mode, and nobody notices until a shop is charged the wrong money. The
// lookup key is stable across test and live, and each mode provisions its own.
async function priceIdFor(plan) {
  const p = PLANS[plan];
  if (!p) throw new Error(`No such plan: ${plan}`);
  if (cachedPriceIds[plan]) return cachedPriceIds[plan];
  const s = stripe();

  const found = await s.prices.list({ lookup_keys: [p.lookupKey], active: true, limit: 1 });
  if (found.data.length) {
    cachedPriceIds[plan] = found.data[0].id;
    return cachedPriceIds[plan];
  }

  // One Product per plan, one Price on it. Everything shows the product name
  // on the invoice line, so the shop sees what they are paying for.
  //
  // The tax code is what tells Stripe how this is taxed, and it has to be one
  // of Stripe's own — an invented or misremembered txcd_ either fails or,
  // worse, silently taxes nothing. SAAS_TAX_CODE is their code for software
  // as a service; a shop whose advisor says otherwise changes it on the
  // Product in the Dashboard, and every later invoice follows.
  const product = await s.products.create({
    name: p.name,
    description: p.description,
    tax_code: SAAS_TAX_CODE,
  });
  const price = await s.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: p.cents,
    recurring: { interval: 'month' },
    lookup_key: p.lookupKey,
    // $115 is the price; tax is added on top rather than carved out of it.
    // This cannot be changed on a price once it exists — a different answer
    // means a new price, not an edit.
    tax_behavior: 'exclusive',
  });
  cachedPriceIds[plan] = price.id;
  return cachedPriceIds[plan];
}

const monthlyPriceId = () => priceIdFor('full');

// Which plan a subscription is on, read off its price. Anything that is not
// the sleep price is the full plan: a price changed by hand in the Dashboard
// must never quietly stop a shop from selling.
function planOf(subscription) {
  const price = subscription?.items?.data?.[0]?.price;
  return price?.lookup_key === SLEEP_LOOKUP_KEY ? 'sleep' : 'full';
}

// When this subscription's paid-up period runs out.
//
// Stripe moved these from the subscription onto its items, so both places are
// read: the old field on an account still on an older API version, the item
// on a current one. Getting this wrong would cut a shop off early or late.
function periodEnd(subscription) {
  if (!subscription) return null;
  const item = subscription.items?.data?.[0];
  const secs = subscription.current_period_end || item?.current_period_end || null;
  return secs ? new Date(secs * 1000) : null;
}

function trialEnd(subscription) {
  return subscription?.trial_end ? new Date(subscription.trial_end * 1000) : null;
}

// Everything the rest of the app stores about a subscription, out of whatever
// shape Stripe handed back.
function summarise(subscription) {
  if (!subscription) return null;
  return {
    stripe_subscription_id: subscription.id,
    stripe_customer_id: typeof subscription.customer === 'string'
      ? subscription.customer : subscription.customer?.id || '',
    status: subscription.status || '',
    trial_end: trialEnd(subscription),
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    plan: planOf(subscription),
  };
}

module.exports = {
  MONTHLY_CENTS,
  SLEEP_CENTS,
  SLEEP_LOOKUP_KEY,
  SAAS_TAX_CODE,
  TRIAL_DAYS,
  PRICE_LOOKUP_KEY,
  API_VERSION,
  configured,
  stripe,
  monthlyPriceId,
  priceIdFor,
  planOf,
  integrationIdentifier,
  periodEnd,
  trialEnd,
  summarise,
};
