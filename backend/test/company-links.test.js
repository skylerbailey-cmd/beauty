'use strict';
// Two shops that share a roster: who the link opens, and who it does not.
//
// This used to run against the real Glow SF and Desert Wellness records, and
// its setup and teardown deleted the links between them — so running the test
// silently removed a link the shop had created for itself, and their staff
// stopped seeing half their own figures. A test does not get to touch a
// customer's data. Everything below is built from scratch under throwaway ids
// and removed again, and nothing it deletes is matched by anything but those.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const pgDb = require('../src/db/postgres');
const { Client } = require('pg');

// Throwaway shops. Nothing real can collide with these.
const A = 'zz-linktest-shop-a';
const B = 'zz-linktest-shop-b';
const C = 'zz-linktest-shop-c';   // never linked to anything
const ALL = [A, B, C];
const PIN = '4731';

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
    await c.query(`DELETE FROM pos_company_links WHERE user_id = ANY($1::text[]) OR linked_user_id = ANY($1::text[])`, [ALL]);
    await c.query(`DELETE FROM pos_transaction_employees WHERE employee_id IN
      (SELECT id FROM pos_employees WHERE user_id = ANY($1::text[]))`, [ALL]);
    await c.query(`DELETE FROM pos_employees WHERE user_id = ANY($1::text[])`, [ALL]);
    await c.query(`DELETE FROM pos_settings WHERE user_id = ANY($1::text[])`, [ALL]);
  };
  await cleanup();

  // Three shops. The same person works at A and B; C has someone who happens
  // to share her name and her PIN, which is the collision the link exists to
  // keep shut.
  const emp = {};
  for (const shop of ALL) {
    await c.query(`INSERT INTO pos_settings (user_id, store_name) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET store_name = EXCLUDED.store_name`,
      [shop, 'ZZ Test ' + shop.slice(-1).toUpperCase()]);
    emp[shop] = (await c.query(
      `INSERT INTO pos_employees (name, pin, role, active, user_id)
       VALUES ('Dorian', $1, 'sales', 1, $2) RETURNING id`, [PIN, shop])).rows[0].id;
  }

  // What the route works out: the shop in hand, plus linked shops where this
  // same name and PIN is an active employee.
  const scopeFor = async (here) => {
    const found = [{ company_id: here, employee_id: emp[here] }];
    for (const other of await pgDb.linkedCompanyIds(here)) {
      if (other === here) continue;
      const them = await pgDb.verifyEmployeePin(PIN, other, 'Dorian');
      if (them) found.push({ company_id: other, employee_id: them.id });
    }
    return found;
  };

  console.log('\n── Before the shops are linked ──');
  let s = await scopeFor(A);
  check('she sees one shop', s.length === 1, JSON.stringify(s));
  check('and it is the one she is standing in', s[0].company_id === A);

  console.log('\n── Link A and B ──');
  await pgDb.linkCompanies(A, B, 'tester');
  s = await scopeFor(A);
  check('she now sees both', s.length === 2, JSON.stringify(s.map(x => x.company_id)));
  check('with her own record at each',
    JSON.stringify(s.map(x => x.employee_id).sort()) === JSON.stringify([emp[A], emp[B]].sort()));
  check('and it works from the other side too', (await scopeFor(B)).length === 2);

  console.log('\n── The link alone opens nothing ──');
  const wrongPin = [{ company_id: A }];
  for (const other of await pgDb.linkedCompanyIds(A)) {
    if (await pgDb.verifyEmployeePin('0000', other, 'Dorian')) wrongPin.push({ company_id: other });
  }
  check('a wrong PIN gets only the shop in front of her', wrongPin.length === 1);

  await c.query(`UPDATE pos_employees SET active = 0 WHERE user_id = $1`, [B]);
  check('an inactive record there opens nothing', (await scopeFor(A)).length === 1);
  await c.query(`UPDATE pos_employees SET active = 1 WHERE user_id = $1`, [B]);

  console.log('\n── An unlinked shop stays shut ──');
  const reach = (await scopeFor(A)).map(x => x.company_id);
  check('shop C shares her name AND her PIN, and is not reachable', !reach.includes(C),
    'an unlinked shop was opened by a name and PIN that merely collided');

  console.log('\n── Unlinking puts it back ──');
  await pgDb.unlinkCompanies(A, B);
  check('she is back to one shop', (await scopeFor(A)).length === 1);
  check('from both sides', (await scopeFor(B)).length === 1);

  console.log('\n── Tidy up ──');
  await cleanup();
  const left = await c.query(
    `SELECT COUNT(*) n FROM pos_employees WHERE user_id = ANY($1::text[])`, [ALL]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
