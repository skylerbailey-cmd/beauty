'use strict';
// Automatic emails after a sale.
//
// Off by default: every email after a sale waits for someone to press Send.
// Switched on in Settings → Store, the welcome email and/or the receipt go out
// by themselves — decided when the sale is rung up, sent by a queue within the
// minute (or after a set wait), and checked again just before sending.
// Optional rules: a minimum sale, first purchase only (welcome), no more than
// once every N days, a wait in which a returned sale is not emailed; and at
// the till, "don't email this customer" for one sale.
//
// Gmail, Postgres and Stripe are fakes; nothing is sent anywhere.
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
const stub = (mod, exportsObj) => {
  const p = require.resolve(mod);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
};

// ── Fakes ──
const gmailSent = [];
let gmailFails = false;
stub('googleapis', { google: {
  auth: { OAuth2: function () { return { setCredentials() {} }; } },
  gmail: () => ({ users: { messages: { send: async ({ requestBody }) => {
    if (gmailFails) throw new Error('Gmail said no');
    const raw = Buffer.from(requestBody.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    gmailSent.push({ to: /^To: (.*)$/m.exec(raw)[1], subject: /^Subject: (.*)$/m.exec(raw)[1] });
  } } } }),
} });
stub('../src/db', { getUser: () => null, updateUserTokens() {} });
delete process.env.STRIPE_SECRET_KEY;

const pgDb = require('../src/db/postgres');
const { PRODUCTS } = require('../src/routes/welcome');
const PRODUCT = (Array.isArray(PRODUCTS) ? PRODUCTS : Object.values(PRODUCTS).flat())[0];
let settings = {};
let queued = [];
let priorSales = 0;
let lastEmailed = null;           // any kind
let lastEmailedByKind = {};
let returned = false;
let refusedEmails = new Set();
let gmail = { refresh_token: 'rt', email: 'hello@glowsf.com' };
const logged = [];
const welcomesSaved = [];
const finished = [];
const retried = [];
let tx = null;

pgDb.getSettings = async () => ({ store_name: 'Glow SF', tax_rate: 0.08, return_window_days: 30, ...settings });
pgDb.getCustomProducts = async () => [];
pgDb.getProductPrices = async () => [];
pgDb.getProductEmailOverrides = async () => ({});
pgDb.findRecentDuplicate = async () => null;
pgDb.getEmployees = async () => [{ id: 2, name: 'Bo', role: 'sales', active: 1 }];
pgDb.getEmployee = async () => ({ id: 2, name: 'Bo', role: 'sales', active: 1 });
pgDb.createTransaction = async (t) => { tx = { ...t, id: 50, receipt_number: '1042', created_at: new Date(Date.now() - 1000).toISOString(),
  items: [{ product_id: PRODUCT.id, product_name: PRODUCT.name, quantity: 1, unit_price: 100, line_total: 100 }], employees: [{ employee_name: 'Bo' }], payments: [] };
  return { id: 50, receipt_number: '1042' }; };
pgDb.addTransactionItems = async (id, items) => { if (tx) tx.items = items; };
pgDb.addTransactionEmployees = async () => {};
pgDb.findOrCreateCustomer = async () => ({ id: 1 });
pgDb.addCustomerProducts = async () => {};
pgDb.getTransaction = async () => tx;
pgDb.getSubscription = async () => null;
pgDb.queueAutoEmail = async (r) => { const row = { id: queued.length + 1, ...r, send_after: r.sendAfter }; queued.push(row); return { ...row, status: r.status, reason: r.reason }; };
pgDb.priorSalesTo = async () => priorSales;
pgDb.lastEmailedAt = async (u, e, kind) => (kind ? lastEmailedByKind[kind] || null : lastEmailed);
pgDb.wasReturned = async () => returned;
pgDb.noEmailAddresses = async (u, list) => new Set(list.map(e => String(e).toLowerCase()).filter(e => refusedEmails.has(e)));
pgDb.getGmailAccount = async () => gmail;
pgDb.logSentEmail = async (e) => { logged.push(e); };
pgDb.saveWelcomeEmail = async (w) => { welcomesSaved.push(w); };
pgDb.finishAutoEmail = async (id, status, reason) => { finished.push({ id, status, reason }); };
pgDb.retryAutoEmail = async (id, minutes, reason) => { retried.push({ id, minutes, reason }); };
let due = [];
pgDb.claimDueAutoEmails = async () => { const d = due; due = []; return d; };

const router = require('../src/routes/pos');
const handler = router.stack.find(l => l.route && l.route.path === '/transactions' && l.route.methods.post).route.stack.slice(-1)[0].handle;
const sell = async (extra = {}) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ session: { userId: 'u1' }, body: {
    type: 'sale', customer_name: 'Dana Lee', customer_email: 'dana@example.com',
    employees: [{ employee_id: 2, commission_type: 'percent', commission_value: 100 }],
    items: [{ product_id: PRODUCT.id, product_name: PRODUCT.name, quantity: 1, unit_price: 100 }],
    payments: [{ method: 'cash', amount: 108 }], payment_method: 'cash', ...extra } }, res);
  return res;
};
const ON = { auto_email_enabled: 1, auto_email_welcome: 1, auto_email_receipt: 1, auto_email_min_total: 0,
  auto_email_first_only: 1, auto_email_cooldown_days: 0, auto_email_delay_min: 0 };

