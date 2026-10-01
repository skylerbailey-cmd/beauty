'use strict';
// The guided tour, from the help menu beside the company switcher.
//
// It walks the tabs left to right, lighting up each thing it describes, and
// asks for a name and PIN first so each person is shown only what their own
// PIN opens. With a PIN it shows the shop's real figures: each tab is opened
// the same way typing that PIN into it would, and the step lights up an actual
// row — a receipt, a customer, your own commission — and says what it is.
//
// What it must never do is leave anything open. When it ends, everything it
// opened is locked and emptied, the PIN is gone, and whoever had a tab open
// before gets it back. It never calls switchTab.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

// A small shop's worth of data, answered only to a PIN the server knows.
const PINS = { '4321': { id: 1, name: 'Ana', role: 'admin' }, '1111': { id: 2, name: 'Bo', role: 'sales' },
               '2222': { id: 3, name: 'Cy', role: 'manager' } };
const TX = { id: 1, receipt_number: 'R-1042', created_at: '2026-09-28T15:00:00Z', type: 'sale',
  customer_name: 'Dana Lee', customer_email: 'dana@example.com',
  items: [{ product_name: 'Hydra Serum', quantity: 1, price: 89, unit_price: 89 }],
  subtotal: 89, tax: 7.29, total: 96.29, payment_method: 'card',
  employees: [{ employee_name: 'Bo', employee_id: 2, split_pct: 100 }], payments: [{ method: 'card', amount: 96.29 }], chargebacks: [] };
const calls = [];
let refuseTransactions = false;
const who = (body) => { try { return PINS[JSON.parse(body).pin]; } catch (_) { return null; } };
const routes = [
  [/employees\/verify/, (b) => who(b) ? [200, { employee: who(b), role: who(b).role }] : [401, { error: 'Invalid name or PIN' }]],
  [/transactions\/mine/, (b) => refuseTransactions || !who(b) ? [401, { error: 'Invalid name or PIN' }]
    : [200, { employee: who(b), role: who(b).role, transactions: [TX], company_count: 1 }]],
  [/reports\/employee-personal/, (b) => who(b) ? [200, { employee: who(b), role: who(b).role,
    report: [{ employee_name: who(b).name, sale_count: 3, net_total: 250, chargeback_total: 0, commission_rate: 10 }], returns: [] }]
    : [401, { error: 'Invalid name or PIN' }]],
  [/reports\/customers/, () => [200, { report: [{ customer_name: 'Dana Lee', customer_email: 'dana@example.com',
    purchases: 1, total_spent: 96.29, last_purchase: '2026-09-28', employees: ['Bo'], items: ['Hydra Serum'] }] }]],
  [/reports\/employees/, () => [200, { report: [{ employee_name: 'Bo', total_sales: 96.29, sale_count: 1 }] }]],
  [/treatments/, () => [200, { treatments: [{ id: 1, name: 'LED Facial', duration_min: 45 }] }]],
  [/availability/, () => [200, { days: [], closed_dates: [], capacity: 2, slot_step: 30, lead_hours: 2 }]],
  [/appointments/, () => [200, { appointments: [] }]],
  [/auth\/terms/, () => [200, { accepted: true }]],
  [/api\/pos\/products/, () => [200, { products: [{ id: 'p1', name: 'Hydra Serum', brand: 'Avologi', price: 89, isCustom: true }] }]],
];

