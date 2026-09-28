'use strict';
// The Chargebacks panel says it shows "every dispute touching this person's
// sales, whether it has come off a paycheck yet or not". It showed three
// kinds: still to come off pay, already held, and released onto a later
// cheque. A dispute WON before any cheque ever held it is none of those, so
// it appeared nowhere — and to the person reading the page, a dispute they
// remember had simply vanished.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('offline'));
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

// Rebecca's real shape, as /reports/chargebacks returns it.
const WON_NEVER_HELD = {
  chargeback_id: 16, status: 'won', receipt_number: '1502-1268LC2', sale_date: '2026-07-24',
  customer_name: 'A Customer', store_name: 'Glow SF', closed_at: '2026-09-15',
  withheld_payday: null, commission_at_risk: 1224, employee_name: 'Rebecca',
};
const WON_HELD_BUT_CHEQUE_OPEN = { ...WON_NEVER_HELD, chargeback_id: 17, commission_at_risk: 360, withheld_payday: '2026-09-15' };
const LOST_NEVER_HELD = { ...WON_NEVER_HELD, chargeback_id: 18, status: 'lost', commission_at_risk: 500, withheld_payday: null };

setTimeout(() => {
  console.log('\n── A dispute won before anything was held ──');
  let out = w.eval(`renderSettledChargebacks(${JSON.stringify([WON_NEVER_HELD])})`);
  check('it is on the page at all', /1502-1268LC2/.test(out), out.slice(0, 120));
  check('it says it was won', /Won —/.test(out));
  check('and that nothing was ever held', /nothing was ever held/.test(out));
  check('with the commission it involved', /1,224\.00/.test(out), out);
  check('and the date it closed', /2026-09-15/.test(out));

  console.log('\n── Won, but the cheque holding it never went out ──');
  out = w.eval(`renderSettledChargebacks(${JSON.stringify([WON_HELD_BUT_CHEQUE_OPEN])})`);
  check('says nothing was taken', /nothing was taken/.test(out), out);

  console.log('\n── Lost, never withheld ──');
  out = w.eval(`renderSettledChargebacks(${JSON.stringify([LOST_NEVER_HELD])})`);
  check('says it came off pay', /Lost —/.test(out) && /taken off the paycheck/.test(out), out);
  check('and is coloured as a loss', /var\(--danger\)/.test(out));

  console.log('\n── Nothing settled ──');
  check('renders nothing at all', w.eval('renderSettledChargebacks([])') === '');
  check('and copes with no argument', w.eval('renderSettledChargebacks(undefined)') === '');

  console.log('\n── A typed customer name cannot inject markup ──');
  const nasty = { ...WON_NEVER_HELD, customer_name: '<img src=x onerror=alert(1)>' };
  out = w.eval(`renderSettledChargebacks(${JSON.stringify([nasty])})`);
  check('the name is escaped', !out.includes('<img') && out.includes('&lt;img'), out.slice(0, 200));

  console.log('\n── The empty-state line no longer claims there is nothing ──');
  const empty = w.eval('renderPendingChargebacks([], [], false)');
  check('it points at the settled list', /already been settled are listed below/.test(empty), empty);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 600);
