'use strict';
// Payroll: a Hide button beside each person's name collapses them to one line
// — their name and what they are owed — and Show opens them again. Which
// people are hidden is remembered in this browser, so they stay tucked away on
// the next payday. It changes nothing about the payroll itself.
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
const person = (name, earned, paid) => ({
  employee_name: name, store_name: 'Glow SF', employee_id: name.length, commission_rate: 10,
  sales_total: earned * 10, sale_count: 3, returns_netted: 0, commission_earned: earned,
  adjustments: [], total: earned, paid,
});
const PAYROLL = { payday: '2026-10-15', period: { start: '2026-09-16', end: '2026-09-30' }, paid: false,
  employees: [person('Mia', 120, false), person('Bo', 80, true)] };
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
const store = {};
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (url) => Promise.resolve({ ok: true, json: async () => (/reports\/payroll/.test(url) ? PAYROLL : { accepted: true }) });
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    Object.defineProperty(w, 'localStorage', { configurable: true, value: {
      getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } });
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
const shown = (el) => w.getComputedStyle(el).display !== 'none';

setTimeout(async () => {
  const load = async () => {
    w.eval(`personalCreds = { name: 'Ana', pin: '7777' };
      const sel = document.getElementById('payrollPayday');
      if (sel && !sel.options.length) sel.innerHTML = '<option value="2026-10-15" selected>Oct 15</option>';`);
    await w.loadPayroll();
  };
  await load();
  const rows = () => [...id('payrollBody').querySelectorAll('.pr-person')];
  check('each person has a Hide button beside their name', rows().length === 2
    && rows().every(r => r.querySelector('.pr-toggle')?.textContent === 'Hide'));
  check('and starts open, with their details showing', rows().every(r => shown(r.querySelector('.pr-detail')) && !shown(r.querySelector('.pr-summary'))));

  const mia = rows()[0];
  mia.querySelector('.pr-toggle').click();
  check('Hide collapses them', mia.classList.contains('collapsed') && !shown(mia.querySelector('.pr-detail')));
  check('to one line with what they are owed', shown(mia.querySelector('.pr-summary')) && /\$120\.00/.test(mia.querySelector('.pr-summary').textContent));
  check('and the button now says Show', mia.querySelector('.pr-toggle').textContent === 'Show'
    && mia.querySelector('.pr-toggle').getAttribute('aria-expanded') === 'false');
  check('the others are untouched', !rows()[1].classList.contains('collapsed'));
  check('the paycheck total is unchanged', /\$200\.00/.test(id('payrollBody').textContent));

  const bo = rows()[1];
  bo.querySelector('.pr-toggle').click();
  check('someone already paid says so when collapsed', /✓ Paid/.test(bo.querySelector('.pr-summary').textContent));

  await load();
  check('it is remembered when the payroll is drawn again', rows().every(r => r.classList.contains('collapsed')));
  rows()[0].querySelector('.pr-toggle').click();
  check('Show opens them again', !rows()[0].classList.contains('collapsed') && shown(rows()[0].querySelector('.pr-detail')));
  await load();
  check('and that is remembered too', !rows()[0].classList.contains('collapsed') && rows()[1].classList.contains('collapsed'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 300);
