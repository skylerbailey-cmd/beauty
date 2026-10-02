'use strict';
// Hourly wages and salary on the paycheck, on top of commission.
//
// Hourly: the hours of their closed shifts on the time clock, times the rate
// in effect on the day of each shift. Salary: the yearly figure split across
// paychecks, day by day. Pay is a history from the day it starts, so setting
// it today never rewrites an earlier paycheck, and an employee with none set
// is paid nothing extra. Built on throwaway shops.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = process.env.PGSSLMODE || 'no-verify';
const pgDb = require('../src/db/postgres');

const SHOP = 'zz-wages-shop';
const PAYDAY = '2026-08-01';           // pays 1–15 July
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const q = (sql, p) => pgDb.pool.query(sql, p).then(r => r.rows);

(async () => {
  await pgDb.initSchema();
  const cleanup = async () => {
    await q(`DELETE FROM pos_transaction_employees WHERE transaction_id IN (SELECT id FROM pos_transactions WHERE user_id = $1)`, [SHOP]);
    await q('DELETE FROM pos_transactions WHERE user_id = $1', [SHOP]);
    await q('DELETE FROM pos_employee_pay WHERE user_id = $1', [SHOP]);
    await q('DELETE FROM pos_time_entries WHERE user_id = $1', [SHOP]);
    await q('DELETE FROM pos_employees WHERE user_id = $1', [SHOP]);
    await q('DELETE FROM pos_settings WHERE user_id = $1', [SHOP]);
  };
  await cleanup();
  await q(`INSERT INTO pos_settings (user_id, store_name, payroll_paydays, payroll_lag, timezone)
           VALUES ($1, 'ZZ Wages', '1,15', 'previous', 'America/Denver')`, [SHOP]);
  const hire = async (name, rate = 40) => (await q(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate) VALUES ($1,'4242','sales',1,$2,$3) RETURNING id`,
    [name, SHOP, rate]))[0].id;
  const shift = (emp, inUtc, outUtc) => q(
    `INSERT INTO pos_time_entries (user_id, employee_id, clock_in, clock_out) VALUES ($1,$2,$3::timestamptz,$4::timestamptz)`,
    [SHOP, emp, inUtc, outUtc]);
  const sale = async (emp, whenUtc, amount, receipt) => {
    const id = (await q(`INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
      VALUES ('sale',$1,0,$1,$2,$3,$4::timestamptz) RETURNING id`, [amount, receipt, SHOP, whenUtc]))[0].id;
    await q(`INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
      VALUES ($1,$2,'percent',100,$3)`, [id, emp, amount]);
  };
  const pay = (emp, type, amt, from) => pgDb.setPay({ employeeId: emp, userId: SHOP, payType: type,
    hourlyRate: type === 'hourly' ? amt : 0, annualSalary: type === 'salary' ? amt : 0, effectiveFrom: from, createdBy: 'test' });
  const run = async () => pgDb.payrollForPayday([SHOP], PAYDAY, await pgDb.getSettings(SHOP));
  const of = (r, id) => r.employees.find(e => e.employee_id === id);
  const line = (row, kind) => row && row.adjustments.find(a => a.kind === kind);

  // Ana: hourly, $20/h, with sales too. Denver is UTC-6 in July.
  const ana = await hire('Ana');
  await sale(ana, '2026-07-03T18:00:00Z', 1000, 'ZZW-1');                       // $400 commission
  await shift(ana, '2026-07-03T15:00:00Z', '2026-07-03T23:00:00Z');             // 8 h on Jul 3
  await shift(ana, '2026-07-08T16:00:00Z', '2026-07-08T20:30:00Z');             // 4.5 h on Jul 8
  await shift(ana, '2026-07-16T15:00:00Z', '2026-07-16T23:00:00Z');             // Jul 16: next period
  // Bo: hourly, no sales at all, a raise mid-period, a late Denver shift and one left open.
  const bo = await hire('Bo');
  await shift(bo, '2026-07-02T15:00:00Z', '2026-07-02T21:00:00Z');              // 6 h Jul 2 at $15
  await shift(bo, '2026-07-10T15:00:00Z', '2026-07-10T19:00:00Z');              // 4 h Jul 10 at $18
  await shift(bo, '2026-07-16T02:00:00Z', '2026-07-16T05:00:00Z');              // 8–11pm Jul 15 Denver: 3 h at $18
  await q(`INSERT INTO pos_time_entries (user_id, employee_id, clock_in) VALUES ($1,$2,'2026-07-14T15:00:00Z')`, [SHOP, bo]);
  // Cy: salary from the start; Di: salary starting Jul 11; Ed: nothing set.
  const cy = await hire('Cy');
  const di = await hire('Di');
  const ed = await hire('Ed');
  await sale(ed, '2026-07-05T18:00:00Z', 500, 'ZZW-2');
  await shift(ed, '2026-07-05T15:00:00Z', '2026-07-05T23:00:00Z');

  console.log('\n── Nobody has pay set ──');
  let r = await run();
  check('existing employees are paid nothing extra', r.employees.every(e => !line(e, 'wages') && !line(e, 'salary')));
  check('Ana\'s cheque is her commission alone', of(r, ana).total === 400, String(of(r, ana).total));
  check('hours with no wage add nothing either', of(r, ed).total === 200, String(of(r, ed).total));

  console.log('\n── Hourly ──');
  await pay(ana, 'hourly', 20, '2026-01-01');
  await pay(bo, 'hourly', 15, '2026-01-01');
  await pay(bo, 'hourly', 18, '2026-07-09');                                      // raise from Jul 9
  r = await run();
  const aw = line(of(r, ana), 'wages');
  check('Ana: 12.5 h × $20 = $250', aw && aw.amount === 250 && aw.hours === 12.5, JSON.stringify(aw));
  check('says the hours and the rate', aw && /12\.5 h on the time clock at \$20\.00\/h/.test(aw.note), aw && aw.note);
  check('the next period\'s shift is not on this cheque', aw && aw.hours === 12.5);
  check('on top of her commission: $650', of(r, ana).total === 650, String(of(r, ana).total));
  const bw = line(of(r, bo), 'wages');
  check('Bo is on the cheque with no sales at all', !!of(r, bo));
  check('each day at the rate that day: 6×15 + 4×18 + 3×18 = $216', bw && bw.amount === 216, JSON.stringify(bw));
  check('an 8pm Denver shift on the 15th counts on the 15th, not the 16th (UTC)', bw && bw.hours === 13, bw && String(bw.hours));
  check('two rates: the note doesn\'t claim one', bw && !/ at \$/.test(bw.note), bw && bw.note);
  check('the shift still clocked in is mentioned, not paid', bw && /1 shift still clocked in, not counted/.test(bw.note), bw && bw.note);

  console.log('\n── Salary ──');
  await pay(cy, 'salary', 48000, '2026-01-01');
  await pay(di, 'salary', 48000, '2026-07-11');
  r = await run();
  const cs = line(of(r, cy), 'salary');
  check('Cy: $48,000 ÷ 24 paychecks = $2,000', cs && cs.amount === 2000, JSON.stringify(cs));
  check('says how it was worked out', cs && /\$48,000\.00 a year over 24 paychecks/.test(cs.note), cs && cs.note);
  const ds = line(of(r, di), 'salary');
  check('Di, starting on the 11th: 5 of 15 days = $666.67', ds && ds.amount === 666.67, JSON.stringify(ds));
  check('and says so', ds && /salary for 5 of the 15 days/.test(ds.note), ds && ds.note);

  console.log('\n── History doesn\'t move ──');
  await pay(ana, 'hourly', 30, '2026-07-20');                                     // after this period
  r = await run();
  check('a raise starting later leaves this paycheck alone', line(of(r, ana), 'wages').amount === 250);
  await pay(ana, 'hourly', 22, '2026-07-20');                                     // same day again
  check('setting it twice on the same day replaces, not stacks',
    (await q('SELECT COUNT(*)::int n FROM pos_employee_pay WHERE employee_id = $1 AND effective_from = $2', [ana, '2026-07-20']))[0].n === 1);
  await pay(cy, 'none', 0, '2026-07-06');
  r = await run();
  check('salary switched off on the 6th pays 5 of 15 days', line(of(r, cy), 'salary').amount === 666.67, JSON.stringify(line(of(r, cy), 'salary')));
  const cur = await pgDb.currentPay(SHOP);
  check('current pay reads the latest that has started', cur.pay[bo].current.hourly_rate === 18 && cur.pay[cy].current.pay_type === 'none');

  console.log('\n── The payday total ──');
  check('includes wages and salary', r.total === round(r.employees.reduce((s, e) => s + e.total, 0)));

  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
function round(n) { return Math.round(n * 100) / 100; }
