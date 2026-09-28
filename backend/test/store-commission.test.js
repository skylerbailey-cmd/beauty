'use strict';
// A manager can be paid a percentage of everything the shop sells, on top of
// their own sales. Two things have to hold, and neither did:
//
//   the cheque pays it — the commission report worked it out, but payroll
//   read the flat rate off the employee record and never opened the
//   commission plan, so the report and the cheque disagreed by exactly the
//   store commission; and
//
//   it is worked out on SALES, before tax. Tax is the state's money passing
//   through the till and nobody earns a percentage of it. Paying on the
//   tax-inclusive total would quietly overpay by the tax rate — at 8.75%,
//   $527 a fortnight on the demo's figures.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const pgDb = require('../src/db/postgres');
const { Client } = require('pg');

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const money = (n) => '$' + Number(n || 0).toFixed(2);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const plans = (await c.query(
    `SELECT p.employee_id, p.store_rate, e.name, e.user_id AS company_id
     FROM pos_commission_plans p JOIN pos_employees e ON e.id = p.employee_id
     WHERE COALESCE(p.store_rate, 0) > 0 AND e.active = 1`)).rows;

  check('somebody is on a store commission — otherwise this proves nothing',
    plans.length > 0, 'no active employee has a store_rate');

  let checked = 0;
  for (const p of plans) {
    const settings = await pgDb.getSettings(p.company_id);
    if (!settings) continue;
    // The payday that pays for a period this shop actually traded in.
    const last = (await c.query(
      `SELECT MAX(created_at)::date::text AS d FROM pos_transactions WHERE user_id = $1`,
      [p.company_id])).rows[0]?.d;
    if (!last) continue;

    for (const payday of ['2026-10-01', '2026-09-15', '2026-09-01']) {
      const run = await pgDb.payrollForPayday(p.company_id, payday, settings);
      const row = run.employees.find((e) => e.employee_id === p.employee_id);
      if (!row || !Number(row.store_commission)) continue;
      checked++;

      const from = `${run.period.start}T00:00:00Z`;
      const to = `${run.period.end}T23:59:59.999Z`;

      // What the shop sold in the period, before tax and after tax.
      const sums = (await c.query(
        `SELECT COALESCE(SUM(CASE WHEN type='return' THEN -ABS(subtotal) ELSE subtotal END),0) AS pre_tax,
                COALESCE(SUM(CASE WHEN type='return' THEN -ABS(total)    ELSE total    END),0) AS with_tax
         FROM pos_transactions
         WHERE user_id = $1 AND COALESCE(original_sale_date, created_at) >= $2
           AND COALESCE(original_sale_date, created_at) <= $3`,
        [p.company_id, from, to])).rows[0];
      const preTax = round2(Number(sums.pre_tax));
      const withTax = round2(Number(sums.with_tax));

      check(`${p.name} (${payday}): paid on the shop's sales before tax`,
        round2(row.store_sales) === preTax,
        `store_sales ${money(row.store_sales)} vs pre-tax ${money(preTax)} (with tax ${money(withTax)})`);

      check(`${p.name} (${payday}): and NOT on the tax-inclusive takings`,
        withTax === preTax || round2(row.store_sales) !== withTax,
        `store_sales matches the tax-inclusive figure ${money(withTax)} — that is the state's money`);

      check(`${p.name} (${payday}): the cheque actually carries it`,
        round2(row.store_commission) === round2(preTax * Number(p.store_rate) / 100),
        `${p.store_rate}% of ${money(preTax)} is ${money(preTax * p.store_rate / 100)}, cheque says ${money(row.store_commission)}`);

      check(`${p.name} (${payday}): commission earned = own sales + the store cut`,
        round2(row.commission_earned) === round2(Number(row.own_commission || 0) + Number(row.store_commission)),
        `earned ${money(row.commission_earned)} vs own ${money(row.own_commission)} + store ${money(row.store_commission)}`);

      console.log(`        ${p.name}: own ${money(row.own_commission)} + store ${money(row.store_commission)} ` +
                  `(${p.store_rate}% of ${money(preTax)}) = ${money(row.commission_earned)}`);
    }
  }

  check('at least one paycheck carried a store commission', checked > 0,
    'no payday in the window produced one');

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
