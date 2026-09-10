#!/usr/bin/env node
//
// Make a return credit the same people, in the same proportions, as the sale
// it reverses.
//
// Commission on a return is a clawback: it takes back what the sale paid out.
// So it has to follow the sale's split, or someone gives back commission they
// never earned while someone else keeps commission on a sale that went away.
// A few imported returns credit one person for the whole amount even though
// the sale was split between two — for the largest, one employee was carrying
// $7,302.66 of clawback alone on a sale he was credited half of.
//
// Only returns linked to their sale are considered, and only where the return
// was NOT deliberately re-credited (employees_changed = 0) — that flag means a
// person chose the split, which is a decision, not a defect.
//
// Dry run by default. Pass --apply to write.
//
//   node scripts/realign-return-splits.js
//   node scripts/realign-return-splits.js --apply

const APPLY = process.argv.includes('--apply');
const pg = require('../src/db/postgres');

const money = (n) => '$' + Number(n).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function main() {
  const candidates = (await pg.pool.query(`
    SELECT r.id AS return_id, r.receipt_number AS ret, r.subtotal AS ret_subtotal,
      r.created_at::date::text AS rung_up, r.customer_name, st.store_name,
      sa.id AS sale_id, sa.receipt_number AS sale, sa.subtotal AS sale_subtotal
    FROM pos_transactions r
    JOIN pos_settings st ON st.user_id = r.user_id
    JOIN pos_transactions sa ON sa.id = r.original_transaction_id AND sa.type = 'sale'
    WHERE r.type = 'return' AND COALESCE(r.employees_changed, 0) = 0
    ORDER BY st.store_name, r.created_at
  `)).rows;

  const plans = [];
  for (const c of candidates) {
    const saleSplit = (await pg.pool.query(`
      SELECT e.id AS employee_id, e.name, te.commission_type, te.commission_value
      FROM pos_transaction_employees te JOIN pos_employees e ON e.id = te.employee_id
      WHERE te.transaction_id = $1 ORDER BY e.id`, [c.sale_id])).rows;
    const retSplit = (await pg.pool.query(`
      SELECT te.id AS row_id, e.id AS employee_id, e.name,
             te.commission_type, te.commission_value, te.commission_amount
      FROM pos_transaction_employees te JOIN pos_employees e ON e.id = te.employee_id
      WHERE te.transaction_id = $1 ORDER BY e.id`, [c.return_id])).rows;
    if (!saleSplit.length || !retSplit.length) continue;

    const same = saleSplit.length === retSplit.length
      && saleSplit.every((s, i) => s.employee_id === retSplit[i].employee_id
        && s.commission_type === retSplit[i].commission_type
        && Number(s.commission_value) === Number(retSplit[i].commission_value));
    if (same) continue;

    // A percentage split is a share of this return's own subtotal; a flat
    // dollar amount can't be rescaled, so it carries over untouched.
    const target = saleSplit.map(s => {
      const type = s.commission_type || 'percent';
      const value = Number(s.commission_value);
      const existing = retSplit.find(r => r.employee_id === s.employee_id);
      return {
        employee_id: s.employee_id, name: s.name, type, value,
        amount: type === 'dollar' ? round2(value) : round2(Number(c.ret_subtotal) * value / 100),
        row_id: existing ? existing.row_id : null,
        was: existing ? { value: Number(existing.commission_value), amount: Number(existing.commission_amount) } : null,
      };
    });
    const drop = retSplit.filter(r => !saleSplit.some(s => s.employee_id === r.employee_id));
    plans.push({ ...c, saleSplit, retSplit, target, drop });
  }

  console.log(`\nLinked returns whose split disagrees with their sale: ${plans.length}`);
  if (!plans.length) { console.log('Nothing to realign.\n'); return; }

  for (const p of plans) {
    console.log(`\n  ${p.store_name} — ${p.ret}   (rung up ${p.rung_up}, reverses ${p.sale}, ${p.customer_name})`);
    console.log(`    sale   ${money(p.sale_subtotal).padStart(12)}   ${p.saleSplit.map(s => `${s.name} ${s.commission_value}%`).join(' / ')}`);
    console.log(`    return ${money(p.ret_subtotal).padStart(12)}   ${p.retSplit.map(s => `${s.name} ${s.commission_value}%`).join(' / ')}   ← becomes the sale's split`);
    for (const t of p.target) {
      if (!t.was) console.log(`      ${t.name.padEnd(10)} (not credited)      →  ${String(t.value).padStart(3)}%  ${money(t.amount).padStart(12)}  clawback added`);
      else if (t.was.value !== t.value) console.log(`      ${t.name.padEnd(10)} ${String(t.was.value).padStart(3)}% ${money(t.was.amount).padStart(12)}  →  ${String(t.value).padStart(3)}%  ${money(t.amount).padStart(12)}  clawback ${t.amount < t.was.amount ? 'drops' : 'rises'} by ${money(Math.abs(t.was.amount - t.amount))}`);
      else console.log(`      ${t.name.padEnd(10)} ${String(t.value).padStart(3)}% ${money(t.amount).padStart(12)}   (unchanged)`);
    }
    for (const d of p.drop) console.log(`      ${d.name.padEnd(10)} ${money(d.commission_amount).padStart(12)}  →  removed (not credited on the sale)`);
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.\n'); return; }

  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plans) {
      for (const d of p.drop) {
        await client.query('DELETE FROM pos_transaction_employees WHERE id = $1', [d.row_id]);
      }
      for (const t of p.target) {
        if (t.row_id) {
          await client.query(
            `UPDATE pos_transaction_employees
             SET commission_type = $2, commission_value = $3, commission_amount = $4 WHERE id = $1`,
            [t.row_id, t.type, t.value, t.amount]);
        } else {
          await client.query(
            `INSERT INTO pos_transaction_employees
               (transaction_id, employee_id, commission_type, commission_value, commission_amount)
             VALUES ($1, $2, $3, $4, $5)`,
            [p.return_id, t.employee_id, t.type, t.value, t.amount]);
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nRealigned ${plans.length} return${plans.length === 1 ? '' : 's'}.\n`);
}

main()
  .then(() => pg.pool.end())
  .catch(err => { console.error('FAILED:', err.message); pg.pool.end(); process.exit(1); });
