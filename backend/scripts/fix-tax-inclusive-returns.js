#!/usr/bin/env node
//
// Repair imported returns that booked the sale's gross total as subtotal.
//
// Commission is paid on subtotal, never on tax. A handful of returns came over
// from the prior POS with the tax-inclusive figure in the subtotal column and
// zero tax, so they claw back commission on tax the employee was never paid on.
// The tell is exact: the return's subtotal equals the original sale's TOTAL.
//
// These same rows also carry an employee split that doesn't match the sale
// they reverse, so a return can take commission off someone in a different
// proportion than they earned it. Where the sale's split is known and the
// return was not deliberately re-credited (employees_changed = 0), the split is
// put back to the sale's.
//
// Only rows matching the tell are touched, and the total charged to the
// customer is never changed — the money is just split correctly between
// subtotal and tax.
//
// Dry run by default. Pass --apply to write.
//
//   node scripts/fix-tax-inclusive-returns.js
//   node scripts/fix-tax-inclusive-returns.js --apply

const APPLY = process.argv.includes('--apply');
const pg = require('../src/db/postgres');

const money = (n) => '$' + Number(n).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function main() {
  const targets = (await pg.pool.query(`
    SELECT r.id AS return_id, r.receipt_number AS ret, r.subtotal AS ret_subtotal,
      r.tax_amount AS ret_tax, r.total AS ret_total, r.employees_changed,
      r.created_at::date::text AS rung_up, st.store_name,
      sa.id AS sale_id, sa.receipt_number AS sale,
      sa.subtotal AS sale_subtotal, sa.tax_amount AS sale_tax, sa.total AS sale_total
    FROM pos_transactions r
    JOIN pos_settings st ON st.user_id = r.user_id
    JOIN pos_transactions sa ON sa.id = r.original_transaction_id AND sa.type = 'sale'
    WHERE r.type = 'return'
      -- the tell: gross booked as subtotal, and no tax recorded against it
      AND ABS(r.subtotal - sa.total) < 0.02
      AND r.subtotal > sa.subtotal + 0.01
      AND COALESCE(r.tax_amount, 0) = 0
    ORDER BY r.created_at
  `)).rows;

  console.log(`\nReturns with the sale's gross total booked as subtotal: ${targets.length}`);
  if (!targets.length) { console.log('Nothing to repair.\n'); return; }

  const plans = [];
  for (const t of targets) {
    // The refund covered the whole sale, so it splits the same way the sale did.
    const newSubtotal = round2(t.sale_subtotal);
    const newTax = round2(Number(t.ret_total) - newSubtotal);

    const saleSplit = (await pg.pool.query(`
      SELECT e.id AS employee_id, e.name, te.commission_type, te.commission_value
      FROM pos_transaction_employees te JOIN pos_employees e ON e.id = te.employee_id
      WHERE te.transaction_id = $1 ORDER BY e.name`, [t.sale_id])).rows;
    const retSplit = (await pg.pool.query(`
      SELECT te.id AS row_id, e.id AS employee_id, e.name,
             te.commission_type, te.commission_value, te.commission_amount
      FROM pos_transaction_employees te JOIN pos_employees e ON e.id = te.employee_id
      WHERE te.transaction_id = $1 ORDER BY e.name`, [t.return_id])).rows;

    // Realign only when it's the same people and the return wasn't deliberately
    // re-credited — otherwise the existing split is somebody's decision, not a
    // defect, and only the subtotal gets fixed.
    const samePeople = saleSplit.length === retSplit.length
      && saleSplit.every((s, i) => s.employee_id === retSplit[i].employee_id);
    const realign = samePeople && !t.employees_changed;

    const lines = retSplit.map((r, i) => {
      const src = realign ? saleSplit[i] : r;
      const type = src.commission_type || 'percent';
      const value = Number(src.commission_value);
      const amount = type === 'dollar' ? round2(value) : round2(newSubtotal * value / 100);
      return { row_id: r.row_id, name: r.name, type, value, amount,
               was_value: Number(r.commission_value), was_amount: Number(r.commission_amount) };
    });

    plans.push({ ...t, newSubtotal, newTax, realign, samePeople, lines });
  }

  for (const p of plans) {
    console.log(`\n  ${p.store_name} — ${p.ret}   (rung up ${p.rung_up}, reverses ${p.sale})`);
    console.log(`    sale was:  subtotal ${money(p.sale_subtotal)} + tax ${money(p.sale_tax)} = ${money(p.sale_total)}`);
    console.log(`    return is: subtotal ${money(p.ret_subtotal)} + tax ${money(p.ret_tax)} = ${money(p.ret_total)}`);
    console.log(`    becomes:   subtotal ${money(p.newSubtotal)} + tax ${money(p.newTax)} = ${money(p.ret_total)}   (customer refund unchanged)`);
    if (!p.realign) {
      console.log(`    split left as-is (${p.samePeople ? 'return was deliberately re-credited' : 'different people than the sale'})`);
    }
    for (const l of p.lines) {
      const diff = l.was_amount - l.amount;
      const changed = l.was_value !== l.value || Math.abs(diff) >= 0.005;
      console.log(`      ${l.name.padEnd(8)} ${String(l.was_value).padStart(3)}% ${money(l.was_amount).padStart(12)}`
        + (changed
          ? `  →  ${String(l.value).padStart(3)}% ${money(l.amount).padStart(12)}   clawback ${diff >= 0 ? 'drops' : 'rises'} by ${money(Math.abs(diff))}`
          : '   (unchanged)'));
    }
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.\n`);
    return;
  }

  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plans) {
      await client.query(
        `UPDATE pos_transactions SET subtotal = $2, tax_amount = $3 WHERE id = $1 AND type = 'return'`,
        [p.return_id, p.newSubtotal, p.newTax]);
      // The line item is the same placeholder figure and drives the receipt.
      await client.query(
        `UPDATE pos_transaction_items SET unit_price = $2, line_total = $2 WHERE transaction_id = $1`,
        [p.return_id, p.newSubtotal]);
      for (const l of p.lines) {
        await client.query(
          `UPDATE pos_transaction_employees SET commission_type = $2, commission_value = $3, commission_amount = $4 WHERE id = $1`,
          [l.row_id, l.type, l.value, l.amount]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nRepaired ${plans.length} return${plans.length === 1 ? '' : 's'}.\n`);
}

main()
  .then(() => pg.pool.end())
  .catch(err => { console.error('FAILED:', err.message); pg.pool.end(); process.exit(1); });
