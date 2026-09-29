'use strict';
// A daily-threshold commission plan: "35% for anything under $2,000, and
// anything over that is 40%".
//
// Two things were wrong with how that was worked out.
//
//   1. Crossing the threshold moved the WHOLE day to 40%, not just the part
//      above it. On a $17,586 day that is $200 conjured by the crossing
//      itself, and it made the $2,000th dollar worth more than the 1,999
//      before it.
//
//   2. The day was taken from `toISOString()` — UTC. For a Denver shop every
//      sale after 6pm fell into the next day's bucket, so one trading day was
//      split in two and each half was measured against the threshold on its
//      own. A real $8,950 day read as $325 and the rest, and paid the base
//      rate on money that had earned the higher one.
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

const SHOP = 'zz-commission-plan-shop';
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cleanup = async () => {
    await c.query(`DELETE FROM pos_commission_plans WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN
      (SELECT id FROM pos_transactions WHERE user_id = $1)`, [SHOP]);
    await c.query('DELETE FROM pos_transactions WHERE user_id = $1', [SHOP]);
    await c.query('DELETE FROM pos_employees WHERE user_id = $1', [SHOP]);
    await c.query('DELETE FROM pos_settings WHERE user_id = $1', [SHOP]);
  };
  await cleanup();

  await c.query(
    `INSERT INTO pos_settings (user_id, store_name, payroll_paydays, payroll_lag, tax_rate, timezone)
     VALUES ($1,'ZZ Plan Shop','1,15','previous',0.0875,'America/Denver')
     ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [SHOP]);
  const emp = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate)
     VALUES ('Nadia','7171','sales',1,$1,35) RETURNING id`, [SHOP])).rows[0].id;
  await c.query(
    `INSERT INTO pos_commission_plans (employee_id, plan_type, base_rate, tier_rate, tier_threshold, store_rate, user_id)
     VALUES ($1,'daily_threshold',35,40,2000,0,$2)`, [emp, SHOP]);

  let receipt = 0;
  const sale = async (whenUtc, amount, type = 'sale') => {
    receipt++;
    const id = (await c.query(
      `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
       VALUES ($1,$2,0,$2,$3,$4,$5::timestamptz) RETURNING id`,
      [type, amount, `ZZ-P${receipt}`, SHOP, whenUtc])).rows[0].id;
    await c.query(
      `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
       VALUES ($1,$2,'percent',100,$3)`, [id, emp, amount]);
  };

  const run = async (from, to) => {
    const r = await pgDb.calculateEmployeeCommission(emp, [SHOP], `${from}T00:00:00-06:00`, `${to}T23:59:59-06:00`);
    return money(r.commission_total);
  };

  console.log('\n── A day under the threshold ──');
  await sale('2026-06-02T18:00:00Z', 1500);          // 2 Jun, noon Denver
  check('pays the base rate on all of it', await run('2026-06-01', '2026-06-30') === 525,
    `$${await run('2026-06-01', '2026-06-30')}, expected $525 (1500 @ 35%)`);

  console.log('\n── A day exactly on the threshold ──');
  await cleanupSales();
  await sale('2026-06-03T18:00:00Z', 2000);
  check('is still all at the base rate', await run('2026-06-01', '2026-06-30') === 700,
    `$${await run('2026-06-01', '2026-06-30')}, expected $700 (2000 @ 35%)`);

  console.log('\n── A day over it: only the part above earns more ──');
  await cleanupSales();
  await sale('2026-06-04T18:00:00Z', 3000);
  // 2000 @ 35% = 700, 1000 @ 40% = 400
  check('the first $2,000 at 35%, the rest at 40%',
    await run('2026-06-01', '2026-06-30') === 1100,
    `$${await run('2026-06-01', '2026-06-30')}, expected $1100 — not $1200, which is the whole day at 40%`);

  console.log('\n── The dollar that crosses the line is worth no more than the one before it ──');
  await cleanupSales();
  await sale('2026-06-05T18:00:00Z', 2000);
  const at = await run('2026-06-01', '2026-06-30');
  await cleanupSales();
  await sale('2026-06-05T18:00:00Z', 2001);
  const over = await run('2026-06-01', '2026-06-30');
  check('one more dollar of sales adds forty cents, not $200',
    money(over - at) === 0.4, `$${money(over - at)} for the 2001st dollar`);

  console.log('\n── The day is the shop\'s day, not the server\'s ──');
  await cleanupSales();
  // 7pm and 8pm in Denver on 11 August — both already the 12th in UTC.
  await sale('2026-08-12T01:00:00Z', 1200);
  await sale('2026-08-12T02:00:00Z', 1300);
  const denver = await run('2026-08-01', '2026-08-31');
  // One Denver day of $2,500: 2000 @ 35% + 500 @ 40% = 700 + 200 = 900.
  check('two evening sales are one trading day', denver === 900,
    `$${denver}, expected $900 — $700 (two UTC days of $1,200 and $1,300, both under) means it split the day`);

  console.log('\n── A morning and an evening on the same shop day ──');
  await cleanupSales();
  await sale('2026-08-11T16:00:00Z', 1200);   // 10am Denver, 11 Aug
  await sale('2026-08-12T02:00:00Z', 1300);   // 8pm Denver, 11 Aug — 12th in UTC
  check('still one day', await run('2026-08-01', '2026-08-31') === 900,
    `$${await run('2026-08-01', '2026-08-31')}, expected $900`);

  console.log('\n── A return comes off before the threshold is judged ──');
  await cleanupSales();
  await sale('2026-06-06T18:00:00Z', 2500);
  await sale('2026-06-06T20:00:00Z', 700, 'return');
  // Net $1,800 — under the threshold, so all of it at 35%.
  check('a sale that came back never counts towards the higher rate',
    await run('2026-06-01', '2026-06-30') === 630,
    `$${await run('2026-06-01', '2026-06-30')}, expected $630 (1800 @ 35%)`);

  console.log('\n── Several days add up separately ──');
  await cleanupSales();
  await sale('2026-06-08T18:00:00Z', 3000);   // 700 + 400 = 1100
  await sale('2026-06-09T18:00:00Z', 1000);   // 350
  await sale('2026-06-10T18:00:00Z', 5000);   // 700 + 1200 = 1900
  check('each day is judged on its own', await run('2026-06-01', '2026-06-30') === 3350,
    `$${await run('2026-06-01', '2026-06-30')}, expected $3350`);
  check('and not on the period as a whole',
    await run('2026-06-01', '2026-06-30') !== money(2000 * 0.35 + 7000 * 0.40),
    'the whole period treated as one day would be $3,500');

  async function cleanupSales() {
    await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN
      (SELECT id FROM pos_transactions WHERE user_id = $1)`, [SHOP]);
    await c.query('DELETE FROM pos_transactions WHERE user_id = $1', [SHOP]);
  }

  await cleanup();
  const left = await c.query('SELECT COUNT(*) n FROM pos_employees WHERE user_id = $1', [SHOP]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
