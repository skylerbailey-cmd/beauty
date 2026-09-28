'use strict';
// The cross-store rules, against the real database. Creates the link, checks
// who it opens and who it does not, then puts everything back.
const { Client } = require('pg');

// Needs the real database: these are rules about who may read whose figures,
// and a mock would only prove the mock agrees with itself.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}

const GLOW = '003a24d0', DW = 'c68e3ce2', DEMO = '92577bd3';
let pass = 0, fail = 0;
const check = (l, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok) console.log(`        expected ${JSON.stringify(e)}\n        actual   ${JSON.stringify(a)}`);
  ok ? pass++ : fail++;
};

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const ids = (await c.query('SELECT DISTINCT user_id FROM pos_employees')).rows.map(r => r.user_id);
  const glow = ids.find(i => i.startsWith(GLOW));
  const dw = ids.find(i => i.startsWith(DW));
  const demo = ids.find(i => i.startsWith(DEMO));

  // Mirrors of the server helpers, run against the same tables.
  const linkedCompanyIds = async (u) =>
    (await c.query('SELECT linked_user_id FROM pos_company_links WHERE user_id = $1', [u])).rows.map(r => r.linked_user_id);
  const verifyEmployeePin = async (pin, userId, name) => (await c.query(
    `SELECT * FROM pos_employees WHERE pin = $1 AND user_id = $2 AND active = 1
       AND LOWER(TRIM(name)) = $3 ORDER BY id`, [pin, userId, String(name || '').trim().toLowerCase()])).rows[0];
  const personalScope = async (here, employee, pin) => {
    const found = [{ company_id: here, employee_id: employee.id }];
    for (const other of await linkedCompanyIds(here)) {
      if (other === here) continue;
      const them = await verifyEmployeePin(pin, other, employee.name);
      if (them) found.push({ company_id: other, employee_id: them.id });
    }
    return found;
  };

  // Someone who really does sell at both.
  const dori = (await c.query(
    `SELECT * FROM pos_employees WHERE user_id = $1 AND LOWER(TRIM(name)) = 'dori' AND active = 1`, [glow])).rows[0];
  const doriDw = (await c.query(
    `SELECT * FROM pos_employees WHERE user_id = $1 AND LOWER(TRIM(name)) = 'dori' AND active = 1`, [dw])).rows[0];

  console.log('\n── Before the stores are linked ──');
  await c.query('DELETE FROM pos_company_links WHERE user_id IN ($1,$2) OR linked_user_id IN ($1,$2)', [glow, dw]);
  let scope = await personalScope(glow, dori, dori.pin);
  check('Dori sees one store', scope.length, 1);
  check('and it is the one she is standing in', scope[0].company_id, glow);

  console.log('\n── Link Glow SF and Desert Wellness ──');
  await c.query(
    `INSERT INTO pos_company_links (user_id, linked_user_id, linked_by) VALUES ($1,$2,'test'), ($2,$1,'test')
     ON CONFLICT DO NOTHING`, [glow, dw]);

  scope = await personalScope(glow, dori, dori.pin);
  check('Dori now sees both', scope.length, 2);
  check('with her own record at each',
    scope.map(s => s.employee_id).sort(), [dori.id, doriDw.id].sort());

  // The figures that were hidden from her.
  const sales = async (uid, empId) => (await c.query(
    `SELECT COUNT(*) n, COALESCE(ROUND(SUM(te.commission_amount)::numeric,2),0) amt
     FROM pos_transaction_employees te JOIN pos_transactions t ON t.id = te.transaction_id
     WHERE te.employee_id = $1 AND t.user_id = $2`, [empId, uid])).rows[0];
  const here = await sales(glow, dori.id), there = await sales(dw, doriDw.id);
  console.log(`        Glow SF ${here.n} sales / $${here.amt}   Desert Wellness ${there.n} sales / $${there.amt}`);
  check('the linked store has figures worth showing', Number(there.amt) > 0, true);

  console.log('\n── The link alone opens nothing ──');
  const wrongPin = await personalScope(glow, { ...dori, id: dori.id }, '0000');
  check('a wrong PIN gets only the store in front of them', wrongPin.length, 1);

  const lonely = (await c.query(
    `SELECT e.* FROM pos_employees e WHERE e.user_id = $1 AND e.active = 1
       AND LOWER(TRIM(e.name)) NOT IN (SELECT LOWER(TRIM(name)) FROM pos_employees WHERE user_id = $2 AND active = 1)
     LIMIT 1`, [glow, dw])).rows[0];
  if (lonely) {
    const s = await personalScope(glow, lonely, lonely.pin);
    check(`someone who only works here (${lonely.name}) still sees one store`, s.length, 1);
  } else {
    console.log('  --   every active name exists at both stores, so nothing to check here');
  }

  console.log('\n── An unlinked store stays shut ──');
  // Give the demo shop an employee with Dori's exact name and PIN: the very
  // collision the link requirement exists to stop.
  await c.query('DELETE FROM pos_employees WHERE user_id = $1 AND name = $2', [demo, 'ZZTestDori']);
  const clash = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id) VALUES ($1,$2,'sales',1,$3) RETURNING *`,
    ['ZZTestDori', dori.pin, demo])).rows[0];
  const clashAtGlow = (await c.query(
    `INSERT INTO pos_employees (name, pin, role, active, user_id) VALUES ($1,$2,'sales',1,$3) RETURNING *`,
    ['ZZTestDori', dori.pin, glow])).rows[0];
  const collide = await personalScope(glow, clashAtGlow, dori.pin);
  check('same name and PIN at an UNLINKED store opens nothing', collide.length, 1);
  check('and the store it opens is this one', collide[0].company_id, glow);

  console.log('\n── Tidy up ──');
  await c.query('DELETE FROM pos_employees WHERE id = ANY($1::int[])', [[clash.id, clashAtGlow.id]]);
  await c.query('DELETE FROM pos_company_links WHERE user_id IN ($1,$2) OR linked_user_id IN ($1,$2)', [glow, dw]);
  const left = await c.query('SELECT COUNT(*) n FROM pos_company_links');
  check('no links left behind', Number(left.rows[0].n), 0);
  const stray = await c.query("SELECT COUNT(*) n FROM pos_employees WHERE name = 'ZZTestDori'");
  check('no test staff left behind', Number(stray.rows[0].n), 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
