'use strict';
// Reopening a payday at one shop must not touch another shop's records.
//
// It did. Clearing the holds a reopened paycheck was carrying ran three
// statements: two UPDATEs matching on the payday alone, and a DELETE with no
// payday filter and no company filter whatsoever — `WHERE held_payday IS NULL
// AND released_payday IS NULL`, nothing else. Reopening one payday at one
// shop deleted every dormant hold belonging to every shop on the server.
//
// A hold records where a deduction was taken. Rebuilt whenever a payday is
// closed again, so nobody's pay changed — but one shop's bookkeeping is not
// another shop's to delete, and on a multi-tenant server that is somebody
// else's data.
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

const MINE = 'zz-reopen-test-mine';
const THEIRS = 'zz-reopen-test-theirs';
const PAYDAY = '2099-01-15';

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cleanup = async () => {
    await c.query(`DELETE FROM pos_chargeback_holds WHERE employee_id IN
      (SELECT id FROM pos_employees WHERE user_id = ANY($1::text[]))`, [[MINE, THEIRS]]);
    await c.query(`DELETE FROM pos_transaction_chargebacks WHERE user_id = ANY($1::text[])`, [[MINE, THEIRS]]);
    await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN
      (SELECT id FROM pos_transactions WHERE user_id = ANY($1::text[]))`, [[MINE, THEIRS]]);
    await c.query(`DELETE FROM pos_transactions WHERE user_id = ANY($1::text[])`, [[MINE, THEIRS]]);
    await c.query(`DELETE FROM pos_employees WHERE user_id = ANY($1::text[])`, [[MINE, THEIRS]]);
  };
  await cleanup();

  // Two shops, one hold each, both on the same payday.
  const made = {};
  for (const shop of [MINE, THEIRS]) {
    const emp = (await c.query(
      `INSERT INTO pos_employees (name, pin, role, active, user_id) VALUES ('Tester','0000','sales',1,$1) RETURNING id`,
      [shop])).rows[0].id;
    const tx = (await c.query(
      `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id)
       VALUES ('sale',100,0,100,$1,$2) RETURNING id`, [`ZZ-${shop}`, shop])).rows[0].id;
    const cb = (await c.query(
      `INSERT INTO pos_transaction_chargebacks (transaction_id, user_id, amount, status)
       VALUES ($1,$2,100,'pending') RETURNING id`, [tx, shop])).rows[0].id;
    await c.query(
      `INSERT INTO pos_chargeback_holds (chargeback_id, employee_id, held_payday) VALUES ($1,$2,$3::date)`,
      [cb, emp, PAYDAY]);
    made[shop] = { emp, tx, cb };
  }

  const holdsFor = async (shop) => Number((await c.query(
    `SELECT COUNT(*) n FROM pos_chargeback_holds WHERE employee_id IN
      (SELECT id FROM pos_employees WHERE user_id = $1)`, [shop])).rows[0].n);

  check('both shops start with a hold', await holdsFor(MINE) === 1 && await holdsFor(THEIRS) === 1);

  // One shop reopens its payday.
  await pgDb.clearHoldsForPayday(MINE, PAYDAY, null);

  check('the shop that reopened loses its hold', (await holdsFor(MINE)) === 0);
  check('the OTHER shop keeps its own', await holdsFor(THEIRS) === 1,
    'reopening one shop\'s payday deleted another shop\'s records');

  // And a dormant hold elsewhere — no payday either side — survives too, which
  // is the row the unfiltered DELETE was hoovering up.
  await c.query(
    `UPDATE pos_chargeback_holds SET held_payday = NULL, released_payday = NULL
      WHERE employee_id = $1`, [made[THEIRS].emp]);
  await pgDb.clearHoldsForPayday(MINE, PAYDAY, null);
  check('a dormant hold at another shop survives as well', (await holdsFor(THEIRS)) === 1);

  await cleanup();
  const left = await c.query(
    `SELECT COUNT(*) n FROM pos_employees WHERE user_id = ANY($1::text[])`, [[MINE, THEIRS]]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
