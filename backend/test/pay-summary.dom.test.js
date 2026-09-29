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

setTimeout(async () => {
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

  console.log('\n── Two periods in one card, both labelled ──');
  // The table's dates are set far above it; the paycheck below covers a pay
  // period. They are almost never the same, which is how a table showing two
  // days of sales ended up under a paycheck covering a fortnight, with both
  // numbers looking wrong.
  id('rptStart').value = '2026-09-28';
  id('rptEnd').value = '2026-09-29';
  w.eval('renderCommissionRange()');
  check('the table says which dates it is answering for',
    /Sep 28, 2026 – Sep 29, 2026/.test(id('empReportRange').textContent),
    id('empReportRange').textContent);

  el = render([REBECCA_GLOW, REBECCA_DW]);
  check('and the paycheck offers to line them up',
    /show the table for these dates/.test(el.textContent), el.textContent.slice(0, 200));
  w.eval("showCommissionsFor('2026-09-01','2026-09-15')");
  check('clicking it moves the boxes',
    id('rptStart').value === '2026-09-01' && id('rptEnd').value === '2026-09-15',
    `${id('rptStart').value} .. ${id('rptEnd').value}`);
  w.eval('renderCommissionRange()');
  check('and the table relabels itself',
    /Sep 1, 2026 – Sep 15, 2026/.test(id('empReportRange').textContent),
    id('empReportRange').textContent);

  el = render([REBECCA_GLOW, REBECCA_DW]);
  check('with the periods matching, nothing is offered',
    !/show the table for these dates/.test(el.textContent), el.textContent.slice(0, 200));

  id('rptStart').value = '2026-09-03';
  id('rptEnd').value = '2026-09-03';
  w.eval('renderCommissionRange()');
  check('a single day reads as one date, not a range',
    id('empReportRange').textContent === 'Sep 3, 2026', id('empReportRange').textContent);

  console.log('\n── A report opens on the paycheck being worked towards ──');
  // Not on today. Today is a few hours of trading under a paycheck covering a
  // fortnight, which reads as the two figures disagreeing rather than as two
  // questions. This used to be skipped when the tab was reopened already
  // signed in — exactly the case where nothing has been picked.
  w.eval(`rptPaydays = [
    { payday: '2026-10-01', upcoming: true,  paid: false, period: { start: '2026-09-01', end: '2026-09-15' } },
    { payday: '2026-09-15', upcoming: false, paid: true,  period: { start: '2026-08-16', end: '2026-08-31' } }];
    rptDatesChosen = false;`);
  id('rptStart').value = '2026-09-29';
  id('rptEnd').value = '2026-09-29';
  await w.eval('defaultToUpcomingPaycheck()');
  check('the dates land on the upcoming pay period',
    id('rptStart').value === '2026-09-01' && id('rptEnd').value === '2026-09-15',
    `${id('rptStart').value} .. ${id('rptEnd').value}`);
  check('and that paycheck is the one selected',
    w.eval('rptSelectedPayday') === '2026-10-01', w.eval('rptSelectedPayday'));

  // Once somebody picks a period it is theirs, and nothing overrides it.
  w.eval("selectPaycheck('2026-09-15')");
  check('choosing an older cheque is remembered', w.eval('rptDatesChosen') === true);
  w.eval('rptStart.value = "2026-08-16"; rptEnd.value = "2026-08-31";');
  await w.eval('rptDatesChosen ? Promise.resolve(false) : defaultToUpcomingPaycheck()');
  check('and is not replaced by the upcoming one',
    id('rptStart').value === '2026-08-16' && id('rptEnd').value === '2026-08-31',
    `${id('rptStart').value} .. ${id('rptEnd').value}`);

  check('typing a date counts as choosing one',
    /rptDatesChosen = true/.test(w.document.getElementById('rptStart').getAttribute('onchange') || ''),
    w.document.getElementById('rptStart').getAttribute('onchange'));

  console.log('\n── Each shop on its own, then both ──');
  // An owner running two shops reads the commissions one shop at a time —
  // it is what each shop cost to run — and a single combined line makes that
  // a subtraction done by hand.
  const report = [
    { employee_id: 1, employee_name: 'Sal', company_name: 'Glow SF', commission_rate: 45,
      sale_count: 16, net_total: 30137.84, net_after_chargebacks: 30137.84, chargeback_total: 0 },
    { employee_id: 2, employee_name: 'Rebecca', company_name: 'Glow SF', commission_rate: 36,
      sale_count: 7, net_total: 2250, net_after_chargebacks: 2250, chargeback_total: 0 },
    { employee_id: 3, employee_name: 'Sal', company_name: 'Desert Wellness', commission_rate: 45,
      sale_count: 17, net_total: 37185, net_after_chargebacks: 37185, chargeback_total: 0 },
    { employee_id: 4, employee_name: 'Rebecca', company_name: 'Desert Wellness', commission_rate: 36,
      sale_count: 2, net_total: 1048.5, net_after_chargebacks: 1048.5, chargeback_total: 0 },
  ];
  w.eval(`lastEmployeesReport = ${JSON.stringify(report)}; renderManagerCommissions();`);
  const tbl = id('empReportBody').textContent.replace(/\s+/g, ' ');

  check('Glow SF gets its own subtotal', /All employees — Glow SF/.test(tbl), tbl.slice(-300));
  check('Desert Wellness gets its own', /All employees — Desert Wellness/.test(tbl));
  check('and both together is still the last line',
    /All employees — (Glow SF \+ Desert Wellness|Desert Wellness \+ Glow SF)/.test(tbl));

  // Glow SF: 30137.84*.45 + 2250*.36 = 13562.03 + 810 = 14372.03
  // Desert:  37185*.45   + 1048.50*.36 = 16733.25 + 377.46 = 17110.71
  check('the Glow SF subtotal is its own people', /14,372\.03/.test(tbl), tbl.slice(-400));
  check('the Desert Wellness subtotal is its own', /17,110\.71/.test(tbl));
  check('and the grand total is the two added up', /31,482\.74/.test(tbl), tbl.slice(-260));
  check('sale counts split the same way',
    /23/.test(tbl) && /19/.test(tbl) && /42/.test(tbl));

  console.log('\n── One shop needs no split ──');
  w.eval(`lastEmployeesReport = ${JSON.stringify(report.filter(r => r.company_name === 'Glow SF'))};
          renderManagerCommissions();`);
  const one = id('empReportBody').textContent.replace(/\s+/g, ' ');
  check('there is a single total', (one.match(/All employees/g) || []).length === 1,
    `${(one.match(/All employees/g) || []).length} total rows`);
  check('and the shop is not named twice over', !/All employees — Glow SF/.test(one), one.slice(-200));

  console.log('\n── A manager\'s share of the floor is named, per shop ──');
  // On top of their own sales, and a share of THAT shop — so it belongs
  // beside that shop's line. Without it their commission is simply bigger
  // than anything they rang up, with nothing on the cheque to say why.
  el = render([
    { employee_id: 1, employee_name: 'Sal', store_name: 'Glow SF',
      commission_earned: 16098.78, own_commission: 13562.03, store_commission: 2536.75,
      store_rate: 4, adjustment_total: 0, total: 16098.78, adjustments: [] },
    { employee_id: 45, employee_name: 'Sal', store_name: 'Desert Wellness',
      commission_earned: 20896.05, own_commission: 16733.25, store_commission: 4162.80,
      store_rate: 4, adjustment_total: 0, total: 20896.05, adjustments: [] },
  ]);
  t = text(el);
  check('each shop is named', /Glow SF/.test(t) && /Desert Wellness/.test(t));
  check('with its own floor share spelled out',
    /2,536\.75 of the floor @ 4%/.test(t) && /4,162\.80 of the floor @ 4%/.test(t), t.slice(0, 320));
  check('and the shares are different, being different shops',
    !/2,536\.75 of the floor[\s\S]*2,536\.75 of the floor/.test(t));
  check('the cheque is both shops added up', /36,994\.83/.test(t), t.slice(-160));

  console.log('\n── Somebody with no share of the floor is told nothing ──');
  el = render([REBECCA_GLOW, REBECCA_DW]);
  check('no floor line', !/of the floor/.test(el.textContent), el.textContent.slice(0, 200));

  console.log('\n── One shop, but a share of it ──');
  el = render([{ employee_id: 1, employee_name: 'Sal', store_name: 'Glow SF',
    commission_earned: 16098.78, own_commission: 13562.03, store_commission: 2536.75,
    store_rate: 4, adjustment_total: 0, total: 16098.78, adjustments: [] }]);
  check('it is still explained', /2,536\.75 of the floor @ 4%/.test(el.textContent),
    el.textContent.slice(0, 220));

  console.log('\n── A held line still moves no money ──');
  el = render([{ ...REBECCA_GLOW, adjustments: [
    { kind: 'held', amount: 0, receipt: 'ZZ-1' },
    { kind: 'won', amount: 1224, receipt: '1502-1268LC2' }] }]);
  check('it is left off', !/ZZ-1/.test(text(el)), text(el).slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