(async () => {
  console.log('\n── Off, it is how it always was ──');
  settings = {};
  let r = await sell();
  check('a sale queues nothing', r.code === 200 && queued.length === 0 && r.body.auto_emails.length === 0, JSON.stringify(r.body).slice(0, 200));

  console.log('\n── On ──');
  settings = { ...ON };
  queued = [];
  r = await sell();
  check('the welcome email and the receipt are queued', queued.map(q => q.kind).join() === 'welcome,receipt' && queued.every(q => q.status === 'pending'));
  check('to the customer', queued.every(q => q.toEmail === 'dana@example.com'));
  check('due straight away with no wait set', queued.every(q => Math.abs(new Date(q.sendAfter) - Date.now()) < 5000));
  check('and the till is told', r.body.auto_emails.length === 2 && r.body.auto_emails[0].status === 'pending');

  settings = { ...ON, auto_email_delay_min: 15 };
  queued = [];
  await sell();
  check('a wait puts it off that long', Math.abs(new Date(queued[0].sendAfter) - Date.now() - 15 * 60000) < 5000);

  settings = { ...ON, auto_email_receipt: 0 };
  queued = [];
  await sell();
  check('only the emails switched on are queued', queued.map(q => q.kind).join() === 'welcome');

  console.log('\n── The rules ──');
  settings = { ...ON };
  queued = [];
  await sell({ skip_auto_email: true });
  check('unticked at the till: nothing goes', queued.every(q => q.status === 'skipped' && /asked not to email/.test(q.reason)));
  queued = [];
  await sell({ customer_email: '', customer_phone: '5551234567' });
  check('no email address: nothing goes', queued.every(q => q.status === 'skipped' && /no email address/.test(q.reason)));
  settings = { ...ON, auto_email_min_total: 250 };
  queued = [];
  await sell();
  check('under the minimum: nothing goes', queued.every(q => q.status === 'skipped' && /under \$250\.00/.test(q.reason)), queued.map(q => q.reason).join(' | '));
  settings = { ...ON };
  priorSales = 2;
  queued = [];
  await sell();
  check('a returning customer gets no welcome', queued.find(q => q.kind === 'welcome').status === 'skipped' && /not their first purchase/.test(queued.find(q => q.kind === 'welcome').reason));
  check('but still the receipt', queued.find(q => q.kind === 'receipt').status === 'pending');
  settings = { ...ON, auto_email_first_only: 0 };
  queued = [];
  await sell();
  check('with first-purchase-only off, they get the welcome too', queued.every(q => q.status === 'pending'));
  priorSales = 0;
  settings = { ...ON, auto_email_cooldown_days: 30 };
  lastEmailed = new Date(Date.now() - 3 * 86400000).toISOString();
  queued = [];
  await sell();
  check('emailed three days ago, with a 30-day gap set: nothing goes', queued.every(q => q.status === 'skipped' && /last 30 days/.test(q.reason)));
  lastEmailed = new Date(Date.now() - 40 * 86400000).toISOString();
  queued = [];
  await sell();
  check('forty days ago is fine', queued.every(q => q.status === 'pending'));
  lastEmailed = null;
  queued = [];
  const ret = await sell({ type: 'return' });
  check('a return is never emailed automatically', queued.length === 0);

  console.log('\n── Never email, and products that don’t send ──');
  settings = { ...ON };
  refusedEmails = new Set(['dana@example.com']);
  queued = [];
  await sell();
  check('a customer marked never-email gets nothing automatic', queued.every(q => q.status === 'skipped' && /asked never to be emailed/.test(q.reason)));
  refusedEmails = new Set();
  settings = { ...ON, auto_email_excluded: JSON.stringify([PRODUCT.id]) };
  queued = [];
  await sell();
  check('a sale of only excluded products sends nothing', queued.every(q => q.status === 'skipped' && /only products set not to send/.test(q.reason)));
  queued = [];
  await sell({ items: [{ product_id: PRODUCT.id, product_name: PRODUCT.name, quantity: 1, unit_price: 100 },
                       { product_id: 'serum-2', product_name: 'Serum', quantity: 1, unit_price: 40 }] });
  check('bought alongside something else, it still sends', queued.every(q => q.status === 'pending'));
  settings = { ...ON, auto_email_excluded: JSON.stringify(['one-off:*']) };
  queued = [];
  await sell({ items: [{ product_id: 'one-off:touch-up', product_name: 'Touch-up', quantity: 1, unit_price: 100 }] });
  check('“one-off items” covers every Build-your-own line', queued.every(q => q.status === 'skipped'));
  settings = { ...ON };

  console.log('\n── Sending ──');
  settings = { ...ON };
  await sell();
  due = [{ id: 7, user_id: 'u1', transaction_id: 50, kind: 'receipt', attempts: 1 }];
  await router.runAutoEmails();
  check('a due receipt is sent from the shop’s Gmail', gmailSent.length === 1 && gmailSent[0].to === 'dana@example.com' && /Receipt #1042/.test(gmailSent[0].subject));
  check('logged as sent, so it shows under Sent emails', logged.pop()?.kind === 'receipt' && finished.pop()?.status === 'sent');
  due = [{ id: 8, user_id: 'u1', transaction_id: 50, kind: 'welcome', attempts: 1 }];
  await router.runAutoEmails();
  check('a due welcome email is sent', gmailSent.length === 2 && /Welcome/.test(gmailSent[1].subject));
  check('and kept in the welcome history and the customer’s record', welcomesSaved.length === 1 && finished.pop()?.status === 'sent');

  console.log('\n── Checked again before it goes ──');
  const sentBefore = gmailSent.length;
  const runOne = async (kind = 'receipt') => { due = [{ id: 9, user_id: 'u1', transaction_id: 50, kind, attempts: 1 }]; await router.runAutoEmails(); return finished.pop(); };
  returned = true;
  let f = await runOne();
  check('returned in the meantime: not sent', f.status === 'skipped' && /returned/.test(f.reason));
  returned = false;
  settings = { ...ON, auto_email_enabled: 0 };
  f = await runOne();
  check('switched off in the meantime: not sent', f.status === 'skipped' && /switched off/.test(f.reason));
  settings = { ...ON };
  lastEmailedByKind.receipt = new Date().toISOString();
  f = await runOne();
  check('already sent by hand: not sent again', f.status === 'skipped' && /by hand/.test(f.reason));
  lastEmailedByKind = {};
  refusedEmails = new Set(['dana@example.com']);
  f = await runOne();
  check('marked never-email after the sale: not sent', f.status === 'skipped' && /never to be emailed/.test(f.reason));
  refusedEmails = new Set();
  process.env.STRIPE_SECRET_KEY = 'rk_test_fake';
  pgDb.getSubscription = async () => ({ status: 'active', plan: 'sleep' });
  f = await runOne();
  check('the shop asleep: not sent', f.status === 'skipped' && /asleep/.test(f.reason));
  delete process.env.STRIPE_SECRET_KEY;
  pgDb.getSubscription = async () => null;
  check('none of those reached Gmail', gmailSent.length === sentBefore);

  console.log('\n── When Gmail fails ──');
  gmailFails = true;
  due = [{ id: 10, user_id: 'u1', transaction_id: 50, kind: 'receipt', attempts: 1 }];
  await router.runAutoEmails();
  check('it is tried again later', retried.length === 1 && retried[0].minutes === 10 && /Gmail said no/.test(retried[0].reason));
  due = [{ id: 10, user_id: 'u1', transaction_id: 50, kind: 'receipt', attempts: 3 }];
  await router.runAutoEmails();
  f = finished.pop();
  check('and after the third try it says it failed', f.status === 'failed' && /Gmail said no/.test(f.reason));
  gmailFails = false;
  gmail = null;
  due = [{ id: 11, user_id: 'u1', transaction_id: 50, kind: 'receipt', attempts: 3 }];
  await router.runAutoEmails();
  f = finished.pop();
  check('no Gmail connected says so', f.status === 'failed' && /Gmail is not connected/.test(f.reason));
  gmail = { refresh_token: 'rt', email: 'hello@glowsf.com' };

  // ── The page ──
  console.log('\n── In Settings ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const posts = [];
  let saleReply = null;
  let log = [];
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        if (opts.body) posts.push({ url: String(url), body: JSON.parse(opts.body) });
        if (/api\/pos\/transactions$/.test(url)) return Promise.resolve({ ok: true, status: 200, json: async () => saleReply });
        if (/auto-emails/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ emails: log }) });
        if (/customers\/upsert/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ customer: { id: 1, name: 'Dana Lee', no_email: JSON.parse(opts.body).no_email } }) });
        if (/api\/pos\/settings/.test(url) && opts.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ settings: JSON.parse(opts.body) }) });
        return Promise.resolve({ ok: true, json: async () => ({ accepted: true }) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(res => setTimeout(res, 300));

  w.eval('storeSettings = { store_name: "Glow SF", tax_rate: 0.08 }; fillAutoEmailSettings(); showAutoEmailTill();');
  check('off by default', !id('aeEnabled').checked && id('aeOptions').classList.contains('off'));
  check('with the welcome email and first-purchase-only ready to go', id('aeWelcome').checked && id('aeFirstOnly').checked && !id('aeReceipt').checked);
  check('and no box at the till', id('autoEmailTill').style.display === 'none');

  id('aeEnabled').checked = true; w.renderAutoEmailForm();
  id('aeWelcome').checked = false; id('aeReceipt').checked = false;
  await w.saveAutoEmail();
  check('switching on with no email picked is refused', /Pick at least one/.test(id('aeStatus').textContent));
  id('aeWelcome').checked = true; id('aeMinTotal').value = '150'; id('aeCooldown').value = '30'; id('aeDelay').value = '10';
  posts.length = 0;
  await w.saveAutoEmail(); await settle();
  const saved = posts.find(p => /api\/pos\/settings/.test(p.url)).body;
  check('saving sends every rule', saved.auto_email_enabled === 1 && saved.auto_email_welcome === 1 && saved.auto_email_receipt === 0
    && saved.auto_email_min_total === 150 && saved.auto_email_cooldown_days === 30 && saved.auto_email_delay_min === 10 && saved.auto_email_first_only === 1);
  check('and the till now offers the box, ticked', id('autoEmailTill').style.display === 'flex' && id('autoEmailThisSale').checked);

  log = [{ kind: 'welcome', status: 'skipped', reason: 'not sent — not their first purchase', created_at: new Date().toISOString(), receipt_number: '1042', customer_name: 'Dana Lee' },
         { kind: 'receipt', status: 'sent', reason: '', created_at: new Date().toISOString(), receipt_number: '1042', customer_name: 'Dana Lee' }];
  await w.loadAutoEmailLog();
  check('the card lists what the last sales sent, and why not', /Recent automatic emails/.test(id('aeLog').textContent)
    && /not their first purchase/.test(id('aeLog').textContent) && /✓ sent/.test(id('aeLog').textContent));

  console.log('\n── At the till ──');
  id('autoEmailThisSale').checked = false;
  saleReply = { transaction: { type: 'sale', receipt_number: '1043', items: [], employees: [], payments: [] },
    auto_emails: [{ kind: 'welcome', status: 'skipped', reason: 'not sent — the till was asked not to email this customer' }] };
  w.eval(`setMode('sale'); cart = [{ product_id: 'p1', product_name: 'Serum', quantity: 1, unit_price: 100 }];
    saleEmployees = [{ employee_id: 2, commission_value: 100 }];
    document.getElementById('custFirstName').value = 'Dana'; document.getElementById('custEmail').value = 'dana@example.com';
    tenders = [{ method: 'cash', amount: saleTotal(), last4: '' }];`);
  posts.length = 0;
  await w.processTransaction(); await settle();
  const sale = posts.find(p => /api\/pos\/transactions$/.test(p.url))?.body;
  check('unticking it asks the server not to email this one', sale && sale.skip_auto_email === true);
  check('the receipt says so', !id('autoEmailNote').hidden && id('autoEmailNote').style.display !== 'none' && /asked not to email/.test(id('autoEmailNote').textContent));
  check('and the box is ticked again for the next customer', id('autoEmailThisSale').checked);
  w.showAutoEmailNote([{ kind: 'welcome', status: 'pending', send_after: new Date(Date.now() + 10 * 60000).toISOString() }]);
  check('a queued email says when it will go', /Welcome email will send automatically in about 10 minutes/.test(id('autoEmailNote').textContent));
  w.showReceipt({ type: 'sale', receipt_number: '1043', items: [], employees: [], payments: [], created_at: new Date().toISOString(), subtotal: 0, tax_amount: 0, total: 0, tax_rate: 0.08 }, true);
  check('a reprint does not repeat the note', id('autoEmailNote').style.display === 'none');

  console.log('\n── On the page: never email, products that don’t send ──');
  w.eval(`products = [{ id: 'p1', name: 'Serum', brand: 'Avologi' }, { id: 'gift', name: 'Gift card', brand: '' }];
    storeSettings = { store_name: 'Glow SF', auto_email_enabled: 1, auto_email_welcome: 1, auto_email_excluded: '["gift"]' };
    fillAutoEmailSettings(); showAutoEmailTill();`);
  const ex = [...id('aeExcludeList').querySelectorAll('[data-exclude]')];
  check('the card lists the products, and one-off items', ex.some(b => b.dataset.exclude === 'one-off:*') && ex.some(b => b.dataset.exclude === 'p1'));
  check('with the saved ones ticked', ex.find(b => b.dataset.exclude === 'gift').checked && !ex.find(b => b.dataset.exclude === 'p1').checked);
  id('aeExcludeSearch').value = 'seru'; w.renderAutoEmailExclusions();
  check('and a search narrows it', id('aeExcludeList').querySelectorAll('[data-exclude]').length === 1);
  id('aeExcludeSearch').value = ''; w.renderAutoEmailExclusions();
  const one = [...id('aeExcludeList').querySelectorAll('[data-exclude]')].find(b => b.dataset.exclude === 'one-off:*');
  one.checked = true; w.toggleAutoEmailExclusion(one);
  posts.length = 0;
  await w.saveAutoEmail(); await settle();
  const savedEx = JSON.parse(posts.find(p => /api\/pos\/settings/.test(p.url)).body.auto_email_excluded);
  check('saving keeps the ticked products', savedEx.includes('gift') && savedEx.includes('one-off:*'));

  check('“don’t email them again” waits until this sale’s box is unticked', id('autoEmailNeverRow').style.display === 'none');
  id('autoEmailThisSale').checked = false; w.renderAutoEmailTill();
  check('then it is offered', id('autoEmailNeverRow').style.display === 'flex');
  id('autoEmailNever').checked = true;
  saleReply = { transaction: { type: 'sale', receipt_number: '1044', items: [], employees: [], payments: [] }, auto_emails: [] };
  w.eval(`setMode('sale'); cart = [{ product_id: 'p1', product_name: 'Serum', quantity: 1, unit_price: 100 }];
    saleEmployees = [{ employee_id: 2, commission_value: 100 }];
    document.getElementById('custFirstName').value = 'Dana'; document.getElementById('custEmail').value = 'dana@example.com';
    tenders = [{ method: 'cash', amount: saleTotal(), last4: '' }];`);
  posts.length = 0;
  await w.processTransaction(); await settle();
  const pref = posts.find(p => /email-preference/.test(p.url));
  check('the sale saves it on their record', pref && pref.body.email === 'dana@example.com' && pref.body.no_email === true);
  check('and the till starts fresh for the next customer', id('autoEmailThisSale').checked && !id('autoEmailNever').checked && id('autoEmailNeverRow').style.display === 'none');

  w.eval(`custFiltered = [{ customer_name: 'Dana Lee', customer_email: 'dana@example.com', no_email: true, purchases: 1, returns: 0, total_spent: 100, products: [], employees: [] }];
    openCustomerDetail(0);`);
  check('the customer’s details show the flag', id('custDetailNoEmail').checked);
  id('custDetailNoEmail').checked = false;
  posts.length = 0;
  await w.saveCustomerDetail(); await settle();
  check('and saving sends it', posts.find(p => /customers\/upsert/.test(p.url))?.body.no_email === false);

  w.eval(`massCustomers = [
      { customer_name: 'Dana', customer_email: 'dana@example.com', no_email: false, total_spent: 10, products: [], employees: [] },
      { customer_name: 'Sam', customer_email: 'sam@example.com', no_email: true, total_spent: 10, products: [], employees: [] }];
    applyMassFilters();`);
  check('mass email leaves them out, and says so', /<strong>1<\/strong> customer will get/.test(id('massCount').innerHTML) && /1 asked never to be emailed/.test(id('massCount').textContent));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