const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body });
      const route = routes.find(([re]) => re.test(String(url)));
      const [status, body] = route ? route[1](opts.body) : [200, {}];
      return Promise.resolve({ ok: status < 400, status, json: async () => body });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
    // jsdom lays nothing out, so "is it on screen" is answered from display.
    w.Element.prototype.getClientRects = function () {
      if (!this.isConnected) return [];
      for (let e = this; e && e.nodeType === 1; e = e.parentElement) {
        if (w.getComputedStyle(e).display === 'none') return [];
      }
      return [{}];
    };
    Object.defineProperty(w, 'localStorage', { configurable: true, value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const doc = w.document;
const id = (x) => doc.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const settle = () => new Promise(r => setTimeout(r, 30));
const go = async (title) => {
  await w.eval(`tourGo(tour.steps.findIndex(s => (typeof s.title === 'function' ? s.title(tour.rank) : s.title) === ${JSON.stringify(title)}))`);
  await settle();
};
const lit = () => w.eval('tour.el');
const said = () => w.eval('tour.text');
const signIn = async (name, pin) => {
  w.startTour();
  id('tourName').value = name; id('tourPin').value = pin;
  await w.tourSignIn(); await settle();
};
const nothingOpen = () => w.eval('txAccess === null && txCreds === null && settingsAccess === null && settingsCreds === null && personalCreds === null');

// Where you were: which tab and which view of it. Compared before and after.
const whereAmI = () => [...doc.querySelectorAll(
  '.tab-content, #posSubtabs button, .tx-view-btn, #settingsSubtabs .sub-btn, [data-sgroup], #emailsNav button, ' +
  '#txViewSales, #txViewAudit, #txViewCustomers, #emailViewWelcome, #emailViewMass')]
  .map(el => `${el.id || el.textContent.trim().slice(0, 20)}|${el.className}|${el.style.display}`).join('\n');
const diff = (a, b) => a.split('\n').map((x, i) => x !== b.split('\n')[i] ? `${x}  =>  ${b.split('\n')[i]}` : null).filter(Boolean);

setTimeout(async () => {
  const STEPS = w.eval('TOUR_STEPS');
  const WHO = w.eval('TOUR_WHO');
  const title = (s, r) => typeof s.title === 'function' ? s.title(r) : s.title;

  console.log('\n── The help menu ──');
  const btn = id('helpBtn');
  check('there is a help button', !!btn);
  check('it sits beside the company switcher',
    btn && btn.closest('#headerUser') && id('companySwitcher').parentElement.contains(btn));
  btn.click();
  check('it opens a menu', id('helpMenu').classList.contains('show'));
  check('one of the options is the guided tour',
    [...id('helpMenu').querySelectorAll('button')].some(b => /guided tour/i.test(b.textContent)));
  doc.body.click();
  check('clicking elsewhere closes it', !id('helpMenu').classList.contains('show'));

  console.log('\n── Every step points at something real ──');
  const missing = STEPS.filter(s => !(typeof s.at === 'function' ? s.at() : doc.querySelector(s.at))).map(s => title(s, 3));
  check('no step highlights nothing', missing.length === 0, `missing: ${missing.join(', ')}`);
  check('every step says who it is for, or is for anyone', STEPS.every(s => !s.who || s.who in WHO));

  console.log('\n── Left to right ──');
  const order = [...doc.querySelectorAll('#posSubtabs button')].map(b => b.dataset.tab);
  const seq = STEPS.filter(s => s.tab).map(s => order.indexOf(s.tab));
  check('steps follow the tabs in the order they sit', seq.every((v, i) => i === 0 || v >= seq[i - 1]), seq.join(','));
  check('every tab is covered', order.every(t => STEPS.some(s => s.tab === t)));
  check('it starts on the leftmost tab', STEPS[0].tab === order[0]);

  console.log('\n── Each PIN sees what it opens, and no more ──');
  const titles = (rank) => STEPS.filter(s => WHO[s.who || 'any'](rank)).map(s => title(s, rank));
  const none = titles(0), sales = titles(1), manager = titles(2), admin = titles(3);
  check('without a PIN: the register is there', none.includes('Tap to add'));
  check('without a PIN: no transactions table', !none.includes('Transaction history'));
  check('without a PIN: told Transactions needs one', STEPS.some(s => s.who === 'nopin' && s.tab === 'history'));
  check('without a PIN: no settings sections', !none.includes('Store details'));
  check('sales: their own commission', sales.includes('Your sales & commission'));
  check('sales: their transactions', sales.includes('Transaction history'));
  check('sales: no payroll', !sales.includes('Payroll'));
  check('sales: no audit', !sales.includes('Nightly reconciliation'));
  check('sales: no store settings', !sales.includes('Store details'));
  check('sales: can change their own PIN', sales.includes('Change your PIN'));
  check('manager: audits and settings', manager.includes('Nightly reconciliation') && manager.includes('Store details'));
  check('manager: not the shop-wide reports only an admin opens', !manager.includes('Payroll'));
  check('manager: not the sales-only PIN step', !manager.includes('Change your PIN'));
  check('admin: payroll, products and everyone’s commission',
    admin.includes('Payroll') && admin.includes('Top products') && admin.includes('Everyone’s commission'));
  check('nobody verified is told they need a PIN', ![1, 2, 3].some(r => STEPS.some(s => s.who === 'nopin' && WHO.nopin(r))));

  let switched = 0;
  const realSwitch = w.switchTab;
  w.switchTab = (...a) => { switched++; return realSwitch(...a); };
  const home = whereAmI();

  console.log('\n── Signing in ──');
  w.startTour();
  check('it asks for a name and PIN first', !!id('tourName') && !!id('tourPin'));
  id('tourName').value = 'Bo'; id('tourPin').value = '0000';
  await w.tourSignIn(); await settle();
  check('a wrong PIN is refused and says so', /Invalid/.test(id('tourErr').textContent) && w.eval('tour.i') === -1);
  w.endTour(); await settle();

  console.log('\n── A sales employee sees their own real data ──');
  calls.length = 0;
  await signIn('Bo', '1111');
  check('the tour starts at the sales level', w.eval('tour.i') === 0 && w.eval('tour.rank') === 1);

  await go('Tap to add');
  check('the register lights up a real product', lit()?.classList.contains('product-tile') && /Hydra Serum/.test(said()), said());

  await go('Your sales & commission');
  check('their commission row is lit, not the empty card', lit()?.tagName === 'TR' && id('empPersonalBody').contains(lit()));
  check('and the card reads their figures off it', /\$25\.00 commission/.test(said()), said());
  check('it asked the server with their own PIN',
    calls.some(c => /employee-personal/.test(c.url) && JSON.parse(c.body).pin === '1111'));

  await go('Transaction history');
  check('a real sale is lit', lit()?.tagName === 'TR' && id('txHistoryBody').contains(lit()));
  check('and named — receipt, customer, total', /R-1042/.test(said()) && /Dana Lee/.test(said()) && /\$96\.29/.test(said()), said());
  check('as read-only, for a sales employee', /read-only/.test(said()));
  check('its tables are not hidden once they are theirs', !id('tab-history').classList.contains('tour-mask'));
  check('asked with their PIN', calls.some(c => /transactions\/mine/.test(c.url) && JSON.parse(c.body).pin === '1111'));

  await go('Customers');
  check('a real customer is lit', lit()?.tagName === 'TR' && /Dana Lee has spent \$96\.29/.test(said()), said());

  await go('Treatments');
  check('a real treatment is lit, read from its form', /LED Facial, 45 minutes/.test(said()), said());

  await go('Change your PIN');
  check('Settings shows only their own PIN change',
    id('empSelfView').style.display !== 'none' && id('settingsManagerOnly').style.display === 'none');
  check('Settings asked the server for nothing a manager would see',
    !calls.some(c => /api\/pos\/settings$/.test(c.url.split('?')[0])));

  check('it never called switchTab', switched === 0);
  check('no request carried anyone else’s PIN',
    calls.every(c => !c.body || !/"pin"/.test(c.body) || JSON.parse(c.body).pin === '1111'));

  console.log('\n── Ending it locks everything again ──');
  w.endTour(); await settle();
  check('the tour is gone', id('tourLayer').hidden && w.eval('tour') === null);
  check('nothing is left open, and the PIN is gone', nothingOpen());
  check('the sales it loaded are emptied', id('txHistoryBody').innerHTML.trim() === '');
  check('the customers too', id('custReportBody').innerHTML.trim() === '');
  check('and their commission', id('empPersonalBody').innerHTML.trim() === '');
  check('no tab carries the mask', !doc.querySelector('.tour-mask'));
  { const d = diff(home, whereAmI()); check('you are back where you were', d.length === 0, d.slice(0, 4).join('\n        ')); }
  check('Transactions asks for a PIN again', (w.switchTab('history'), id('txAuthModal').classList.contains('show')));
  w.closeTxAuth(); switched = 0;

  console.log('\n── An admin ──');
  await signIn('Ana', '4321');
  check('at the admin level', w.eval('tour.rank') === 3);
  await go('Everyone’s commission');
  check('the whole shop’s reports were opened with their PIN',
    calls.some(c => /employee-personal/.test(c.url) && JSON.parse(c.body).pin === '4321'));
  await go('Store details');
  check('a manager is shown the manager settings', id('settingsManagerOnly').style.display !== 'none');
  check('the step card names what is lit', /Store details/.test(doc.querySelector('.tour-card').textContent));
  w.endTour(); await settle();
  check('locked again afterwards', nothingOpen());

  console.log('\n── When the server says no ──');
  refuseTransactions = true;
  await signIn('Bo', '1111');
  await go('Transaction history');
  check('no row is lit that the server did not send', lit()?.tagName !== 'TR');
  check('and whatever was in the table stays hidden', id('tab-history').classList.contains('tour-mask'));
  check('the card falls back to saying what the section is', /Open a sale to see its receipt/.test(said()), said());
  w.endTour(); await settle();
  refuseTransactions = false;
  check('nothing left open', nothingOpen());

  console.log('\n── Whoever had it open gets it back ──');
  w.eval('txCreds = { name: "Cy", pin: "2222" }; txAccess = { id: 3, name: "Cy", role: "manager" }');
  calls.length = 0;
  await signIn('Bo', '1111');
  await go('Transaction history');
  check('during the tour the sales are Bo’s', w.eval('txCreds.pin') === '1111');
  w.endTour(); await settle();
  check('afterwards Transactions is Cy’s again', w.eval('txCreds && txCreds.pin') === '2222' && w.eval('txAccess && txAccess.name') === 'Cy');
  check('and was reloaded as Cy', calls.filter(c => /transactions\/mine/.test(c.url)).pop()?.body.includes('"2222"'));
  w.eval('txCreds = null; txAccess = null');

  console.log('\n── Ending it mid-load ──');
  calls.length = 0;
  await signIn('Bo', '1111');
  const pending = w.eval('tourGo(tour.steps.findIndex(s => s.tab === "history"))'); // not awaited
  w.endTour();
  await pending; await settle(); await settle();
  check('a reply that lands after the end does not reopen the tab', nothingOpen());

  console.log('\n── Without a PIN ──');
  const beforeNoPin = whereAmI();
  w.startTour();
  await w.tourBegin(0);
  const steps0 = w.eval('tour.steps.map(s => s.who || "any")');
  check('only steps for anyone, or for having no PIN', steps0.every(x => x === 'any' || x === 'nopin'));
  await go('Today’s leaderboard');
  check('the public leaderboard still shows who is in front', /Bo is out in front today/.test(said()), said());
  await w.eval('tourGo(tour.steps.findIndex(s => s.tab === "history"))'); await settle();
  check('Transactions stays hidden', id('tab-history').classList.contains('tour-mask'));
  check('and nothing was asked of it', !calls.some(c => /transactions\/mine/.test(c.url) && !/"1111"/.test(c.body || '')));
  await w.eval('tourGo(tour.steps.findIndex(s => s.tab === "settings"))'); await settle();
  check('Settings shows none of its gated sections',
    id('settingsManagerOnly').style.display === 'none' && id('empManagerView').style.display === 'none' && id('empSelfView').style.display === 'none');
  const esc = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  doc.dispatchEvent(esc); await settle();
  check('Escape ends it', w.eval('tour') === null);
  { const d = diff(beforeNoPin, whereAmI()); check('and it is put back afterwards', d.length === 0, d.slice(0, 4).join('\n        ')); }

  console.log('\n── Offered once, the first time ──');
  const offer = id('tourOffer');
  w.eval('currentUser = { email: "Owner@GlowSF.com" }');
  w.localStorage.store = {};
  w.offerTourOnce();
  check('a first visit is offered the tour', !offer.hidden);
  check('beside the help button', id('helpMenuWrap').contains(offer));
  w.offerTourOnce();
  check('a reload before answering asks again', !offer.hidden);
  w.answerTourOffer(false);
  check('No thanks puts it away', offer.hidden && w.eval('tour') === null);
  w.offerTourOnce();
  check('and it is not offered again', offer.hidden);
  w.eval('currentUser = { email: "someone@else.com" }');
  w.offerTourOnce();
  check('another account on the same till is offered it', !offer.hidden);
  w.answerTourOffer(true);
  check('Take the tour starts it', w.eval('tour') !== null && !!id('tourName'));
  w.endTour();
  w.offerTourOnce();
  check('and it is not offered again after that either', offer.hidden);
  w.eval('currentUser = { email: "third@shop.com" }');
  id('txAuthModal').classList.add('show');
  w.offerTourOnce();
  check('not on top of a PIN prompt already open', offer.hidden);
  id('txAuthModal').classList.remove('show');
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
  w.offerTourOnce();
  check('with storage blocked it is never offered, rather than every time', offer.hidden);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 300);
