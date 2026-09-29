'use strict';
// Two shops that share a roster share a paycheck.
//
// Someone working at both has a separate employee record at each, and one
// cheque. Their own screen already added the two halves together. The admin's
// payroll did not: it only spanned both shops when company-scope had been set
// in that session, and company-scope resolved the other shop out of SQLite —
// which is rebuilt empty on every deploy. So the combined view collapsed to
// one shop every time the app shipped, and a cash advance entered at the
// other shop dropped off the cheque it belonged to while the employee could
// still see it on theirs.
//
// What matters about the fix is that it moves nobody's money: combining is a
// regrouping of rows that were already right, so the same people are owed the
// same amounts, and a shop that is NOT linked stays out of it entirely.
//
// Built on throwaway shops. It reads and writes nothing belonging to anyone,
// and it never touches a real company link.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const fs = require('fs');
const path = require('path');
const pgDb = require('../src/db/postgres');
const { Client } = require('pg');

const A = 'zz-linked-payroll-a';
const B = 'zz-linked-payroll-b';
const C = 'zz-linked-payroll-c';   // never linked to anything
const SHOPS = [A, B, C];
const PAYDAY = '2026-08-01';       // pays 1–15 July

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
    await c.query('DELETE FROM pos_payroll_adjustments WHERE user_id = ANY($1::text[])', [SHOPS]);
    await c.query(`DELETE FROM pos_transaction_employees WHERE transaction_id IN
      (SELECT id FROM pos_transactions WHERE user_id = ANY($1::text[]))`, [SHOPS]);
    await c.query('DELETE FROM pos_transactions WHERE user_id = ANY($1::text[])', [SHOPS]);
    await c.query('DELETE FROM pos_employees WHERE user_id = ANY($1::text[])', [SHOPS]);
    await c.query('DELETE FROM pos_settings WHERE user_id = ANY($1::text[])', [SHOPS]);
    // Only ever the throwaway rows. A link belonging to a real shop is not
    // this test's to remove — an earlier version of one deleted a live one.
    await c.query(`DELETE FROM pos_company_links
      WHERE user_id = ANY($1::text[]) OR linked_user_id = ANY($1::text[])`, [SHOPS]);
  };
  await cleanup();

  for (const [id, name] of [[A, 'ZZ Shop A'], [B, 'ZZ Shop B'], [C, 'ZZ Shop C']]) {
    await c.query(
      `INSERT INTO pos_settings (user_id, store_name, payroll_paydays, payroll_lag, tax_rate, timezone)
       VALUES ($1,$2,'1,15','previous',0.0875,'America/Denver')
       ON CONFLICT (user_id) DO UPDATE SET store_name = EXCLUDED.store_name`, [id, name]);
  }

  const hire = async (shop, name, rate) => (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id, commission_rate)
     VALUES ($1,'4242','sales',1,$2,$3) RETURNING id`, [name, shop, rate])).rows[0].id;

  // Nadia works at both shops; Ruth only at the unlinked one.
  const nadiaA = await hire(A, 'Nadia', 50);
  const nadiaB = await hire(B, 'Nadia', 50);
  const ruthC = await hire(C, 'Ruth', 50);

  const sale = async (shop, empId, receipt, whenUtc, amount) => {
    const id = (await c.query(
      `INSERT INTO pos_transactions (type, subtotal, tax_amount, total, receipt_number, user_id, created_at)
       VALUES ('sale',$1,0,$1,$2,$3,$4::timestamptz) RETURNING id`,
      [amount, receipt, shop, whenUtc])).rows[0].id;
    await c.query(
      `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
       VALUES ($1,$2,'percent',100,$3)`, [id, empId, amount]);
  };
  await sale(A, nadiaA, 'ZZ-A1', '2026-07-08T19:00:00Z', 1000);   // $500 at 50%
  await sale(B, nadiaB, 'ZZ-B1', '2026-07-09T19:00:00Z', 400);    // $200 at 50%
  await sale(C, ruthC, 'ZZ-C1', '2026-07-10T19:00:00Z', 800);

  // The awkward one: an advance handed over at shop B, against the employee
  // record that lives at shop A. This is the shape that went missing.
  await pgDb.addPayrollAdjustment(B, PAYDAY, nadiaA, -120, 'cash advance', 'test');

  const settings = await pgDb.getSettings(A);
  const run = async (ids) => {
    const r = await pgDb.payrollForPayday(ids, PAYDAY, settings);
    const byName = new Map();
    for (const e of r.employees) {
      const o = byName.get(e.employee_name) || { earned: 0, adj: 0, total: 0, rows: 0 };
      o.earned = money(o.earned + Number(e.commission_earned));
      o.adj = money(o.adj + Number(e.adjustment_total));
      o.total = money(o.total + Number(e.total));
      o.rows++;
      byName.set(e.employee_name, o);
    }
    return byName;
  };

  console.log('\n── Before: one shop at a time ──');
  const only = { a: await run([A]), b: await run([B]) };
  const sepTotal = money((only.a.get('Nadia')?.total || 0) + (only.b.get('Nadia')?.total || 0));
  console.log(`   shop A alone: $${(only.a.get('Nadia')?.total || 0).toFixed(2)}`);
  console.log(`   shop B alone: $${(only.b.get('Nadia')?.total || 0).toFixed(2)}`);
  check('shop A on its own cannot see the advance entered at B',
    money(only.a.get('Nadia').adj) === 0, `adj ${only.a.get('Nadia').adj}`);

  console.log('\n── After: the two shops together ──');
  await pgDb.linkCompanies(A, B, 'test');
  const both = await run([A, B]);
  const nadia = both.get('Nadia');
  console.log(`   combined:     $${nadia.total.toFixed(2)}`);

  check('she is one person on the cheque, not two lines to add up',
    nadia.rows === 2 && nadia.earned === 700, `${nadia.rows} rows, earned ${nadia.earned}`);
  check('both shops\' commission is counted', nadia.earned === 700, `earned ${nadia.earned}, expected 700`);
  check('the advance from the other shop is on it', nadia.adj === -120, `adj ${nadia.adj}`);
  check('which comes to $580', nadia.total === 580, `total ${nadia.total}`);
  check('and that is the two separate cheques, unchanged',
    nadia.total === sepTotal, `combined ${nadia.total}, separate ${sepTotal}`);

  console.log('\n── The link is what grants it, and only the link ──');
  const linkedFromA = await pgDb.linkedCompanyIds(A);
  const linkedFromB = await pgDb.linkedCompanyIds(B);
  const linkedFromC = await pgDb.linkedCompanyIds(C);
  check('A reaches B', linkedFromA.includes(B), JSON.stringify(linkedFromA));
  check('B reaches A — neither is the senior partner', linkedFromB.includes(A), JSON.stringify(linkedFromB));
  check('the unlinked shop reaches nobody', linkedFromC.length === 0, JSON.stringify(linkedFromC));
  check('and is not reachable from either of them',
    !linkedFromA.includes(C) && !linkedFromB.includes(C));
  check('so its staff stay off their payroll', !both.has('Ruth'), [...both.keys()].join(', '));

  console.log('\n── Unlinking puts it back ──');
  await pgDb.unlinkCompanies(A, B);
  check('A no longer reaches B', !(await pgDb.linkedCompanyIds(A)).includes(B));
  const afterA = await run([A]);
  check('and the advance is out of sight again', money(afterA.get('Nadia').adj) === 0);

  console.log('\n── Payroll asks for the linked shops, not a session flag ──');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pos.js'), 'utf8');
  check('payroll is scoped by the link', /const payrollScope = async \(req\) => linkedScope\(req\)/.test(src));
  check('so are the commission figures an admin reads',
    /isAdmin\(employee\) \? linkedScope\(req\)/.test(src));
  check('linkedScope reads the link out of Postgres',
    /linkedScope = async[\s\S]{0,400}pgDb\.linkedCompanyIds/.test(src));
  check('company-scope no longer needs the SQLite user table',
    !/getUserByEmail/.test(src.slice(src.indexOf("router.post('/company-scope'"), src.indexOf("router.post('/company-scope'") + 1800)));

  await cleanup();
  const left = await c.query('SELECT COUNT(*) n FROM pos_employees WHERE user_id = ANY($1::text[])', [SHOPS]);
  const links = await c.query(`SELECT COUNT(*) n FROM pos_company_links
    WHERE user_id = ANY($1::text[]) OR linked_user_id = ANY($1::text[])`, [SHOPS]);
  check('nothing left behind', Number(left.rows[0].n) === 0 && Number(links.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
