'use strict';
// A dispute won today gives money back. This checks it is given back on a
// cheque that has not gone out yet.
//
// The bug this locks out: a payday only counted as "gone out" once somebody
// pressed Mark as paid, and shops forget. So a dispute won in late September,
// whose commission was held on the 15th, released onto the 15th — a cheque
// handed out a fortnight earlier. The money went somewhere nobody would look
// at again, and the person never saw it.
//
// Needs the real database: this is a question about real paydays and real
// holds, and a fixture would only prove the fixture agrees with itself.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const pgDb = require('../src/db/postgres');

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

const today = new Date().toISOString().slice(0, 10);

// The paydays around now, on the default 1st-and-15th schedule.
function paydaysAround() {
  const out = [];
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - 3);
  for (let i = 0; i < 8; i++) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-15`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

(async () => {
  const companies = await pgDb.getAllCompanyIds();
  console.log(`\nChecking ${companies.length} companies\n`);

  // Releases already pinned to a payday: those were settled when that payday
  // was marked paid and are meant to stay where they are.
  const pinned = new Set();
  {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const rows = await c.query(
      'SELECT chargeback_id::text AS id FROM pos_chargeback_holds WHERE released_payday IS NOT NULL');
    for (const r of rows.rows) pinned.add(r.id);
    await c.end();
  }

  // Every won dispute that had commission held, and the payday it was held on.
  const held = [];
  {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const rows = await c.query(`
      SELECT h.chargeback_id::text AS id, h.employee_id, h.held_payday::text AS held,
             cb.user_id, cb.closed_at::text AS closed
      FROM pos_chargeback_holds h
      JOIN pos_transaction_chargebacks cb ON cb.id = h.chargeback_id
      WHERE cb.status = 'won' AND h.held_payday IS NOT NULL`);
    held.push(...rows.rows);
    await c.end();
  }

  // Where each release actually turns up across every payday in the window.
  const landedOn = new Map();   // chargeback id -> [paydays]
  let checkedPaydays = 0;
  for (const { user_id } of companies) {
    const settings = await pgDb.getSettings(user_id);
    for (const payday of paydaysAround()) {
      const run = await pgDb.payrollForPayday(user_id, payday, settings);
      checkedPaydays++;
      for (const e of run.employees) {
        for (const a of (e.adjustments || [])) {
          if (a.kind !== 'won') continue;
          const key = String(a.chargeback_id);
          if (!landedOn.has(key)) landedOn.set(key, []);
          landedOn.get(key).push(payday);
        }
      }
    }
  }

  console.log(`${checkedPaydays} paydays, ${held.length} won disputes that had money held\n`);

  const goneAlready = held.filter(h => h.held < today && !pinned.has(h.id));
  const missing = [];
  const stale = [];
  for (const h of goneAlready) {
    const where = landedOn.get(h.id) || [];
    if (!where.length) {
      missing.push(`$held on ${h.held}, won ${String(h.closed).slice(0, 10)} — no release anywhere`);
      continue;
    }
    for (const p of where) if (p < today) stale.push(`held ${h.held} -> released ${p}, already gone`);
  }

  // Whether there is anything to check depends on live data: a payday that is
  // reopened releases the holds it was carrying, which can empty the sample
  // entirely. Say so loudly and stop, rather than reporting a pass that
  // checked nothing — a green tick on an empty sample is worse than a fail.
  if (!goneAlready.length) {
    console.log('  ----  NOTHING TO CHECK: no won dispute currently has commission held');
    console.log('        on a payday that has passed, so this run proves nothing.');
    console.log('        (Holds are created when a payday is marked paid and released');
    console.log('        when it is reopened.)\n');
    process.exit(0);
  }
  check('every one of them is actually paid back somewhere',
    missing.length === 0, missing.slice(0, 5).join('\n        '));
  check('and never on a cheque that has already gone',
    stale.length === 0, stale.slice(0, 5).join('\n        '));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
