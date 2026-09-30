'use strict';
// The guided tour, from the help menu beside the company switcher.
//
// It walks the tabs left to right, lighting up each thing it describes, and
// asks for a name and PIN first so each person is shown only what their own
// PIN opens. What it must never do is get anyone PAST a PIN: it verifies to
// learn a role and nothing else, never calls switchTab, fetches no tab's data,
// and leaves the page exactly as it found it.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const calls = [];
let verifyReply = { ok: true, body: { employee: { id: 1, name: 'Ana' }, role: 'admin' } };
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body });
      if (/employees\/verify/.test(url)) {
        return Promise.resolve({ ok: verifyReply.ok, json: async () => verifyReply.body });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
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
const tick = () => new Promise(r => setTimeout(r, 0));

// Everything the tour is allowed to touch, as it stands. Compared before and
// after, so "put back as it was" is checked rather than assumed.
const snapshot = () => [...doc.querySelectorAll(
  '.tab-content, #posSubtabs button, .tx-view-btn, #settingsSubtabs .sub-btn, [data-sgroup], #emailsNav button, ' +
  '.rpt-section, #rptLayout, #rptNav, #reportsDateFilter, #empPersonalReport, #empPersonalTableWrap, #rptEveryoneCard, ' +
  '#rptReturnsCard, #txViewSales, #txViewAudit, #txViewCustomers, #emailViewWelcome, #emailViewMass, ' +
  '#settingsManagerOnly, #empManagerView, #empSelfView')]
  .map(el => `${el.id || el.textContent.trim().slice(0, 20)}|${el.className}|${el.style.cssText}`).join('\n');

setTimeout(async () => {
  const STEPS = w.eval('TOUR_STEPS');
  const WHO = w.eval('TOUR_WHO');

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
  const missing = STEPS.filter(s => {
    const el = typeof s.at === 'function' ? (w.eval('tour = { undo: [], rank: 3 }'), s.at()) : doc.querySelector(s.at);
    return !el;
  }).map(s => typeof s.title === 'function' ? s.title(3) : s.title);
  w.eval('tour = null');
  check('no step highlights nothing', missing.length === 0, `missing: ${missing.join(', ')}`);
  check('every step says who it is for, or is for anyone', STEPS.every(s => !s.who || s.who in WHO));

  console.log('\n── Left to right ──');
  const order = [...doc.querySelectorAll('#posSubtabs button')].map(b => b.dataset.tab);
  const seq = STEPS.filter(s => s.tab).map(s => order.indexOf(s.tab));
  check('steps follow the tabs in the order they sit', seq.every((v, i) => i === 0 || v >= seq[i - 1]),
    `order seen: ${seq.join(',')}`);
  check('every tab is covered', order.every(t => STEPS.some(s => s.tab === t)));
  check('it starts on the leftmost tab', STEPS[0].tab === order[0]);

  console.log('\n── Each PIN sees what it opens, and no more ──');
  const titles = (rank) => STEPS.filter(s => WHO[s.who || 'any'](rank))
    .map(s => typeof s.title === 'function' ? s.title(rank) : s.title);
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
  check('admin: payroll and products', admin.includes('Payroll') && admin.includes('Top products'));
  check('nobody verified is told they need a PIN', ![1, 2, 3].some(r => STEPS.some(s => s.who === 'nopin' && WHO.nopin(r))));

  console.log('\n── Signing in ──');
  let switched = 0;
  const realSwitch = w.switchTab;
  w.switchTab = (...a) => { switched++; return realSwitch(...a); };
  const before = snapshot();
  w.startTour();
  check('it asks for a name and PIN first', !!id('tourName') && !!id('tourPin'));
  id('tourName').value = 'Ana'; id('tourPin').value = '0000';
  verifyReply = { ok: false, body: { error: 'Invalid name or PIN' } };
  await w.tourSignIn(); await tick();
  check('a wrong PIN is refused and says so', /Invalid/.test(id('tourErr').textContent) && w.eval('tour.i') === -1);
  verifyReply = { ok: true, body: { employee: { id: 1, name: 'Ana' }, role: 'admin' } };
  id('tourPin').value = '4321';
  calls.length = 0;
  await w.tourSignIn(); await tick();
  check('a right one starts the tour', w.eval('tour.i') === 0);
  check('at the admin level', w.eval('tour.rank') === 3);
  check('it checked against the real verify endpoint', calls.some(c => /employees\/verify/.test(c.url) && /4321/.test(c.body)));
  check('the PIN is not kept', !JSON.stringify(w.eval('({ rank: tour.rank, steps: tour.steps.length, i: tour.i })')).includes('4321')
    && !w.eval('Object.values(tour).some(v => typeof v === "string" && v.includes("4321"))'));
  check('it unlocked nothing', w.eval('settingsAccess') === null && w.eval('txAccess') === null);

  console.log('\n── Going through it ──');
  calls.length = 0;
  const n = w.eval('tour.steps.length');
  const seenTabs = [];
  for (let i = 0; i < n; i++) {
    w.eval(`tourGo(${i})`);
    const shown = doc.querySelector('.tab-content.show');
    if (shown && seenTabs[seenTabs.length - 1] !== shown.id) seenTabs.push(shown.id);
  }
  check('every tab is shown in turn, left to right',
    seenTabs.join(',') === order.map(t => `tab-${t}`).join(','), seenTabs.join(','));
  check('it never called switchTab', switched === 0);
  check('it fetched nothing on the way', calls.length === 0, calls.map(c => c.url).join(', '));
  check('still nothing unlocked', w.eval('settingsAccess') === null && w.eval('txAccess') === null);

  w.eval('tourGo(tour.steps.findIndex(s => s.tab === "history"))');
  check('a locked tab shown by the tour hides its tables', id('tab-history').classList.contains('tour-mask'));
  w.eval('tourGo(tour.steps.findIndex(s => s.tab === "reports" && s.view))');
  check('so do the reports it opens up', id('rptLayout').classList.contains('tour-mask'));
  w.eval('tourGo(tour.steps.findIndex(s => s.title === "Store details"))');
  check('a manager is shown the manager settings', id('settingsManagerOnly').style.display === '');
  check('the step card names what is lit', /Store details/.test(doc.querySelector('.tour-card').textContent));

  console.log('\n── Leaving it ──');
  w.endTour();
  check('the tour is gone', id('tourLayer').hidden && w.eval('tour') === null);
  { const a = before.split("\n"), b = snapshot().split("\n"); const d = a.map((x, i) => x !== b[i] ? `${x}  =>  ${b[i]}` : null).filter(Boolean); check("the page is exactly as it was", d.length === 0, d.slice(0, 5).join("\n        ")); }
  check('no tab carries the mask', !doc.querySelector('.tour-mask'));

  console.log('\n── Without a PIN ──');
  w.startTour();
  w.tourBegin(0);
  const steps0 = w.eval('tour.steps.map(s => s.who || "any")');
  check('only steps for anyone, or for having no PIN', steps0.every(x => x === 'any' || x === 'nopin'));
  w.eval('tourGo(tour.steps.findIndex(s => s.tab === "settings"))');
  check('Settings shows none of its gated sections',
    id('settingsManagerOnly').style.display === 'none' && id('empManagerView').style.display === 'none' && id('empSelfView').style.display === 'none');
  w.endTour();
  check('and is put back afterwards', snapshot() === before);

  console.log('\n── A sales employee ──');
  w.startTour();
  w.tourBegin(1);
  w.eval('tourGo(tour.steps.findIndex(s => s.title === "Change your PIN"))');
  check('Settings shows only their own PIN change',
    id('empSelfView').style.display === '' && id('settingsManagerOnly').style.display === 'none');
  w.eval('tourGo(tour.steps.findIndex(s => s.tab === "reports" && s.view))');
  check('the everyone-commission table stays hidden', id('rptEveryoneCard').style.display === 'none');
  const esc = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  doc.dispatchEvent(esc);
  check('Escape ends it', w.eval('tour') === null);
  check('and is put back afterwards', snapshot() === before);

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
