'use strict';
// A sale belongs to the day it happened in the shop.
//
// Payroll decided which day a sale fell on by casting its timestamp to a
// date, which uses the server's clock — UTC. An evening sale in Denver is
// already tomorrow in UTC, so 6pm on the 15th counted as the 16th and its
// commission moved onto the NEXT paycheck. Checked against the shop's old
// till, 87 of 881 sales had shifted a day this way and five of them had
// crossed a pay period.
//
// Built on a throwaway shop; it reads and writes nothing belonging to anyone.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const pgDb = require('../src/db/postgres');
const { Client } = require('pg');

const SHOP = 'zz-storeday-test-shop';
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cleanup = async () => {
    await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN (SELECT id FROM pos_transactions WHERE user_id = $1)`, [SHOP]);
    await c.query(`DELETE FROM pos_transactions WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_employees WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_settings WHERE user_id = $1`, [SHOP]);
  };
  await cleanup();

  await c.query(
    `INSERT INTO pos_settings (user_id, store_name, payroll_paydays, payroll_lag, tax_rate, timezone)
     VALUES ($1,'ZZ Store Day','1,15','previous',0.0875,'America/Denver')
     ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [SHOP]);
  const emp = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate)
     VALUES ('Nadia','3131','sales',1,$1,50) RETURNING id`, [SHOP])).rows[0].id;

  // 6:01pm on 15 July, Denver. That is 00:01 on the 16th in UTC.
  const sale = async (receipt, whenUtc, amount) => {
    const id = (await c.query(
      `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
       VALUES ('sale',$1,0,$1,$2,$3,$4::timestamptz) RETURNING id`, [amount, receipt, SHOP, whenUtc])).rows[0].id;
    await c.query(
      `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
       VALUES ($1,$2,'percent',100,$3)`, [id, emp, amount]);
  };
  await sale('ZZ-EVE', '2026-07-16T00:01:00Z', 1000);   // 15 Jul, 18:01 Denver
  await sale('ZZ-MORN', '2026-07-16T18:00:00Z', 500);   // 16 Jul, 12:00 Denver

  const settings = await pgDb.getSettings(SHOP);
  check('the shop is on its own clock', settings.timezone === 'America/Denver', settings.timezone);

  const cheque = async (payday) => {
    const run = await pgDb.payrollForPayday(SHOP, payday, settings);
    const e = run.employees.find((x) => x.employee_id === emp);
    return { period: `${run.period.start}..${run.period.end}`, sales: e ? Number(e.sales_total) : 0 };
  };

  // 1-15 July is paid on 1 August; 16-31 July on 15 August.
  const first = await cheque('2026-08-01');
  const second = await cheque('2026-08-15');

  console.log(`\n   1-15 July  (paid ${first.period})  sales $${first.sales.toFixed(2)}`);
  console.log(`   16-31 July (paid ${second.period})  sales $${second.sales.toFixed(2)}\n`);

  check('the 6pm sale on the 15th is on the first-half cheque',
    first.sales === 1000, `first half has $${first.sales.toFixed(2)}, expected $1000`);
  check('and NOT on the second-half one',
    second.sales === 500, `second half has $${second.sales.toFixed(2)}, expected $500 (the 16th only)`);
  check('nothing is lost or counted twice', first.sales + second.sales === 1500,
    `$${(first.sales + second.sales).toFixed(2)} across both, expected $1500`);

  await cleanup();
  const left = await c.query(`SELECT COUNT(*) n FROM pos_employees WHERE user_id = $1`, [SHOP]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
