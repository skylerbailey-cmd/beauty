'use strict';
// A dispute that is won gives the commission back on the cheque still ahead.
//
// It used to give nothing back unless a hold had been recorded against a
// particular payday. The reasoning was that a dispute never marked as
// withheld had not taken anything, so the commission "was paid all along" —
// but payroll is worked out from today's data. While the dispute was open it
// was deducting from the cheque being worked towards; the moment it was marked
// won that deduction vanished from the recomputation, so the cheque read as
// though it had paid in full. The cheque that actually went out was short by
// it, and nothing ever put it back.
//
// Built on throwaway shops. It reads and writes nothing belonging to anybody.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const pgDb = require('../src/db/postgres');
const { Client } = require('pg');

const SHOP = 'zz-release-test-shop';
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const money = (n) => Math.round(Number(n) * 100) / 100;

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cleanup = async () => {
    await c.query(`DELETE FROM pos_chargeback_holds WHERE employee_id IN (SELECT id FROM pos_employees WHERE user_id = $1)`, [SHOP]);
    await c.query(`DELETE FROM pos_transaction_chargebacks WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN (SELECT id FROM pos_transactions WHERE user_id = $1)`, [SHOP]);
    await c.query(`DELETE FROM pos_transactions WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_payroll_runs WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_payroll_balances WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_employees WHERE user_id = $1`, [SHOP]);
    await c.query(`DELETE FROM pos_settings WHERE user_id = $1`, [SHOP]);
  };
  await cleanup();

  await c.query(`INSERT INTO pos_settings (user_id, store_name, payroll_paydays, payroll_lag, tax_rate)
    VALUES ($1,'ZZ Release Test','1,15','previous',0.0875)
    ON CONFLICT (user_id) DO UPDATE SET store_name = EXCLUDED.store_name`, [SHOP]);
  const emp = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate)
     VALUES ('Nadia','9182','sales',1,$1,40) RETURNING id`, [SHOP])).rows[0].id;

  // A $1,000 sale on 12 June. Its commission at 40% is $400.
  const tx = (await c.query(
    `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
     VALUES ('sale',1000,0,1000,'ZZ-REL-1',$1,'2026-06-12T12:00:00Z') RETURNING id`, [SHOP])).rows[0].id;
  await c.query(
    `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
     VALUES ($1,$2,'percent',100,1000)`, [tx, emp]);

  // Every payday up to and including 15 September has gone out.
  for (const p of ['2026-07-01','2026-07-15','2026-08-01','2026-08-15','2026-09-01','2026-09-15']) {
    await c.query(`INSERT INTO pos_payroll_runs (user_id, payday, paid_at, paid_by)
      VALUES ($1,$2::date,NOW(),'test') ON CONFLICT DO NOTHING`, [SHOP, p]);
  }
  const settings = await pgDb.getSettings(SHOP);
  const lineFor = async (payday, kind) => {
    const run = await pgDb.payrollForPayday(SHOP, payday, settings);
    const e = run.employees.find((x) => x.employee_id === emp);
    if (!e) return { total: 0, amount: 0, run };
    const lines = (e.adjustments || []).filter((a) => a.kind === kind);
    return { total: money(e.total), amount: money(lines.reduce((s, a) => s + Number(a.amount), 0)), run, e };
  };

  // The commission came off the 15 September cheque, which has gone out.
  const cb = (await c.query(
    `INSERT INTO pos_transaction_chargebacks (transaction_id, user_id, amount, status, opened_at, withheld_payday)
     VALUES ($1,$2,1000,'pending','2026-09-02T12:00:00Z','2026-09-15') RETURNING id`, [tx, SHOP])).rows[0].id;
  await c.query(
    `INSERT INTO pos_chargeback_holds (chargeback_id, employee_id, held_payday) VALUES ($1,$2,'2026-09-15')`,
    [cb, emp]);

  console.log('\n── While the dispute is open ──');
  let r = await lineFor('2026-09-15', 'withheld');
  check('the cheque it came off still shows it', r.amount === -400, `withheld ${r.amount}, expected -400`);

  console.log('\n── Once it is won ──');
  await c.query(`UPDATE pos_transaction_chargebacks SET status='won', closed_at='2026-09-15' WHERE id=$1`, [cb]);
  r = await lineFor('2026-10-01', 'won');
  check('the money comes back on the cheque still ahead', r.amount === 400, `released ${r.amount}, expected 400`);

  console.log('\n── Never on a cheque that has been handed out ──');
  for (const gone of ['2026-08-01', '2026-09-01', '2026-09-15']) {
    const o = await lineFor(gone, 'won');
    check(`nothing lands on ${gone}`, o.amount === 0, `${o.amount} landed on it`);
  }

  console.log('\n── The close date does not decide where it lands ──');
  // A date typed months earlier must not send the money to an old cheque.
  await c.query(`UPDATE pos_transaction_chargebacks SET closed_at='2026-06-30' WHERE id=$1`, [cb]);
  r = await lineFor('2026-10-01', 'won');
  check('still the cheque ahead, whatever date was typed', r.amount === 400, String(r.amount));
  const backThen = await lineFor('2026-07-15', 'won');
  check('and not the payday covering that date', backThen.amount === 0, String(backThen.amount));

  console.log('\n── A payday nobody ticked, but which has passed, counts as gone ──');
  await c.query(`DELETE FROM pos_payroll_runs WHERE user_id=$1 AND payday='2026-09-15'`, [SHOP]);
  r = await lineFor('2026-10-01', 'won');
  check('it still lands ahead, not on the untickedcheque', r.amount === 400,
    `${r.amount} — an unticked past payday swallowed the release`);
  await c.query(`INSERT INTO pos_payroll_runs (user_id, payday, paid_at, paid_by)
    VALUES ($1,'2026-09-15',NOW(),'test') ON CONFLICT DO NOTHING`, [SHOP]);

  console.log('\n── Once recorded as released it stops moving ──');
  await c.query(`UPDATE pos_transaction_chargebacks SET released_payday='2026-10-01' WHERE id=$1`, [cb]);
  r = await lineFor('2026-10-01', 'won');
  check('it stays on the payday it was released on', r.amount === 400, String(r.amount));
  const later = await lineFor('2026-10-15', 'won');
  check('and does not turn up again on the next one', later.amount === 0,
    `${later.amount} on 2026-10-15 — it would be paid twice`);

  console.log('\n── Tidy up ──');
  await cleanup();
  const left = await c.query(`SELECT COUNT(*) n FROM pos_employees WHERE user_id = $1`, [SHOP]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
