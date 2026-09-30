'use strict';
// Sleep: $15 a month instead of $115, for a shop that is closed for a while.
// Everything it has recorded stays and stays readable; the register takes no
// sales, returns or exchanges until it wakes.
//
// It is the same Stripe subscription on a different price, so waking is a
// switch back, not a signup. Going to sleep credits what is left of the month
// already paid at the full price; waking charges the rest of this month now,
// and only wakes if that payment goes through. Both take a manager's code.
//
// Stripe here is a fake: nothing in this file talks to Stripe.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const settle = () => new Promise(r => setTimeout(r, 30));

// ── A fake Stripe, installed where billing.js will require it ──
const stripeCalls = [];
const prices = {};          // lookup_key -> price
let subscription = null;    // the one subscription
let declineWake = false;
const fakeStripe = {
  prices: {
    list: async ({ lookup_keys }) => ({ data: prices[lookup_keys[0]] ? [prices[lookup_keys[0]]] : [] }),
    create: async (p) => { stripeCalls.push(['prices.create', p]); return (prices[p.lookup_key] = { id: `price_${p.lookup_key}`, lookup_key: p.lookup_key, ...p }); },
  },
  products: { create: async (p) => { stripeCalls.push(['products.create', p]); return { id: 'prod_1', ...p }; } },
  subscriptions: {
    retrieve: async () => JSON.parse(JSON.stringify(subscription)),
    update: async (id, p) => {
      stripeCalls.push(['subscriptions.update', p]);
      if (p.payment_behavior === 'pending_if_incomplete' && declineWake) {
        return { ...JSON.parse(JSON.stringify(subscription)), pending_update: { subscription_items: p.items } };
      }
      if (p.items) {
        const price = Object.values(prices).find(x => x.id === p.items[0].price);
        subscription.items.data[0] = { id: p.items[0].id, price };
      }
      if ('cancel_at_period_end' in p) subscription.cancel_at_period_end = p.cancel_at_period_end;
      return JSON.parse(JSON.stringify(subscription));
    },
  },
};
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: function Stripe() { return fakeStripe; } };
process.env.STRIPE_SECRET_KEY = 'rk_test_fake';

const billing = require('../src/lib/billing');
const pgDb = require('../src/db/postgres');
let row = null;             // the shop's pos_subscriptions row
pgDb.getSubscription = async () => row && { ...row };
pgDb.saveSubscription = async (userId, fields) => { row = { ...(row || {}), ...fields }; return { ...row }; };
const EMPLOYEES = { '9999': { id: 1, name: 'Mia', role: 'manager' }, '1111': { id: 2, name: 'Bo', role: 'sales' } };
pgDb.verifyEmployeePin = async (pin) => EMPLOYEES[pin] || null;
pgDb.getSettings = async () => ({ store_name: 'Glow SF' });

const billingRoutes = require('../src/routes/billing');
const posRoutes = require('../src/routes/pos');
const handler = (router, p) => router.stack.find(l => l.route && l.route.path === p).route.stack.slice(-1)[0].handle;
const call = async (router, p, body = {}) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(router, p)({ session: { userId: 'u1' }, body, headers: {} }, res);
  return res;
};
const fullPrice = () => ({ id: 'price_skysale_location_monthly', lookup_key: 'skysale_location_monthly' });

