'use strict';
// The block at the foot of the commission table that says what actually gets
// paid.
//
// Three things about it were misreading, all on the admin's screen, and all
// worse once payroll started spanning both linked shops:
//
//   1. It sits directly under a table that obeys the date boxes above it,
//      while the block itself is always a chosen PAYCHECK. The two are almost
//      never the same period, so $2,300 of sales in the table above $26,019.37
//      of commission below looked like a bug rather than two questions.
//
//   2. "Released — dispute won" appeared four times with no name on any of
//      it. It was two disputes belonging to two people who split the sales
//      50/50 — but read as one dispute counted four times.
//
//   3. The per-shop breakdown emitted a line per ROW. One person across two
//      shops is two lines, which is what it was written for; fifteen people
//      across two shops is thirty.
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
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

// Rebecca's real cheque, and Sal's half of the same two split sales.
const REBECCA_GLOW = {
  employee_id: 2, employee_name: 'Rebecca', store_name: 'Glow SF',
  commission_earned: 810, adjustment_total: 930.6, total: 1740.6,
  adjustments: [
    { kind: 'won', amount: 1224, receipt: '1502-1268LC2' },
    { kind: 'won', amount: 360, receipt: '1502-1266LC2' },
    { kind: 'carry', amount: -653.4, note: 'negative amount carried from the 2026-09-15 paycheck' },
  ],
};
const REBECCA_DW = {
  employee_id: 43, employee_name: 'Rebecca', store_name: 'Desert Wellness',
  commission_earned: 377.46, adjustment_total: -500, total: -122.54,
  adjustments: [{ kind: 'manual', amount: -500, note: 'cash advance' }],
};
const SAL_GLOW = {
  employee_id: 1, employee_name: 'Sal', store_name: 'Glow SF',
  commission_earned: 16733.25, adjustment_total: 1980, total: 18713.25,
  adjustments: [
    { kind: 'won', amount: 1530, receipt: '1502-1268LC2' },
    { kind: 'won', amount: 450, receipt: '1502-1266LC2' },
  ],
};

const render = (rows, extra = {}) => {
  w.eval(`renderPaySummary(${JSON.stringify({
    payday: '2026-10-01', period: { start: '2026-09-01', end: '2026-09-15' }, rows, ...extra,
  })})`);
  return id('empPersonalPaySummary');
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

setTimeout(() => {
  console.log('\n── One person, across both shops ──');
  let el = render([REBECCA_GLOW, REBECCA_DW]);
  let t = text(el);
  check('both shops are named', /Glow SF/.test(t) && /Desert Wellness/.test(t), t.slice(0, 200));
  check('her Glow SF commission is there', /810\.00/.test(t));
  check('and her Desert Wellness commission', /377\.46/.test(t));
  check('the advance from the other shop is on the cheque', /cash advance/.test(t) && /500\.00/.test(t));
  check('which comes to the figure on her own screen', /1,618\.06/.test(t), t.slice(-160));
  check('one shop line per shop, not per row',
    (t.match(/Glow SF/g) || []).length === 1, `${(t.match(/Glow SF/g) || []).length} mentions`);
  check('nobody is named when the cheque is one person\'s', !/Rebecca/.test(t));

  console.log('\n── The paycheck says which period it is ──');
  check('the payday is on it', /Oct 1, 2026/.test(t), t.slice(0, 140));
  check('and the period it was earned in', /Sep 1, 2026/.test(t) && /Sep 15, 2026/.test(t), t.slice(0, 140));

  console.log('\n── Everyone at once: whose line is whose ──');
  el = render([REBECCA_GLOW, REBECCA_DW, SAL_GLOW]);
  t = text(el);
  check('two people are counted', /2 people/.test(t), t.slice(0, 180));
  check('Rebecca is named on her releases', /Rebecca · Released/.test(t), t.slice(0, 400));
  check('Sal is named on his', /Sal · Released/.test(t));
  const rel = (t.match(/Released — dispute won/g) || []).length;
  check('all four release lines are still shown', rel === 4, `${rel} lines`);
  check('the same receipt appears for both people',
    (t.match(/1502-1268LC2/g) || []).length === 2);
  check('the two split halves are both there', /1,224\.00/.test(t) && /1,530\.00/.test(t));
  check('the total is everyone, and says so', /Total on this paycheck — everyone/.test(t));
  check('and it adds up', /20,331\.31/.test(t), t.slice(-200));

  console.log('\n── No shop breakdown on an all-employees report ──');
  // The table above it already names the shop on every employee's row. A
  // column of bare shop names and amounts under it says nothing more, and
  // whose any of it is cannot be told — which is how twenty-three unlabelled
  // amounts ended up under a report that was supposed to be the commissions.
  const many = [];
  for (let i = 0; i < 15; i++) {
    many.push({ employee_id: 100 + i, employee_name: `P${i}`, store_name: 'Glow SF',
      commission_earned: 100, adjustment_total: 0, total: 100, adjustments: [] });
    many.push({ employee_id: 200 + i, employee_name: `P${i}`, store_name: 'Desert Wellness',
      commission_earned: 50, adjustment_total: 0, total: 50, adjustments: [] });
  }
  el = render(many);
  t = text(el);
  const storeLines = (t.match(/Glow SF/g) || []).length + (t.match(/Desert Wellness/g) || []).length;
  check('not one shop line among thirty rows', storeLines === 0, `${storeLines} shop mentions`);
  check('the earned total is still all of it', /2,250\.00/.test(t), t.slice(0, 200));
  check('and it still says how many people', /15 people/.test(t), t.slice(0, 200));

  console.log('\n── One shop stays quiet about it ──');
  el = render([REBECCA_GLOW]);
  t = text(el);
  check('no shop breakdown for a single shop', !/Desert Wellness/.test(t));
  check('the shop is not listed under itself',
    (t.match(/Glow SF/g) || []).length === 0, t.slice(0, 160));
  check('and the plain wording comes back', /Commission on the upcoming paycheck/.test(t));

  console.log('\n── Nothing to show ──');
  w.eval('renderPaySummary(null)');
  check('an empty summary is empty', id('empPersonalPaySummary').innerHTML === '');
  w.eval('renderPaySummary({ rows: [] })');
  check('and so is a paycheck with no rows', id('empPersonalPaySummary').innerHTML === '');

  console.log('\n── A held line still moves no money ──');
  el = render([{ ...REBECCA_GLOW, adjustments: [
    { kind: 'held', amount: 0, receipt: 'ZZ-1' },
    { kind: 'won', amount: 1224, receipt: '1502-1268LC2' }] }]);
  check('it is left off', !/ZZ-1/.test(text(el)), text(el).slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
