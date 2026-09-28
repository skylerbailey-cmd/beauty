'use strict';
// Re-record what a payday's cheques actually came to.
//
// A cheque below zero pays nothing, and what it was short by follows the
// person onto the next one. That carry reads the balance recorded at the
// moment the payday was closed — so if the figures change afterwards (a
// dispute pinned to that cheque, a hold corrected), the snapshot goes stale
// and the carry silently stops happening.
//
// A person is paid ONCE across the shops they work at, so the balance that
// matters is their combined one. Someone who came to −$905.40 at one shop and
// +$252.00 at the other was handed nothing and owes $653.40 — not $905.40.
// The net is recorded against the shop carrying the shortfall and the other
// is zeroed, so the carry moves exactly what is owed.
//
//   node scripts/record-payday-balances.js <payday> [--write]
//
// Without --write it prints what it would change and touches nothing.

const path = require('path');
const { Client } = require('pg');
const pgDb = require(path.join(__dirname, '..', 'src', 'db', 'postgres'));

const payday = process.argv[2];
const write = process.argv.includes('--write');
const DB = process.env.DATABASE_URL;

if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payday || '')) || !DB) {
  console.error('usage: DATABASE_URL=... node scripts/record-payday-balances.js <YYYY-MM-DD> [--write]');
  process.exit(1);
}

const money = (n) => Math.round(Number(n) * 100) / 100;

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Only shops that actually closed this payday. A balance is the record of
  // what a cheque paid; a payday nobody has marked paid has not paid anything
  // yet, and writing one would invent a settlement that never happened.
  const shops = (await c.query(
    `SELECT s.user_id, s.store_name FROM pos_settings s
      JOIN pos_payroll_runs r ON r.user_id = s.user_id AND r.payday = $1::date AND r.paid_at IS NOT NULL
      WHERE TRIM(COALESCE(s.store_name,'')) <> '' ORDER BY s.store_name`, [payday])).rows;
  if (!shops.length) {
    console.log(`\nNo shop has marked ${payday} as paid, so there is nothing to record.\n`);
    await c.end();
    return;
  }

  // What each person's cheque comes to now, per shop, keyed by their name so
  // the same person at two shops is one balance.
  const people = new Map();
  for (const shop of shops) {
    const settings = await pgDb.getSettings(shop.user_id);
    if (!settings) continue;
    const run = await pgDb.payrollForPayday(shop.user_id, payday, settings);
    for (const e of run.employees) {
      const key = String(e.employee_name).trim().toLowerCase();
      if (!people.has(key)) people.set(key, { name: e.employee_name, rows: [] });
      people.get(key).rows.push({
        employee_id: e.employee_id, user_id: shop.user_id,
        store: shop.store_name, now: money(e.total),
      });
    }
  }

  const changes = [];
  for (const { name, rows } of people.values()) {
    const combined = money(rows.reduce((s, r) => s + r.now, 0));
    // Only a person who ended up owing anything needs the netting. Everyone
    // else keeps their own shop's figure.
    const negative = combined < 0;
    let assigned = false;
    for (const r of rows) {
      // The shortfall sits on the shop that caused it; the other is zeroed so
      // the two do not carry twice over.
      let target = r.now;
      if (negative) {
        if (!assigned && r.now < 0) { target = combined; assigned = true; }
        else target = 0;
      }
      const prev = (await c.query(
        'SELECT net_total FROM pos_payroll_balances WHERE payday = $1::date AND employee_id = $2',
        [payday, r.employee_id])).rows[0];
      const was = prev ? Number(prev.net_total) : null;
      if (was !== null && Math.abs(was - target) < 0.005) continue;
      changes.push({ ...r, name, was, target, combined });
    }
  }

  if (!changes.length) {
    console.log(`\nEvery balance on ${payday} already matches. Nothing to do.\n`);
    await c.end();
    return;
  }

  console.log(`\n${write ? 'Recording' : 'WOULD record'} on ${payday}:\n`);
  for (const ch of changes) {
    console.log('   ' + ch.name.padEnd(10) + ch.store.padEnd(18)
      + (ch.was === null ? '(none)' : '$' + ch.was.toFixed(2)).padStart(11)
      + '  ->  $' + ch.target.toFixed(2).padStart(10)
      + (ch.target < 0 ? '   carries to the next payday' : ''));
  }

  if (!write) {
    console.log('\nNothing written. Re-run with --write to apply.\n');
    await c.end();
    return;
  }

  for (const ch of changes) {
    await c.query(
      `INSERT INTO pos_payroll_balances (payday, employee_id, user_id, net_total, recorded_at)
       VALUES ($1::date, $2, $3, $4, NOW())
       ON CONFLICT (payday, employee_id)
         DO UPDATE SET net_total = EXCLUDED.net_total, recorded_at = NOW()`,
      [payday, ch.employee_id, ch.user_id, ch.target]);
  }
  console.log(`\nRecorded ${changes.length} balances.\n`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
