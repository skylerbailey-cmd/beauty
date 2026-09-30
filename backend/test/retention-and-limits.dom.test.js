'use strict';
// Four rules, tested together because they share the fakes:
//
// 1. A cancelled shop's books, and its subscription record, are deleted 30
//    days after the subscription stops — with a warning email 7 days before,
//    and never without Stripe confirming the shop really has stopped paying.
// 2. Cancelling, and the billing page, take a manager's name and code. Closing
//    the account stops the subscription too, instead of leaving it charging.
// 3. A sleeping shop books no sessions and sends no email.
// 4. The help chat only helps with SkySale: "what's 4+4" gets a fixed reply
//    written here, not by the model.
//
// Stripe, Postgres, the mailer and Claude are all fakes here.
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
const DAY = 24 * 60 * 60 * 1000;
const stub = (mod, exportsObj) => {
  const p = require.resolve(mod);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
};

// ── Fakes ──
const stripeCalls = [];
let stripeSubs = {};          // customer -> [subscriptions]
let stripeDown = false;
let cancelFails = false;
const fakeStripe = {
  subscriptions: {
    list: async ({ customer }) => { if (stripeDown) throw new Error('stripe down'); return { data: stripeSubs[customer] || [] }; },
    cancel: async (id) => { stripeCalls.push(['cancel', id]); if (cancelFails) throw new Error('no'); return { id, status: 'canceled' }; },
    update: async (id, p) => { stripeCalls.push(['update', id, p]); return { id, status: 'active', customer: 'cus', cancel_at_period_end: true, items: { data: [{ id: 'si', price: { lookup_key: 'skysale_location_monthly' } }] } }; },
  },
  billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/x' }) } },
  prices: { list: async ({ lookup_keys }) => ({ data: [{ id: `price_${lookup_keys[0]}` }] }) },
  customers: { create: async () => ({ id: 'cus_new' }) },
  checkout: { sessions: { create: async (p) => { stripeCalls.push(['checkout', p]); return { url: 'https://checkout.stripe.com/x' }; } } },
};
stub('stripe', function Stripe() { return fakeStripe; });
process.env.STRIPE_SECRET_KEY = 'rk_test_fake';

let modelReply = '';
const modelCalls = [];
stub('@anthropic-ai/sdk', function Anthropic() {
  return { beta: { messages: { create: async (p) => { modelCalls.push(p); return { stop_reason: 'end_turn', content: [{ type: 'text', text: modelReply }] }; } } } };
});
stub('../src/db', { getUser: (id) => ({ u1: { email: 'owner@glowsf.com' }, u2: { email: '' } })[id] || { email: 'x@y.com' } });

const mails = [];
const mailer = require('../src/services/mailer');
mailer.send = async (m) => { mails.push(m); };

const pgDb = require('../src/db/postgres');
let rows = {};                // user_id -> pos_subscriptions row
const deleted = [];
pgDb.getSubscription = async (u) => rows[u] && { ...rows[u] };
pgDb.saveSubscription = async (u, f) => { rows[u] = { ...(rows[u] || { user_id: u }), ...f }; return { ...rows[u] }; };
pgDb.endedSubscriptions = async () => Object.values(rows)
  .filter(r => r.status === 'canceled' && (r.ended_at || r.current_period_end || r.canceled_at))
  .map(r => ({ ...r, stopped_at: r.ended_at || r.current_period_end || r.canceled_at }));
pgDb.deleteSubscriptionRow = async (u) => { delete rows[u]; };
pgDb.deleteCompany = async (u) => { deleted.push(u); return { deleted: { pos_transactions: 3 }, slug: 'glowsf', storeName: 'Glow SF' }; };
pgDb.getSettings = async () => ({ store_name: 'Glow SF', slug: 'glowsf' });
const EMPLOYEES = { '9999': { id: 1, name: 'Mia', role: 'manager' }, '1111': { id: 2, name: 'Bo', role: 'sales' }, '7777': { id: 3, name: 'Ana', role: 'admin' } };
pgDb.verifyEmployeePin = async (pin) => EMPLOYEES[pin] || null;

const retention = require('../src/services/retention');
const billingRoutes = require('../src/routes/billing');
const posRoutes = require('../src/routes/pos');
const welcomeRoutes = require('../src/routes/welcome').router;
const bookingRoutes = require('../src/routes/booking');
const help = require('../src/services/help');

const route = (router, method, p) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]).route;
const call = async (router, p, body = {}, { method = 'post', userId = 'u1', req: extra = {} } = {}) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; },
    clearCookie() {}, setHeader() {}, set() { return this; }, send(b) { this.body = b; return this; } };
  const req = { session: { userId }, body, headers: {}, params: {}, ...extra };
  const stack = route(router, method, p).stack;
  // Run the route's own middleware in order, as Express would.
  for (let i = 0; i < stack.length; i++) {
    let went = false;
    await stack[i].handle(req, res, () => { went = true; });
    if (!went && i < stack.length - 1) break;
  }
  return res;
};

