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

  console.log('\n── The dispute is changed on its own row ──');
  const row = () => id('cbExisting');
  const rowSelect = () => row().querySelector('select');
  const rowButtons = () => [...row().querySelectorAll('button')].map(b => b.textContent.trim());

  check('the row carries a status dropdown', !!rowSelect(), true);
  check('showing where it stands', rowSelect().value, 'pending');
  check('no Save until something is changed', rowButtons().includes('Save'), false);
  check('the add form is put away — nothing left to add', id('cbAddForm').hidden, true);
  check('its button goes with it', id('cbSaveBtn').hidden, true);
  check('only one status control is on screen', row().querySelectorAll('select').length
    + (id('cbAddForm').hidden ? 0 : 1), 1);
  check('and it says why', /already disputed/.test(id('cbAddNothing').textContent), true);

  console.log('\n── Pick "Closed won" on the row ──');
  w.eval("chargebackRowStatus(77, 'won')");
  check('a Save appears on the row', rowButtons().includes('Save'), true);
  check('so does a Cancel', rowButtons().includes('Cancel'), true);
  check('a close date is offered, defaulted to today',
    row().querySelector('input[type=date]').value, new Date().toISOString().slice(0, 10));
  check('it spells out what won means for the money',
    /held-back commission is paid/.test(row().textContent), true);

  console.log('\n── Press Save on the row ──');
  calls.length = 0;
  w.eval("chargebackRowDate(77, '2026-09-15'); saveChargebackRow(77)");
  setTimeout(() => {
    const posted = calls.filter(c => c.method === 'POST').pop();
    check('it updates that dispute', posted && posted.body.id, 77);
    check('to closed won', posted && posted.body.status, 'won');
    check('on the date given', posted && posted.body.closed_at, '2026-09-15');
    check('keeping its amount', posted && posted.body.amount, 8763.19);
    check('and its card', posted && posted.body.card_last4, '9625');

    console.log('\n── Closing one needs a date ──');
    w.eval(`
      chargebackTarget.chargebacks = [{ id: 77, amount: 8763.19, card_last4: '9625', status: 'pending', closed_at: null, note: '' }];
      renderChargebackList();
      chargebackRowStatus(77, 'lost');
      chargebackRowDate(77, '');
    `);
    calls.length = 0;
    w.eval('saveChargebackRow(77)');
    check('it refuses to save without one', calls.filter(c => c.method === 'POST').length, 0);
    check('and says why', /date the dispute closed/.test(id('cbError').textContent), true);

    console.log('\n── Back to pending needs no date ──');
    w.eval(`
      chargebackTarget.chargebacks = [{ id: 77, amount: 8763.19, card_last4: '9625', status: 'won', closed_at: '2026-09-15', note: '' }];
      cbRowEdits = {}; renderChargebackList();
      chargebackRowStatus(77, 'pending');
    `);
    check('no date field is asked for', !row().querySelector('input[type=date]'), true);
    calls.length = 0;
    w.eval('saveChargebackRow(77)');
    setTimeout(() => {
      const p2 = calls.filter(c => c.method === 'POST').pop();
      check('it saves as pending', p2 && p2.body.status, 'pending');
      check('clearing the close date', p2 && p2.body.closed_at, null);

      console.log('\n── Cancel puts the row back ──');
      w.eval(`
        chargebackTarget.chargebacks = [{ id: 77, amount: 8763.19, card_last4: '9625', status: 'pending', closed_at: null, note: '' }];
        cbRowEdits = {}; renderChargebackList();
        chargebackRowStatus(77, 'won');
      `);
      check('Save is showing', rowButtons().includes('Save'), true);
      w.eval('cancelChargebackRow(77)');
      check('Cancel clears it', rowButtons().includes('Save'), false);
      check('and the dropdown is back where it was', rowSelect().value, 'pending');

      console.log('\n── A sale with room left can still add another card ──');
      w.eval(`
        chargebackTarget.chargebacks = [{ id: 79, amount: 3000, card_last4: '9625', status: 'pending', closed_at: null, note: '' }];
        cbRowEdits = {}; renderChargebackList(); resetChargebackForm();
      `);
      check('the add form is back', id('cbAddForm').hidden, false);
      check('and its button', id('cbSaveBtn').hidden, false);
      check('labelled for what it does', id('cbSaveBtn').textContent, 'Add another dispute');
      check('prefilled with what is left', id('cbAmount').value, '5763.19');
      calls.length = 0;
      id('cbCard').value = '4242';
      w.eval('saveChargeback()');
      setTimeout(() => {
        const p3 = calls.filter(c => c.method === 'POST').pop();
        check('which posts a new dispute, not an update', p3 && p3.body.id, null);
        check('for the balance', p3 && p3.body.amount, 5763.19);

        console.log(`\n${pass} passed, ${fail} failed\n`);
        process.exit(fail ? 1 : 0);
      }, 200);
    }, 200);
  }, 200);
}, 600);