(async () => {
  console.log('\n── Which plan a subscription is on ──');
  const on = (lookup_key) => ({ items: { data: [{ price: { lookup_key } }] } });
  check('the sleep price is sleep', billing.planOf(on('skysale_location_sleep_monthly')) === 'sleep');
  check('the full price is full', billing.planOf(on('skysale_location_monthly')) === 'full');
  check('a price changed by hand never stops a shop selling', billing.planOf(on('something_else')) === 'full' && billing.planOf({}) === 'full');
  check('and it is stored with everything else the webhook saves', billing.summarise({ id: 's', customer: 'c', ...on('skysale_location_sleep_monthly') }).plan === 'sleep');

  console.log('\n── Going to sleep ──');
  prices.skysale_location_monthly = fullPrice();
  subscription = { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true,
    items: { data: [{ id: 'si_1', price: fullPrice() }] } };
  row = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active', plan: 'full', cancel_at_period_end: true };

  stripeCalls.length = 0;
  check('without a manager’s code — refused', (await call(billingRoutes, '/sleep', {})).code === 403);
  check('with a sales employee’s PIN — refused', (await call(billingRoutes, '/sleep', { manager_name: 'Bo', manager_pin: '1111' })).code === 403);
  check('with the right code under the wrong name — refused', (await call(billingRoutes, '/sleep', { manager_name: 'Bo', manager_pin: '9999' })).code === 403);
  check('and Stripe was not touched', stripeCalls.length === 0);

  const slept = await call(billingRoutes, '/sleep', { manager_name: 'Mia', manager_pin: '9999' });
  const created = stripeCalls.find(c => c[0] === 'prices.create')?.[1];
  check('the $15 price is made the first time, by its lookup key',
    created && created.unit_amount === 1500 && created.lookup_key === 'skysale_location_sleep_monthly' && created.recurring.interval === 'month');
  check('taxed like the full plan', created.tax_behavior === 'exclusive'
    && stripeCalls.find(c => c[0] === 'products.create')[1].tax_code === billing.SAAS_TAX_CODE);
  const upd = stripeCalls.find(c => c[0] === 'subscriptions.update')[1];
  check('the item’s price is swapped — named by id, so it is not billed twice',
    upd.items.length === 1 && upd.items[0].id === 'si_1' && upd.items[0].price === 'price_skysale_location_sleep_monthly');
  check('what is left of the month at $115 comes back as credit', upd.proration_behavior === 'create_prorations');
  check('a cancellation waiting to happen is called off', upd.cancel_at_period_end === false);
  check('the shop is asleep', slept.code === 200 && slept.body.asleep === true && slept.body.may_sell === false && row.plan === 'sleep');

  stripeCalls.length = 0;
  await call(billingRoutes, '/sleep', { manager_name: 'Mia', manager_pin: '9999' });
  check('asking again does nothing more', !stripeCalls.some(c => c[0] === 'subscriptions.update'));

  console.log('\n── While asleep ──');
  const sale = await call(posRoutes, '/transactions', { type: 'sale', items: [{ product_name: 'x', unit_price: 1, quantity: 1 }] });
  check('the register takes no sale', sale.code === 402 && sale.body.asleep === true);
  check('and says why, and where to wake it', /asleep/.test(sale.body.error) && /Settings → Account/.test(sale.body.error));
  const ret = await call(posRoutes, '/transactions', { type: 'return', items: [{ product_name: 'x', unit_price: 1, quantity: 1 }] });
  check('nor a return', ret.code === 402);
  const status = await call(billingRoutes, '/status');
  check('status says asleep, at $15', status.body.asleep && status.body.plan === 'sleep' && status.body.sleep_cents === 1500);

  console.log('\n── Waking ──');
  declineWake = true;
  stripeCalls.length = 0;
  check('without a manager’s code — refused', (await call(billingRoutes, '/wake', {})).code === 403);
  const declined = await call(billingRoutes, '/wake', { manager_name: 'Mia', manager_pin: '9999' });
  const wupd = stripeCalls.find(c => c[0] === 'subscriptions.update')[1];
  check('it switches back to the $115 price', wupd.items[0].id === 'si_1' && wupd.items[0].price === 'price_skysale_location_monthly');
  check('charging the rest of this month now', wupd.proration_behavior === 'always_invoice');
  check('and only if the charge goes through', wupd.payment_behavior === 'pending_if_incomplete');
  check('a refused card leaves the shop asleep, and says so',
    declined.code === 402 && declined.body.asleep === true && /still asleep/.test(declined.body.error) && row.plan === 'sleep');
  declineWake = false;
  const woke = await call(billingRoutes, '/wake', { manager_name: 'Mia', manager_pin: '9999' });
  check('a good card wakes it', woke.code === 200 && woke.body.may_sell === true && woke.body.asleep === false && row.plan === 'full');
  const sale2 = await call(posRoutes, '/transactions', { type: 'sale', items: [] });
  check('and the register is past the gate again', sale2.code === 400 && !sale2.body.subscription_required);

  console.log('\n── Who cannot sleep ──');
  row = { status: 'comped' };
  check('a shop carried on the house has nothing to switch', (await call(billingRoutes, '/sleep', { manager_name: 'Mia', manager_pin: '9999' })).code === 400);
  row = { stripe_subscription_id: 'sub_1', status: 'canceled', plan: 'full' };
  check('nor a subscription that has ended', (await call(billingRoutes, '/sleep', { manager_name: 'Mia', manager_pin: '9999' })).code === 400);
  const lapsed = await call(posRoutes, '/transactions', { type: 'sale', items: [] });
  check('a lapsed shop is still told it has lapsed, not that it is asleep', lapsed.code === 402 && !lapsed.body.asleep);

  // ── The page ──
  console.log('\n── On the Account screen ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const calls = [];
  let reply = {};
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        const body = opts.body ? JSON.parse(opts.body) : {};
        calls.push({ url: String(url), body });
        if (/manager\/verify/.test(url)) {
          const ok = body.pin === '9999' && body.name === 'Mia';
          return Promise.resolve({ ok, json: async () => ok ? { ok: true } : { error: 'Manager name and code do not match a manager for this store.' } });
        }
        const r = reply[Object.keys(reply).find(k => String(url).includes(k))];
        return Promise.resolve({ ok: r ? r.ok !== false : true, status: r?.status || 200, json: async () => (r ? r.body : {}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
      w.HTMLElement.prototype.scrollIntoView = function () {};
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(r => setTimeout(r, 300));
  const base = { configured: true, monthly_cents: 11500, sleep_cents: 1500, trial_days: 14, current_period_end: '2026-10-28T00:00:00Z', has_customer: true };
  const show = (st) => { w.eval(`subState = ${JSON.stringify({ ...base, ...st })}; renderSubscription(); showSleepBanner();`); };

  show({ status: 'active', may_sell: true });
  check('an active shop is offered sleep at $15', /Put to sleep — \$15 a month/.test(id('subActions').textContent));
  show({ status: 'trialing', trialing: true, may_sell: true });
  check('so is one on its free trial', /Put to sleep/.test(id('subActions').textContent));
  show({ status: 'active', may_sell: true, cancel_at_period_end: true });
  check('a shop that has cancelled is offered sleep instead', /Sleep instead — \$15 a month/.test(id('subActions').textContent));
  show({ status: 'comped', comped: true, may_sell: true });
  check('a shop on the house is not', !/sleep/i.test(id('subActions').textContent));
  check('and no banner on the register', id('sleepBanner').hidden);

  show({ status: 'active', plan: 'sleep', asleep: true, may_sell: false });
  check('asleep: it says so, and what it keeps', /Asleep\./.test(id('subStatus').textContent) && /takes no sales, returns or exchanges/.test(id('subStatus').textContent));
  check('with a way to wake it, back to $115', /Wake the shop — back to \$115 a month/.test(id('subActions').textContent));
  check('and the register says it is asleep', !id('sleepBanner').hidden);

  console.log('\n── Putting it to sleep from the page ──');
  show({ status: 'active', may_sell: true });
  w.eval("settingsAccess = { id: 2, name: 'Bo', role: 'sales' }; settingsCreds = { name: 'Bo', pin: '1111' }; txAccess = null; txCreds = null;");
  let confirmed = 0;
  w.confirm = () => { confirmed++; return false; };
  w.sleepShop();
  check('it asks first, and saying no does nothing', confirmed === 1 && !id('managerAuthModal').classList.contains('show'));
  w.confirm = () => true;
  calls.length = 0;
  w.sleepShop();
  check('a sales employee is asked for a manager’s code', id('managerAuthModal').classList.contains('show')
    && id('managerAuthTitle').textContent === 'Put the Shop to Sleep');
  reply = { '/api/billing/sleep': { body: { ...base, status: 'active', plan: 'sleep', asleep: true, may_sell: false } } };
  id('managerAuthName').value = 'Mia'; id('managerAuthPin').value = '9999';
  await w.submitManagerAuth(); await settle();
  const sent = calls.find(c => /api\/billing\/sleep/.test(c.url));
  check('the manager’s code goes with it', sent && sent.body.manager_name === 'Mia' && sent.body.manager_pin === '9999');
  check('and is not kept afterwards', w.eval('approvedManager') === null);
  check('the card shows it asleep, and the register banner is up', /Asleep\./.test(id('subStatus').textContent) && !id('sleepBanner').hidden);

  console.log('\n── Waking it from the page ──');
  w.eval("settingsAccess = { id: 1, name: 'Mia', role: 'manager' }; settingsCreds = { name: 'Mia', pin: '9999' };");
  reply = { '/api/billing/wake': { ok: false, status: 402, body: { ...base, status: 'active', plan: 'sleep', asleep: true, may_sell: false,
    error: 'The card was not charged, so the shop is still asleep. Update the card and try again.' } } };
  calls.length = 0;
  w.wakeShop(); await settle();
  check('a manager signed in to Settings is not asked twice', !id('managerAuthModal').classList.contains('show')
    && calls.some(c => /api\/billing\/wake/.test(c.url) && c.body.manager_pin === '9999'));
  check('a refused card says so, and it stays asleep', /still asleep/.test(id('subNote').textContent) && !id('sleepBanner').hidden);
  reply = { '/api/billing/wake': { body: { ...base, status: 'active', plan: 'full', asleep: false, may_sell: true } } };
  w.wakeShop(); await settle();
  check('a good card wakes it, and the banner comes down', /awake and taking sales/.test(id('subNote').textContent) && id('sleepBanner').hidden);

  reply = { '/api/billing/status': { body: { ...base, status: 'active', plan: 'sleep', asleep: true } } };
  await w.checkSleeping();
  check('opening the register asks, and shows the banner if asleep', !id('sleepBanner').hidden);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
