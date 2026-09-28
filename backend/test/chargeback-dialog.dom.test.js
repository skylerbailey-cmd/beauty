'use strict';
// Drive the chargeback dialog the way the screenshot shows it: a sale whose
// whole amount is already disputed, pending, and someone wants it closed won.
const fs = require('fs');
const path = require('path');

// jsdom is a test convenience, not a dependency the server carries. Skip
// cleanly when it isn't installed.
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const calls = [];
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      // The chargebacks re-read after a save
      if (/\/chargebacks$/.test(String(url)) && (opts.method || 'GET') === 'GET') {
        return Promise.resolve({ ok: true, json: async () => ({ chargebacks: [] }) });
      }
      // Behave like the real server: adding a second dispute to a sale that is
      // already fully disputed is refused.
      const body = opts.body ? JSON.parse(opts.body) : {};
      if ((opts.method || 'GET') === 'POST' && !body.id) {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'This sale is already fully disputed ($8763.19).' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = (m) => { w.__alert = m; };
    w.confirm = () => true;
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const $ = (s) => w.document.querySelector(s);
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok) console.log(`        expected ${JSON.stringify(e)}\n        actual   ${JSON.stringify(a)}`);
  ok ? pass++ : fail++;
};

setTimeout(() => {
  // The sale from the screenshot.
  w.eval(`
    txCreds = { name: 'admin', pin: '5555' };
    histTransactions = [];
    window.applyTxFilters = () => {};
    const sale = {
      id: 991, receipt_number: '1501-1411LC1', total: 8763.19,
      customer_name: 'GLORIA HAWS', created_at: '2026-08-26T18:00:00Z',
      type: 'sale', charged_back: 1,
      payments: [{ method: 'card', card_last4: '9625', amount: 8763.19 }],
      chargebacks: [{ id: 77, amount: 8763.19, card_last4: '9625', status: 'pending', closed_at: null, note: '' }],
    };
    openChargebackModal(sale);
  `);

  console.log('\n── A fully disputed sale opens ready to change what is there ──');
  check('the existing dispute is listed', !!$('#cbExisting button'), true);
  check('it opens in edit mode, not add mode', id('cbSaveBtn').textContent, 'Update dispute');
  check('the dispute is already loaded', w.eval('chargebackEditId'), 77);
  check('its amount is in the box', id('cbAmount').value, '8763.19');
  check('its card is in the box', id('cbCard').value, '9625');
  check('the row says it is the one being edited', /Editing/.test(id('cbExisting').textContent), true);
  check('it says nothing is left to add', /\$0\.00 left/.test(id('cbExisting').textContent), true);
  check('the save button is live', id('cbSaveBtn').disabled, false);

  console.log('\n── Moving it from pending to closed won ──');
  {
    id('cbStatus').value = 'won';
    w.eval('updateChargebackForm()');
    id('cbClosedAt').value = '2026-09-28';
    w.eval('saveChargeback()');
  }
  setTimeout(() => {
    const posted = calls.filter(c => c.method === 'POST').pop();
    check('it UPDATES the dispute rather than adding one', posted && posted.body.id, 77);
    check('with the new status', posted && posted.body.status, 'won');
    check('and the close date', posted && posted.body.closed_at, '2026-09-28');

    console.log('\n── Edit still works when reached by hand ──');
    calls.length = 0;
    w.eval(`
      chargebackTarget.chargebacks = [
        { id: 77, amount: 4000, card_last4: '9625', status: 'pending', closed_at: null, note: '' },
        { id: 78, amount: 4763.19, card_last4: '1111', status: 'pending', closed_at: null, note: '' }
      ];
      renderChargebackList(); resetChargebackForm();
    `);
    check('two disputes covering it all: no auto-edit', w.eval('chargebackEditId'), null);
    check('and adding is refused up front', id('cbSaveBtn').disabled, true);
    w.eval('editChargeback(77)');
    check('the button changes to Update', id('cbSaveBtn').textContent, 'Update dispute');
    check('the amount is loaded from the dispute', id('cbAmount').value, '4000.00');
    check('the card is loaded', id('cbCard').value, '9625');
    check('the status starts where it was', id('cbStatus').value, 'pending');
    check('the edit id is held', w.eval('chargebackEditId'), 77);
    check('editing re-enables the save button', id('cbSaveBtn').disabled, false);

    console.log('\n── A partly disputed sale can still take another card ──');
    w.eval(`
      chargebackTarget.chargebacks = [{ id: 79, amount: 3000, card_last4: '9625', status: 'pending', closed_at: null, note: '' }];
      renderChargebackList(); resetChargebackForm();
    `);
    check('no auto-edit when room is left', w.eval('chargebackEditId'), null);
    check('it offers to add another', id('cbSaveBtn').textContent, 'Add dispute');
    check('adding is allowed', id('cbSaveBtn').disabled, false);
    check('prefilled with what is left', id('cbAmount').value, '5763.19');

    // Adding that second card goes through as a NEW dispute, which is what
    // the add form is actually for.
    calls.length = 0;
    id('cbCard').value = '4242';
    w.eval('saveChargeback()');
    setTimeout(() => {
      const posted = calls.filter(c => c.method === 'POST').pop();
      check('adding another card posts a new dispute', posted && posted.body.id, null);
      check('for what was left of the sale', posted && posted.body.amount, 5763.19);

      console.log(`\n${pass} passed, ${fail} failed\n`);
      process.exit(fail ? 1 : 0);
    }, 200);
  }, 200);
}, 600);
