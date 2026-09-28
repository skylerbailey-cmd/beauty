'use strict';
// One-off repairs to sales brought over from the previous till, found by
// putting its own export next to what landed here.
//
//   1. A sale that never existed there at all — receipt 1502-1236LC2,
//      $80,000 against Sal. It inflated his commission by $36,000 and every
//      KPI it touched.
//
//   2. Four sales split between two or three people that arrived credited to
//      one. 294 of the 299 split sales imported correctly; these four did
//      not. The percentages below are the old till's own, read off its
//      receipts — they are NOT even splits, so they cannot be inferred.
//
//   3. Mor and Enrique are the same person. Everything credited to Mor
//      belongs to Enrique.
//
//   node scripts/repair-imported-sales.js [--write]
//
// Without --write it prints what it would do and changes nothing.

const path = require('path');
const { Client } = require('pg');

const DELETE_RECEIPT = '1502-1236LC2';

// receipt -> [[name, percent], ...] exactly as the old till recorded it.
const SPLITS = {
  '1501-1323LC1': [['Sal', 50], ['Tal', 25], ['Roy', 25]],
  '1501-1322LC1': [['Roy', 25], ['Sal', 50], ['Tal', 25]],
  '1501-1319LC1': [['Tal', 50], ['Omri', 50]],
  '1502-1295LC2': [['Tal', 50], ['Sagiv', 50]],
};

const MERGE = { from: 'mor', into: 'enrique' };

const write = process.argv.includes('--write');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('set DATABASE_URL'); process.exit(1); }
const money = (n) => Math.round(Number(n) * 100) / 100;

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const say = (s) => console.log(s);
  say(`\n${write ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);

  // ── 1. the sale that never happened ──
  const gone = (await c.query(
    `SELECT t.id, t.subtotal, s.store_name, t.customer_name
       FROM pos_transactions t JOIN pos_settings s ON s.user_id = t.user_id
      WHERE t.receipt_number = $1`, [DELETE_RECEIPT])).rows;
  say('1. Remove the sale that is not in the old till');
  for (const t of gone) {
    say(`   ${DELETE_RECEIPT}  ${t.store_name}  $${money(t.subtotal).toFixed(2)}  ${t.customer_name || ''}`);
    if (!write) continue;
    for (const tbl of ['pos_transaction_items', 'pos_transaction_payments', 'pos_transaction_employees']) {
      await c.query(`DELETE FROM ${tbl} WHERE transaction_id = $1`, [t.id]);
    }
    await c.query('DELETE FROM pos_chargeback_holds WHERE chargeback_id IN (SELECT id FROM pos_transaction_chargebacks WHERE transaction_id = $1)', [t.id]);
    await c.query('DELETE FROM pos_transaction_chargebacks WHERE transaction_id = $1', [t.id]);
    await c.query('DELETE FROM pos_transactions WHERE id = $1', [t.id]);
  }
  if (!gone.length) say('   already gone');

  // ── 2. the splits ──
  say('\n2. Restore who each split sale belonged to');
  for (const [receipt, people] of Object.entries(SPLITS)) {
    const t = (await c.query(
      `SELECT t.id, t.subtotal, t.user_id, s.store_name FROM pos_transactions t
         JOIN pos_settings s ON s.user_id = t.user_id WHERE t.receipt_number = $1`, [receipt])).rows[0];
    if (!t) { say(`   ${receipt}: not found`); continue; }
    const before = (await c.query(
      `SELECT e.name, te.commission_value pct, te.commission_amount amt
         FROM pos_transaction_employees te JOIN pos_employees e ON e.id = te.employee_id
        WHERE te.transaction_id = $1 ORDER BY e.name`, [t.id])).rows;
    say(`   ${receipt}  ${t.store_name}  $${money(t.subtotal).toFixed(2)}`);
    say('      now:    ' + (before.map((b) => `${b.name} ${Number(b.pct)}% ($${money(b.amt).toFixed(2)})`).join(', ') || 'nobody'));

    const rows = [];
    let ok = true;
    for (const [name, pct] of people) {
      const e = (await c.query(
        `SELECT id FROM pos_employees WHERE user_id = $1 AND LOWER(TRIM(name)) = LOWER($2) ORDER BY active DESC LIMIT 1`,
        [t.user_id, name])).rows[0];
      if (!e) { say(`      !! no employee "${name}" at ${t.store_name}`); ok = false; continue; }
      rows.push({ id: e.id, name, pct, amt: money(Number(t.subtotal) * pct / 100) });
    }
    if (!ok) continue;
    const sum = money(rows.reduce((s, r) => s + r.amt, 0));
    say('      should: ' + rows.map((r) => `${r.name} ${r.pct}% ($${r.amt.toFixed(2)})`).join(', ')
      + `   = $${sum.toFixed(2)}`);
    if (Math.abs(sum - money(t.subtotal)) > 0.01) {
      say(`      !! the shares come to $${sum.toFixed(2)}, the sale is $${money(t.subtotal).toFixed(2)} — skipped`);
      continue;
    }
    if (!write) continue;
    await c.query('DELETE FROM pos_transaction_employees WHERE transaction_id = $1', [t.id]);
    for (const r of rows) {
      await c.query(
        `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
         VALUES ($1, $2, 'percent', $3, $4)`, [t.id, r.id, r.pct, r.amt]);
    }
  }

  // ── 3. one person, one name ──
  say(`\n3. Credit ${MERGE.into} with everything recorded against ${MERGE.from}`);
  const moves = (await c.query(
    `SELECT te.id te_id, te.employee_id, t.receipt_number, s.store_name, e.user_id,
            te.commission_amount amt
       FROM pos_transaction_employees te
       JOIN pos_employees e ON e.id = te.employee_id
       JOIN pos_transactions t ON t.id = te.transaction_id
       JOIN pos_settings s ON s.user_id = e.user_id
      WHERE LOWER(TRIM(e.name)) = $1 ORDER BY t.created_at`, [MERGE.from])).rows;
  let moved = 0;
  for (const m of moves) {
    const target = (await c.query(
      `SELECT id FROM pos_employees WHERE user_id = $1 AND LOWER(TRIM(name)) = $2 ORDER BY active DESC LIMIT 1`,
      [m.user_id, MERGE.into])).rows[0];
    if (!target) { say(`   !! no ${MERGE.into} at ${m.store_name} — ${m.receipt_number} left alone`); continue; }
    say(`   ${m.receipt_number.padEnd(17)}${m.store_name.padEnd(17)}$${money(m.amt).toFixed(2).padStart(10)}  ->  ${MERGE.into}`);
    moved++;
    if (!write) continue;
    // If the target is already credited on this sale, fold the two together
    // rather than leaving the person on it twice.
    const dup = (await c.query(
      'SELECT id, commission_amount FROM pos_transaction_employees WHERE transaction_id = (SELECT transaction_id FROM pos_transaction_employees WHERE id = $1) AND employee_id = $2',
      [m.te_id, target.id])).rows[0];
    if (dup) {
      await c.query('UPDATE pos_transaction_employees SET commission_amount = $2 WHERE id = $1',
        [dup.id, money(Number(dup.commission_amount) + Number(m.amt))]);
      await c.query('DELETE FROM pos_transaction_employees WHERE id = $1', [m.te_id]);
    } else {
      await c.query('UPDATE pos_transaction_employees SET employee_id = $2 WHERE id = $1', [m.te_id, target.id]);
    }
  }
  say(`   ${moved} lines`);

  say(write ? '\nDone.\n' : '\nNothing written. Re-run with --write to apply.\n');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