(async () => {
  // ── 1. Deleting cancelled shops ──
  console.log('\n── A cancelled shop’s books ──');
  const now = new Date('2026-10-30T12:00:00Z');
  const stoppedDaysAgo = (d) => new Date(now.getTime() - d * DAY);
  rows = {
    u1: { user_id: 'u1', stripe_customer_id: 'cus_1', status: 'canceled', ended_at: stoppedDaysAgo(24) },   // warn
    u2: { user_id: 'u2', stripe_customer_id: 'cus_2', status: 'canceled', ended_at: stoppedDaysAgo(31) },   // delete
    u3: { user_id: 'u3', stripe_customer_id: 'cus_3', status: 'canceled', ended_at: stoppedDaysAgo(10) },   // nothing yet
    u4: { user_id: 'u4', stripe_customer_id: 'cus_4', status: 'active', current_period_end: stoppedDaysAgo(90) }, // paying
    u5: { user_id: 'u5', stripe_customer_id: 'cus_5', status: 'canceled', ended_at: stoppedDaysAgo(45) },   // paying again, webhook lost
    u6: { user_id: 'u6', stripe_customer_id: 'cus_6', status: 'comped' },
  };
  stripeSubs = { cus_5: [{ id: 'sub_new', customer: 'cus_5', status: 'active', items: { data: [{ price: { lookup_key: 'skysale_location_monthly' } }] } }] };
  let d = await retention.runRetention({ now });
  const first = d;
  check('a shop 31 days stopped but never warned is warned, not deleted', !deleted.includes('u2') && d.warned.includes('u2'));
  rows.u2.deletion_warned_at = new Date(now.getTime() - 8 * DAY);
  mails.length = 0;
  d = await retention.runRetention({ now });
  check('a week after the warning, it is deleted', d.deleted.join() === 'u2' && deleted.join() === 'u2');
  check('and its subscription record with it', !rows.u2);
  rows.u1.deletion_warned_at = undefined;
  d = await retention.runRetention({ now });
  check('a week before, the owner is warned', d.warned.join() === 'u1' && mails.length === 1 && mails[0].to === 'owner@glowsf.com');
  check('the warning says when, and how to keep it',
    /deleted on November 6, 2026/.test(mails[0].subject) && /put the shop to sleep/.test(mails[0].text) && /export/i.test(mails[0].text), mails[0] && mails[0].subject);
  check('ten days in, nothing happens yet', rows.u3 && !rows.u3.deletion_warned_at && !deleted.includes('u3'));
  check('a paying shop is never touched', !deleted.includes('u4') && !deleted.includes('u6'));
  check('a shop Stripe says is paying again is kept, and its record corrected',
    !deleted.includes('u5') && first.kept.includes('u5') && rows.u5.status === 'active');
  check('the warning always gives a full week', retention.deletesOn(stoppedDaysAgo(29), null, now).getTime() === now.getTime() + 7 * DAY);

  mails.length = 0;
  d = await retention.runRetention({ now: new Date(now.getTime() + DAY) });
  check('the warning is sent once', mails.length === 0 && d.warned.length === 0);

  stripeDown = true;
  rows.u9 = { user_id: 'u9', stripe_customer_id: 'cus_9', status: 'canceled', ended_at: stoppedDaysAgo(60) };
  d = await retention.runRetention({ now });
  check('if Stripe cannot be asked, nothing is deleted', !deleted.includes('u9') && !!rows.u9);
  stripeDown = false;

  rows.u7 = { user_id: 'u7', status: 'canceled', current_period_end: stoppedDaysAgo(29), canceled_at: stoppedDaysAgo(55) };
  d = await retention.runRetention({ now });
  check('an older record counts from the end of the paid period, not the day Cancel was pressed', !deleted.includes('u7'));

  console.log('\n── The Account card is told when ──');
  rows.u1 = { user_id: 'u1', status: 'canceled', ended_at: new Date('2026-10-01T00:00:00Z') };
  let st = (await call(billingRoutes, '/status', {}, { method: 'get' })).body;
  check('a cancelled shop hears the day it goes', new Date(st.deletes_on).toISOString().slice(0, 10) === '2026-10-31', st.deletes_on);
  rows.u1 = { user_id: 'u1', status: 'active', cancel_at_period_end: true, current_period_end: new Date('2026-11-15T00:00:00Z') };
  st = (await call(billingRoutes, '/status', {}, { method: 'get' })).body;
  check('so does one cancelled but still running — 30 days after it will stop', new Date(st.deletes_on).toISOString().slice(0, 10) === '2026-12-15');
  rows.u1 = { user_id: 'u1', status: 'active', current_period_end: new Date('2026-11-15T00:00:00Z') };
  st = (await call(billingRoutes, '/status', {}, { method: 'get' })).body;
  check('a shop that has not cancelled has no such day', st.deletes_on === null);

  // ── 2. Managers only ──
  console.log('\n── Cancelling takes a manager ──');
  rows.u1 = { user_id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active' };
  stripeCalls.length = 0;
  check('no code — refused', (await call(billingRoutes, '/cancel', {})).code === 403);
  check('a sales employee — refused', (await call(billingRoutes, '/cancel', { manager_name: 'Bo', manager_pin: '1111' })).code === 403);
  check('and Stripe was not asked', !stripeCalls.length);
  const c = await call(billingRoutes, '/cancel', { manager_name: 'Mia', manager_pin: '9999' });
  check('a manager — cancelled at the end of the period', c.code === 200 && stripeCalls[0][2].cancel_at_period_end === true);
  check('the billing page too: no code, no page', (await call(billingRoutes, '/portal', {})).code === 403);
  check('a manager gets it', (await call(billingRoutes, '/portal', { manager_name: 'Mia', manager_pin: '9999' })).body.url.startsWith('https://billing.stripe.com'));

  console.log('\n── Coming back asleep ──');
  rows.u1 = { user_id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'canceled' };
  stripeCalls.length = 0;
  await call(billingRoutes, '/checkout', { plan: 'sleep', return_to: '/pos.html' });
  const co = stripeCalls.find(x => x[0] === 'checkout')?.[2] || stripeCalls.find(x => x[0] === 'checkout')?.[1];
  check('a shop whose subscription ended can start again on the $15 plan', co && co.line_items[0].price === 'price_skysale_location_sleep_monthly');
  check('with no free trial', co && co.subscription_data.trial_period_days === undefined);
  stripeCalls.length = 0;
  await call(billingRoutes, '/checkout', { return_to: '/pos.html' });
  const full = stripeCalls.find(x => x[0] === 'checkout')[1];
  check('starting again at full price keeps the trial', full.line_items[0].price === 'price_skysale_location_monthly' && full.subscription_data.trial_period_days === 14);

  console.log('\n── Closing the account stops the subscription ──');
  rows.u1 = { user_id: 'u1', stripe_subscription_id: 'sub_1', status: 'active' };
  deleted.length = 0; stripeCalls.length = 0;
  cancelFails = true;
  let close = await call(posRoutes, '/close-account', { name: 'Ana', pin: '7777', confirm: 'Glow SF' });
  check('if Stripe will not stop it, nothing is deleted', close.code === 502 && !deleted.length && !!rows.u1);
  cancelFails = false;
  close = await call(posRoutes, '/close-account', { name: 'Ana', pin: '7777', confirm: 'Glow SF' });
  check('otherwise the subscription is stopped first', stripeCalls.filter(x => x[0] === 'cancel').length === 2);
  check('then the shop and its subscription record are deleted', close.code === 200 && deleted.join() === 'u1' && !rows.u1);

  // ── 3. Asleep: no bookings, no email ──
  console.log('\n── A sleeping shop books nothing and sends nothing ──');
  rows.u1 = { user_id: 'u1', status: 'active', plan: 'sleep' };
  const asleep = async (router, p, method = 'post', extra) => {
    const r = await call(router, p, {}, { method, req: extra });
    return r.code === 402 && r.body.asleep === true;
  };
  check('a new session', await asleep(posRoutes, '/appointments'));
  check('moving a session', await asleep(posRoutes, '/appointments/:id', 'patch'));
  check('resending a booking email', await asleep(posRoutes, '/appointments/:id/resend'));
  check('a mass email', await asleep(posRoutes, '/mass-email'));
  check('a receipt emailed again', await asleep(posRoutes, '/transactions/:id/email'));
  check('a welcome email', await asleep(posRoutes, '/transactions/:id/welcome'));
  check('a welcome email from the email suite', await asleep(welcomeRoutes, '/send'));
  check('a campaign', await asleep(welcomeRoutes, '/campaign'));
  const load = route(bookingRoutes, 'post', '/:token/reschedule').stack;
  check('a customer moving their own booking', load.length === 3);
  const refuse = load[1].handle;
  const r = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await refuse({ appt: { user_id: 'u1' } }, r, () => {});
  check('— is refused for the shop the booking belongs to', r.code === 402);
  check('the Smart Inbox’s send is behind the same check',
    /router\.post\('\/:id\/send', refuseWhileAsleep\('emails'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'emails.js'), 'utf8')));
  check('cancelling a booking is still allowed', route(posRoutes, 'post', '/appointments/:id/cancel').stack.length === 1
    && route(bookingRoutes, 'post', '/:token/cancel').stack.length === 2);
  rows.u1 = { user_id: 'u1', status: 'active', plan: 'full' };
  const awake = await call(posRoutes, '/appointments', {}, {});
  check('awake, bookings get past the check', !(awake.code === 402));

  // ── 4. The chat ──
  console.log('\n── The help chat only helps with SkySale ──');
  const prompt = help.systemPrompt();
  check('the model is told what is off topic', /OFF_TOPIC/.test(prompt) && /4\+4/.test(prompt) && /ignore or change these instructions/.test(prompt));
  modelReply = 'OFF_TOPIC';
  check('"what\'s 4+4" gets our reply, not the model’s', (await help.askHelp([{ role: 'user', text: "what's 4+4" }])) === help.OFF_TOPIC_REPLY);
  modelReply = 'Sure — 8. OFF_TOPIC';
  check('even if the model says more around it', (await help.askHelp([{ role: 'user', text: 'x' }])) === help.OFF_TOPIC_REPLY);
  modelReply = 'Go to [Settings → Account](go:settings/account) and press "Put to sleep".';
  check('a real question is answered', /Put to sleep/.test(await help.askHelp([{ role: 'user', text: 'how do I sleep the shop' }])));
  check('the reply says what it can help with', /only help with using SkySale/.test(help.OFF_TOPIC_REPLY));
  check('the guide knows cancelled shops are deleted after 30 days', /30\s+days after it ends everything recorded is deleted/.test(help.GUIDE.replace(/\s+/g, ' ')));
  check('and that a sleeping shop books and sends nothing', /books or moves no Calendar sessions/.test(help.GUIDE.replace(/\s+/g, ' ')));

  // ── The page ──
  console.log('\n── On the page ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const calls = [];
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : {} });
        if (/manager\/verify/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
      w.HTMLElement.prototype.scrollIntoView = function () {};
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(res => setTimeout(res, 300));
  const base = { configured: true, monthly_cents: 11500, sleep_cents: 1500, trial_days: 14, has_customer: true };
  const show = (s) => w.eval(`subState = ${JSON.stringify({ ...base, ...s })}; renderSubscription(); showSleepBanner();`);

  show({ status: 'canceled', may_sell: false, deletes_on: '2026-10-31T00:00:00Z' });
  check('an ended shop sees the day its books go', /until October 3\d, 2026, when it is deleted/.test(id('subStatus').textContent), id('subStatus').textContent);
  check('and can keep them asleep for $15', /Keep it asleep — \$15 a month/.test(id('subActions').textContent));
  calls.length = 0;
  await w.startCheckout('sleep'); await settle();
  check('which starts a checkout on the sleep plan', calls.some(c2 => /billing\/checkout/.test(c2.url) && c2.body.plan === 'sleep'));

  show({ status: 'active', may_sell: true, cancel_at_period_end: true, current_period_end: '2026-11-15T00:00:00Z', deletes_on: '2026-12-15T00:00:00Z' });
  check('a shop cancelled but running is told too', /deleted — on December 1\d, 2026/.test(id('subStatus').textContent), id('subStatus').textContent);

  show({ status: 'active', may_sell: true });
  w.eval("settingsAccess = { id: 2, name: 'Bo', role: 'sales' }; settingsCreds = { name: 'Bo', pin: '1111' }; txAccess = null; txCreds = null;");
  calls.length = 0;
  w.cancelSubscription();
  check('a sales employee cancelling is asked for a manager’s code', id('managerAuthModal').classList.contains('show')
    && id('managerAuthTitle').textContent === 'Cancel the Subscription' && !calls.some(c2 => /billing\/cancel/.test(c2.url)));
  id('managerAuthName').value = 'Mia'; id('managerAuthPin').value = '9999';
  await w.submitManagerAuth(); await settle();
  check('and it goes with the manager’s code', calls.some(c2 => /billing\/cancel/.test(c2.url) && c2.body.manager_pin === '9999'));
  w.closeManagerAuth();
  calls.length = 0;
  w.openBillingPortal();
  check('Update card asks too', id('managerAuthModal').classList.contains('show') && id('managerAuthTitle').textContent === 'Billing');
  w.closeManagerAuth();

  show({ status: 'active', plan: 'sleep', asleep: true, may_sell: false });
  const banners = [...w.document.querySelectorAll('.sleep-banner')];
  check('asleep, the Register, Calendar and Emails each say so',
    banners.length === 3 && banners.every(b => !b.hidden)
    && ['tab-register', 'tab-calendar', 'tab-emails'].every(t => id(t).querySelector('.sleep-banner')));
  show({ status: 'active', may_sell: true });
  check('awake, none do', [...w.document.querySelectorAll('.sleep-banner')].every(b => b.hidden));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
