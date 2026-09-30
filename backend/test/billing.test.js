'use strict';
// Paying for a shop.
//
// $115 a month per store location, fourteen days free, cancel at the end of
// the period already paid for. What is worth testing here is not Stripe —
// they test Stripe — but the decisions this codebase makes around it:
//
//   which states let a shop keep ringing up sales, and which do not;
//   that an unconfigured server never closes a till;
//   that the webhook refuses anything it cannot verify;
//   that a subscription row survives being written by two writers who each
//   know different halves of it.
//
// Built on a throwaway shop, and it never talks to Stripe.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const fs = require('fs');
const path = require('path');
const pgDb = require('../src/db/postgres');
const billing = require('../src/lib/billing');
const { Client } = require('pg');

const SHOP = 'zz-billing-test-shop';
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cleanup = () => c.query('DELETE FROM pos_subscriptions WHERE user_id = $1', [SHOP]);
  await cleanup();

  console.log('\n── The price ──');
  check('$115 a month', billing.MONTHLY_CENTS === 11500, String(billing.MONTHLY_CENTS));
  check('a fortnight free', billing.TRIAL_DAYS === 14, String(billing.TRIAL_DAYS));

  console.log('\n── Which shops may ring up a sale ──');
  const live = (status) => pgDb.LIVE_SUB_STATUSES.has(status);
  check('a shop on trial can sell', live('trialing'));
  check('a paying shop can sell', live('active'));
  // A card that has already been refused, with Stripe retrying in the
  // background, is not a shop that should keep trading for a fortnight.
  check('a shop whose card failed cannot', !live('past_due'));
  check('nor one that stopped paying', !live('unpaid'));
  check('nor a cancelled one', !live('canceled'));
  check('nor one that never finished signing up', !live('incomplete'));
  check('nor one with no subscription at all', !live(''));
  // Ours, not Stripe's: a location that is not being charged at all. Without
  // it, switching billing on would have stopped the owner's own two shops
  // trading the moment the key was set.
  check('a comped location can sell', live('comped'));

  console.log('\n── A missing Stripe key never closes a till ──');
  // The gate asks billing.configured() first. Nothing about a key being
  // absent should stop a shop trading — that would turn a deploy with a
  // missing variable into every register in the product refusing sales.
  const posSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pos.js'), 'utf8');
  check('the gate lets everyone through when billing is off',
    /if \(!billing\.configured\(\)\) return true;/.test(posSrc));
  check('and it is the first thing it asks',
    /async function mayRingUpSales[\s\S]{0,200}billing\.configured\(\)/.test(posSrc));
  check('a paused shop is refused with 402, not 500',
    /status\(402\)[\s\S]{0,200}subscription_required/.test(posSrc));
  check('and told their records are still there',
    /Everything already recorded is still here/.test(posSrc));

  console.log('\n── The subscription row ──');
  await pgDb.saveSubscription(SHOP, { stripe_customer_id: 'cus_zztest' });
  let row = await pgDb.getSubscription(SHOP);
  check('a customer can be recorded before there is a subscription',
    row.stripe_customer_id === 'cus_zztest' && !row.stripe_subscription_id,
    JSON.stringify(row && { c: row.stripe_customer_id, s: row.stripe_subscription_id }));

  // The checkout return and the webhook both write here and each knows
  // things the other does not. A write of one field must not blank the rest.
  const end = new Date('2026-11-01T00:00:00Z');
  await pgDb.saveSubscription(SHOP, {
    stripe_subscription_id: 'sub_zztest', status: 'trialing', current_period_end: end,
  });
  row = await pgDb.getSubscription(SHOP);
  check('adding the subscription keeps the customer',
    row.stripe_customer_id === 'cus_zztest', row.stripe_customer_id);
  check('and records the status', row.status === 'trialing', row.status);
  check('and when it runs out',
    new Date(row.current_period_end).toISOString() === end.toISOString(),
    String(row.current_period_end));

  await pgDb.saveSubscription(SHOP, { status: 'active' });
  row = await pgDb.getSubscription(SHOP);
  check('a later status-only write leaves the period alone',
    row.status === 'active'
    && new Date(row.current_period_end).toISOString() === end.toISOString(),
    `${row.status} / ${row.current_period_end}`);

  console.log('\n── Finding the shop an event belongs to ──');
  check('by customer', (await pgDb.companyForStripeCustomer('cus_zztest'))?.user_id === SHOP);
  check('by subscription', (await pgDb.companyForStripeSubscription('sub_zztest'))?.user_id === SHOP);
  check('an unknown customer matches nobody',
    (await pgDb.companyForStripeCustomer('cus_nobody')) === null);
  check('and neither does an empty id',
    (await pgDb.companyForStripeCustomer('')) === null);

  console.log('\n── Cancelling runs to the end of the period ──');
  await pgDb.saveSubscription(SHOP, { cancel_at_period_end: true });
  row = await pgDb.getSubscription(SHOP);
  check('the shop is still marked live', pgDb.LIVE_SUB_STATUSES.has(row.status), row.status);
  check('and flagged as not renewing', row.cancel_at_period_end === true);
  const billingSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'billing.js'), 'utf8');
  check('cancel sets cancel_at_period_end, never deletes',
    /cancel_at_period_end: true/.test(billingSrc)
    && !/subscriptions\.(del|cancel)\(/.test(billingSrc));
  check('and it can be undone', /cancel_at_period_end: false/.test(billingSrc));

  console.log('\n── Nothing takes a company id from the caller ──');
  // The one thing that would let anybody cancel somebody else's shop.
  check('every route reads the session',
    (billingSrc.match(/req\.session\.userId/g) || []).length >= 5);
  check('and none reads a company from the body',
    !/req\.body[^\n]*(user_id|company_id|companyId)/.test(billingSrc));

  console.log('\n── A comped shop can start paying ──');
  // Being carried on the house is not "already subscribed". Refusing
  // checkout for it would leave an existing shop with no route onto a plan.
  check('checkout refuses only a real live Stripe subscription',
    /sub\?\.stripe_subscription_id && \['trialing', 'active'\]\.includes\(sub\.status\)/.test(billingSrc),
    'checkout still refuses on LIVE_SUB_STATUSES, which now includes comped');

  console.log('\n── Coming back from Stripe ──');
  // A Host header is set by whoever is calling. Used unchecked to build a
  // success_url, it turns Stripe's redirect into an open redirect — and the
  // person being sent somewhere else has just typed their card in.
  check('the return host is checked against our own domain',
    /host === domain \|\| host\.endsWith/.test(billingSrc));
  check('and anything else falls back to our own app',
    /return domain \? `https:\/\/app\./.test(billingSrc));
  // Signup is on app.<domain>, the register on <shop>.<domain>. A fixed base
  // would land somebody back on the wrong one.
  check('people come back to the host they left from',
    /returnBase\(req\)/.test(billingSrc) && !/`https:\/\/\$\{appDomain\(\)\}`/.test(billingSrc));
  check('and only to a path, never to a URL somebody sent',
    /startsWith\('\/'\)/.test(billingSrc));

  console.log('\n── Tax ──');
  const libSrcT = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'billing.js'), 'utf8');
  check('tax is worked out automatically', /automatic_tax: \{ enabled: true \}/.test(billingSrc));
  // The customer exists before Checkout opens, so without this Stripe taxes
  // whatever address is saved against them — none, for a new customer — and
  // quietly charges zero.
  check('the address typed at checkout is the one taxed',
    /customer_update: \{ address: 'auto'/.test(billingSrc));
  check('a business can give its tax ID', /tax_id_collection/.test(billingSrc));
  // Asking an EXISTING customer for a tax ID is refused outright unless
  // Checkout may also write back the business name. Found by running the
  // real call before a customer did: the first signup would have failed.
  check('and Checkout may write the business name back, or that is refused',
    /customer_update: \{ address: 'auto', name: 'auto' \}/.test(billingSrc));
  // A tax code is not something to remember or invent: a wrong one does not
  // error, it taxes nothing, and that cannot be put right afterwards.
  check('the product carries a real Stripe tax code',
    /txcd_[0-9]{8}/.test(libSrcT) && /tax_code: SAAS_TAX_CODE/.test(libSrcT));
  check('and it is not the Nontaxable one', !/txcd_00000000/.test(libSrcT));
  check('tax is added on top of $115, not carved out of it',
    /tax_behavior: 'exclusive'/.test(libSrcT));
  check('billing addresses are not forced on new customers',
    !/billing_address_collection: 'required'/.test(billingSrc));
  check('and the code says plainly that this collects nothing without a registration',
    /active tax registration/.test(billingSrc));

  console.log('\n── The webhook ──');
  const hookSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'stripe-webhook.js'), 'utf8');
  check('the signature is verified', /constructEvent\(/.test(hookSrc));
  check('over the raw body, not a parsed one', /express\.raw\(/.test(hookSrc));
  const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  check('and it is mounted before the JSON parser',
    idxSrc.indexOf("'/api/stripe/webhook'") < idxSrc.indexOf('express.json('),
    `webhook at ${idxSrc.indexOf("'/api/stripe/webhook'")}, json at ${idxSrc.indexOf('express.json(')}`);
  check('an unverified event is refused', /status\(400\)/.test(hookSrc));
  check('with nothing said about why',
    !/err\.message/.test(hookSrc.slice(hookSrc.indexOf('constructEvent'), hookSrc.indexOf('HANDLED.has'))));
  check('renewals are handled, not just checkout',
    ['invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated',
      'customer.subscription.deleted'].every((e) => hookSrc.includes(e)));
  check('an event we do not handle is acknowledged, not retried forever',
    /if \(!HANDLED\.has\(event\.type\)\) return res\.json/.test(hookSrc));
  check('a handler that throws asks Stripe to retry', /status\(500\)/.test(hookSrc));

  console.log('\n── No card details, and no keys, in this codebase ──');
  const webSrc = ['pos.html', 'signup.html']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8')).join('\n');
  check('the browser never collects a card number',
    !/card_number|cardNumber|cc-number|creditCard/i.test(webSrc));
  check('checkout is Stripe-hosted', /checkout\.sessions\.create/.test(billingSrc));
  check('no live key anywhere', !/[sr]k_live_/.test(billingSrc + hookSrc + webSrc));
  check('no test key either', !/[sr]k_test_/.test(billingSrc + hookSrc + webSrc));
  const libSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'billing.js'), 'utf8');
  check('the key is read from the environment', /process\.env\.STRIPE_SECRET_KEY/.test(libSrc));
  check('and never logged',
    !/console\.[a-z]+\([^)]*STRIPE_SECRET_KEY/.test(libSrc + billingSrc + hookSrc));

  console.log('\n── Stripe is asked for what it can answer, not what we guess ──');
  check('dynamic payment methods, not a hardcoded card list',
    !/payment_method_types/.test(billingSrc));
  check('the checkout session is tagged for the Dashboard',
    /integration_identifier/.test(billingSrc));
  check('the price is looked up rather than pasted into config',
    /lookup_keys/.test(libSrc) && !/process\.env\.STRIPE_PRICE/.test(libSrc));
  check('the period end is read from the item too, since Stripe moved it',
    /items\?\.data\?\.\[0\]/.test(libSrc));

  await cleanup();
  const left = await c.query('SELECT COUNT(*) n FROM pos_subscriptions WHERE user_id = $1', [SHOP]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
