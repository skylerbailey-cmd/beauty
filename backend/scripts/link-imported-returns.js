#!/usr/bin/env node
//
// Backfill the missing link from an imported return to the sale it reverses.
//
// Returns rung up in SkySale carry original_sale_date, so commission counts
// them against the day the item was sold rather than the day it came back.
// Returns brought over from the prior POS have no such link, so they land on
// their own date — which drops them in the wrong pay period, sometimes months
// from the sale, and in one case turned an employee's fortnight negative.
//
// The prior POS numbered a return as "R" + the sale's receipt + "-HHMM", so the
// sale can be recovered from the receipt number. Only exact matches within the
// same company are touched; anything ambiguous is reported and left alone.
//
// Dry run by default. Pass --apply to write.
//
//   node scripts/link-imported-returns.js
//   node scripts/link-imported-returns.js --apply

const APPLY = process.argv.includes('--apply');
const pg = require('../src/db/postgres');

const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The half-month a date falls in — how commission periods are run, and so the
// unit that actually matters here: a move inside one period changes nothing.
const periodOf = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return day <= 15
    ? `${y}-${String(m).padStart(2, '0')} 1st–15th`
    : `${y}-${String(m).padStart(2, '0')} 16th–${last}`;
};

async function main() {
  // Candidate returns and the sale each one's receipt points at. The suffix is
  // stripped to find the sale; matching is confined to the same company so a
  // receipt reused across stores can't cross over.
  const rows = (await pg.pool.query(`
    SELECT r.id AS return_id, r.receipt_number AS ret, r.subtotal AS ret_subtotal,
      r.created_at::date::text AS rung_up, r.user_id, st.store_name,
      sa.id AS sale_id, sa.receipt_number AS sale,
      sa.created_at AS sale_created_at, sa.created_at::date::text AS sale_date,
      sa.subtotal AS sale_subtotal,
      (SELECT COUNT(*) FROM pos_transactions c
        WHERE c.user_id = r.user_id AND c.type = 'sale'
          AND c.receipt_number = regexp_replace(regexp_replace(r.receipt_number, '^R', ''), '-[0-9]{3,4}$', '')
      ) AS match_count
    FROM pos_transactions r
    JOIN pos_settings st ON st.user_id = r.user_id
    LEFT JOIN pos_transactions sa
      ON sa.user_id = r.user_id AND sa.type = 'sale'
     AND sa.receipt_number = regexp_replace(regexp_replace(r.receipt_number, '^R', ''), '-[0-9]{3,4}$', '')
    WHERE r.type = 'return' AND r.original_sale_date IS NULL
    ORDER BY st.store_name, r.created_at
  `)).rows;

  const linkable = [], skipped = [];
  for (const r of rows) {
    if (!r.sale_id) skipped.push({ ...r, why: 'no sale with that receipt number' });
    else if (Number(r.match_count) > 1) skipped.push({ ...r, why: `${r.match_count} sales share that receipt` });
    else if (r.sale_date > r.rung_up) skipped.push({ ...r, why: `sale ${r.sale_date} is after the return ${r.rung_up}` });
    else linkable.push(r);
  }

  const moving = linkable.filter(r => periodOf(r.sale_date) !== periodOf(r.rung_up));
  const sameP = linkable.length - moving.length;

  console.log(`\nImported returns with no link to their sale: ${rows.length}`);
  console.log(`  linkable: ${linkable.length}   (${moving.length} change pay period, ${sameP} already in the right one)`);
  console.log(`  skipped:  ${skipped.length}`);

  if (skipped.length) {
    console.log('\nSKIPPED — left exactly as they are:');
    for (const r of skipped) {
      console.log(`  ${r.store_name.padEnd(16)} ${r.ret.padEnd(24)} ${r.rung_up}  ${money(r.ret_subtotal).padStart(12)}  — ${r.why}`);
    }
  }

  // What this does to commission: every employee credited on a moving return
  // has their share leave one period and arrive in another.
  const ids = moving.map(r => r.return_id);
  const shares = ids.length ? (await pg.pool.query(`
    SELECT te.transaction_id, e.name AS employee,
      CASE
        WHEN te.commission_amount IS NOT NULL AND te.commission_amount <> 0 THEN te.commission_amount
        WHEN te.commission_type = 'dollar' THEN COALESCE(te.commission_value, 0)
        ELSE t.subtotal * COALESCE(te.commission_value, 100) / 100.0
      END AS share,
      COALESCE(e.commission_rate, 0) AS rate
    FROM pos_transaction_employees te
    JOIN pos_employees e ON e.id = te.employee_id
    JOIN pos_transactions t ON t.id = te.transaction_id
    WHERE te.transaction_id = ANY($1::int[])
  `, [ids])).rows : [];
  const sharesByReturn = new Map();
  for (const s of shares) {
    if (!sharesByReturn.has(s.transaction_id)) sharesByReturn.set(s.transaction_id, []);
    sharesByReturn.get(s.transaction_id).push(s);
  }

  if (moving.length) {
    console.log('\nRETURNS THAT MOVE TO ANOTHER PAY PERIOD:');
    for (const r of moving) {
      console.log(`  ${r.store_name.padEnd(16)} ${r.ret.padEnd(24)} ${money(r.ret_subtotal).padStart(12)} of sale ${r.sale} ${money(r.sale_subtotal)}`);
      console.log(`  ${''.padEnd(16)} ${''.padEnd(24)} ${periodOf(r.rung_up)}  →  ${periodOf(r.sale_date)}   (rung up ${r.rung_up}, sold ${r.sale_date})`);
    }
  }

  // Net commission change per employee, per store, per period.
  const delta = new Map();
  const bump = (store, employee, period, amount) => {
    const k = `${store}|${employee}|${period}`;
    delta.set(k, (delta.get(k) || 0) + amount);
  };
  for (const r of moving) {
    for (const s of sharesByReturn.get(r.return_id) || []) {
      const commission = Number(s.share) * Number(s.rate) / 100;
      bump(r.store_name, s.employee, periodOf(r.rung_up), commission);   // deduction leaves here
      bump(r.store_name, s.employee, periodOf(r.sale_date), -commission); // and arrives here
    }
  }

  if (delta.size) {
    console.log('\nCOMMISSION EFFECT — per employee, per store, per period:');
    const keys = [...delta.keys()].sort();
    let lastEmp = '';
    for (const k of keys) {
      const amount = delta.get(k);
      if (Math.abs(amount) < 0.005) continue;
      const [store, employee, period] = k.split('|');
      const head = `${employee} — ${store}`;
      console.log(`  ${(head === lastEmp ? '' : head).padEnd(24)} ${period.padEnd(20)} ${(amount > 0 ? '+' : '') + money(amount)}`);
      lastEmp = head;
    }
    console.log('\n  (+ = that period pays more once the return leaves it,');
    console.log('   − = that period pays less once the return arrives)');
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to link ${linkable.length} return${linkable.length === 1 ? '' : 's'}.\n`);
    return;
  }

  // One transaction, so either every return is linked or none is. The guard on
  // original_sale_date IS NULL makes a second run a no-op rather than a
  // re-write, so this is safe to repeat.
  let n = 0;
  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of linkable) {
      const u = await client.query(
        `UPDATE pos_transactions SET original_sale_date = $2, original_transaction_id = $3
         WHERE id = $1 AND type = 'return' AND original_sale_date IS NULL`,
        [r.return_id, r.sale_created_at, r.sale_id]);
      n += u.rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const left = (await pg.pool.query(
    `SELECT COUNT(*)::int AS n FROM pos_transactions WHERE type = 'return' AND original_sale_date IS NULL`)).rows[0].n;
  console.log(`\nLinked ${n} return${n === 1 ? '' : 's'}. Still unlinked: ${left} (the skipped ones above).\n`);
}

main()
  .then(() => pg.pool.end())
  .catch(err => { console.error('FAILED:', err.message); pg.pool.end(); process.exit(1); });
