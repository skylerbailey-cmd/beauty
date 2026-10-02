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

  console.log('\n── A day over it: the WHOLE day earns the tier rate ──');
  await cleanupSales();
  await sale('2026-06-04T18:00:00Z', 3000);
  // 3000 @ 40% = 1200 — every dollar that day, not just the part above $2,000
  check('all $3,000 at 40%',
    await run('2026-06-01', '2026-06-30') === 1200,
    `$${await run('2026-06-01', '2026-06-30')}, expected $1200 — $1100 is the marginal rule (only the part above at 40%)`);

  console.log('\n── Crossing the line moves the whole day to the tier rate ──');
  await cleanupSales();
  await sale('2026-06-05T18:00:00Z', 2000);
  const at = await run('2026-06-01', '2026-06-30');
  await cleanupSales();
  await sale('2026-06-05T18:00:00Z', 2001);
  const over = await run('2026-06-01', '2026-06-30');
  check('one dollar over $2,000 puts the whole day at 40% — $100.40 more',
    money(over - at) === 100.4, `$${money(over - at)} for the 2001st dollar`);

  console.log('\n── The day is the shop\'s day, not the server\'s ──');
  await cleanupSales();
  // 7pm and 8pm in Denver on 11 August — both already the 12th in UTC.
  await sale('2026-08-12T01:00:00Z', 1200);
  await sale('2026-08-12T02:00:00Z', 1300);
  const denver = await run('2026-08-01', '2026-08-31');
  // One Denver day of $2,500, over the line: 2500 @ 40% = 1000.
  check('two evening sales are one trading day', denver === 1000,
    `$${denver}, expected $1000 — $875 (two UTC days of $1,200 and $1,300, both under) means it split the day`);

  console.log('\n── A morning and an evening on the same shop day ──');
  await cleanupSales();
  await sale('2026-08-11T16:00:00Z', 1200);   // 10am Denver, 11 Aug
  await sale('2026-08-12T02:00:00Z', 1300);   // 8pm Denver, 11 Aug — 12th in UTC
  check('still one day', await run('2026-08-01', '2026-08-31') === 1000,
    `$${await run('2026-08-01', '2026-08-31')}, expected $1000`);

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
  await sale('2026-06-08T18:00:00Z', 3000);   // over: 3000 @ 40% = 1200
  await sale('2026-06-09T18:00:00Z', 1000);   // under: 1000 @ 35% = 350
  await sale('2026-06-10T18:00:00Z', 5000);   // over: 5000 @ 40% = 2000
  check('each day is judged on its own', await run('2026-06-01', '2026-06-30') === 3550,
    `$${await run('2026-06-01', '2026-06-30')}, expected $3550`);
  check('and not on the period as a whole',
    await run('2026-06-01', '2026-06-30') !== money(9000 * 0.40),
    'the whole period treated as one day would be $3,600');

  console.log('\n── The cheque pays the plan, not a flat rate ──');
  // The report worked the plan out properly and payroll did not — it paid
  // commission_rate on the period total and never read the plan at all. So
  // the two screens gave different answers for the same fortnight, and the
  // one that decides what somebody is paid was the one that underpaid.
  await cleanupSales();
  await sale('2026-07-08T18:00:00Z', 3000);   // 8 Jul: over, 3000 @ 40% = 1200
  await sale('2026-07-09T18:00:00Z', 1000);   // 9 Jul: 350
  const settings = await pgDb.getSettings(SHOP);
  const cheque = async (payday) => {
    const r = await pgDb.payrollForPayday([SHOP], payday, settings);
    const e = r.employees.find((x) => x.employee_id === emp);
    return e ? { earned: money(e.commission_earned), sales: money(e.sales_total) } : null;
  };
  const jul = await cheque('2026-08-01');     // pays 1-15 July
  check('the sales are the same either way', jul.sales === 4000, `$${jul.sales}`);
  check('the cheque pays the plan', jul.earned === 1550,
    `$${jul.earned}, expected $1550 — $1400 is the flat 35% payroll used to pay`);
  check('which is what the report says too',
    jul.earned === await run('2026-07-01', '2026-07-15'),
    `cheque $${jul.earned}, report $${await run('2026-07-01', '2026-07-15')}`);

  console.log('\n── A return in the same period comes off its own day ──');
  await cleanupSales();
  await sale('2026-07-08T18:00:00Z', 3000);
  await sale('2026-07-10T18:00:00Z', 1200, 'return');
  // The return belongs to the 10th, which had no sales — the 8th keeps its
  // $3,000 and the day the money came back goes negative.
  const withReturn = await cheque('2026-08-01');
  check('the sales figure drops by the return', withReturn.sales === 1800, `$${withReturn.sales}`);
  check('and the cheque never pays more than the sales support',
    withReturn.earned < 1200, `$${withReturn.earned}`);

  console.log('\n── A manager\'s share of the floor ──');
  // Set per person in Settings, as a percentage of everything the shop takes.
  // Two things were wrong: payroll never paid it at all — the commissions
  // report did, so a manager saw it on one screen and not in their pay — and
  // the share was worked out over every shop in scope rather than the one
  // whose roster they are on, so a manager with a record at two shops got
  // 4% of both floors twice over.
  await cleanupSales();
  await c.query(`UPDATE pos_commission_plans SET store_rate = 4 WHERE employee_id = $1`, [emp]);
  // Another person's sales, so the floor is bigger than Nadia's own.
  const other = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate)
     VALUES ('Ruth','8181','sales',1,$1,30) RETURNING id`, [SHOP])).rows[0].id;
  const otherSale = async (whenUtc, amount) => {
    receipt++;
    const id = (await c.query(
      `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
       VALUES ('sale',$1,0,$1,$2,$3,$4::timestamptz) RETURNING id`,
      [amount, `ZZ-O${receipt}`, SHOP, whenUtc])).rows[0].id;
    await c.query(
      `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
       VALUES ($1,$2,'percent',100,$3)`, [id, other, amount]);
  };
  await sale('2026-07-08T18:00:00Z', 1000);        // Nadia: 1000 @ 35% = 350
  await otherSale('2026-07-09T18:00:00Z', 4000);   // the floor is now 5000
  const withStore = await cheque('2026-08-01');
  check('the commission figure is what they sold, and only that',
    withStore.earned === 350, `$${withStore.earned} — $550 means the floor share was folded in`);
  const full = await pgDb.payrollForPayday([SHOP], '2026-08-01', settings);
  const me = full.employees.find((x) => x.employee_id === emp);
  const floor = me.adjustments.filter((a) => a.kind === 'store');
  check('the shop cut is a line of its own', floor.length === 1,
    `${floor.length} store lines`);
  check('worth 4% of everything the shop took', money(floor[0].amount) === 200,
    `$${floor[0].amount}, expected $200 (4% of $5,000)`);
  check('and it names the shop it came from', /ZZ Plan Shop/.test(floor[0].note), floor[0].note);
  check('the rate is on the row too', Number(me.store_rate) === 4, String(me.store_rate));
  check('the cheque still comes to the same money', money(me.total) === 550, `$${me.total}`);
  check('which is what the report says', await run('2026-07-01', '2026-07-15') === 550,
    `report $${await run('2026-07-01', '2026-07-15')}`);

  console.log('\n── Only their own shop\'s floor ──');
  const OTHER_SHOP = SHOP + '-2';
  await c.query(
    `INSERT INTO pos_settings (user_id, store_name, payroll_paydays, payroll_lag, tax_rate, timezone)
     VALUES ($1,'ZZ Plan Shop 2','1,15','previous',0.0875,'America/Denver')
     ON CONFLICT (user_id) DO NOTHING`, [OTHER_SHOP]);
  const farEmp = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate)
     VALUES ('Ruth','8282','sales',1,$1,30) RETURNING id`, [OTHER_SHOP])).rows[0].id;
  const far = (await c.query(
    `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
     VALUES ('sale',9000,0,9000,'ZZ-FAR',$1,'2026-07-09T18:00:00Z'::timestamptz) RETURNING id`,
    [OTHER_SHOP])).rows[0].id;
  await c.query(
    `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
     VALUES ($1,$2,'percent',100,9000)`, [far, farEmp]);

  const across = await pgDb.payrollForPayday([SHOP, OTHER_SHOP], '2026-08-01', settings);
  const meAcross = across.employees.find((x) => x.employee_id === emp);
  const acrossFloor = meAcross.adjustments.filter((a) => a.kind === 'store');
  check('a $9,000 day at the other shop adds nothing to their share',
    money(acrossFloor[0].amount) === 200,
    `$${acrossFloor[0].amount}, expected $200 — $560 means it counted both shops`);

  console.log('\n── A manager who sold nothing still gets their share ──');
  await c.query(`DELETE FROM pos_transaction_employees WHERE employee_id = $1`, [emp]);
  const quiet = await pgDb.payrollForPayday([SHOP], '2026-08-01', settings);
  const idle = quiet.employees.find((x) => x.employee_id === emp);
  check('they are on the payroll at all', !!idle, 'no row for a manager with no sales of their own');
  check('with no commission of their own', idle && money(idle.commission_earned) === 0,
    idle && String(idle.commission_earned));
  // The sales are still on the floor — only the credit to them was removed —
  // so the shop took the same $5,000 and their share of it is unchanged.
  const idleFloor = idle.adjustments.filter((a) => a.kind === 'store');
  check('and the shop cut still paid in full', money(idleFloor[0].amount) === 200,
    `$${idleFloor[0].amount}, expected $200 (4% of the $5,000 the shop took)`);
  check('so their whole cheque is the floor', money(idle.total) === 200, `$${idle.total}`);

  await c.query(`UPDATE pos_commission_plans SET store_rate = 0 WHERE employee_id = $1`, [emp]);
  await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN
    (SELECT id FROM pos_transactions WHERE user_id = $1)`, [OTHER_SHOP]);
  await c.query('DELETE FROM pos_transactions WHERE user_id = $1', [OTHER_SHOP]);
  await c.query('DELETE FROM pos_employees WHERE user_id = $1', [OTHER_SHOP]);
  await c.query('DELETE FROM pos_settings WHERE user_id = $1', [OTHER_SHOP]);

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
