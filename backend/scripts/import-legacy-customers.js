'use strict';
// The client list from the till the shop used before SkySale.
//
// Two things make this one awkward enough to be worth a script rather than
// the importer in Settings.
//
//   1. It is ONE file for TWO shops. 731 people, and the shop they belong to
//      is not written anywhere in it. Importing it while signed into Glow SF
//      would give Glow SF three hundred and seventy-five Desert Wellness
//      customers who have never set foot in it. Who belongs where IS knowable
//      though — from the receipts. Every row is placed at the shop (or shops)
//      that has actually sold to that person.
//
//   2. Most of them are already here. 597 of the 731 were created from their
//      own sales as the transactions were brought over. What is missing is
//      the other 134, plus the phone numbers for the people who only ever
//      appear as a name on a receipt.
//
// Nothing is overwritten. A field is only ever filled when it is empty here,
// so a number somebody typed in by hand always wins over the old till's.
//
//   node scripts/import-legacy-customers.js [file.csv] [--write]
//
// Without --write it prints what it would do and changes nothing.

const fs = require('fs');
const { Client } = require('pg');

const STORES = ['Glow SF', 'Desert Wellness'];

const args = process.argv.slice(2);
const write = args.includes('--write');
const FILE = args.find((a) => !a.startsWith('--')) || '/Users/skyler/Downloads/customers.csv';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('set DATABASE_URL'); process.exit(1); }

// ── Reading the file ────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// The old till wrote the word "none" into every empty email, phone and note,
// and "0000-00-00" into every empty birthday. Kept literally, 717 people would
// share the email address "none" — and since a customer is recognised BY their
// email, the whole list would collapse onto one record.
const BLANKS = new Set(['none', 'n/a', 'na', 'null', '-', '0000-00-00', '0000-00-00 00:00:00', '']);
const val = (v) => {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return BLANKS.has(s.toLowerCase()) ? '' : s;
};
// A number we can't dial is not a contact detail — thirty of these are
// four-digit extensions and room numbers.
const ten = (v) => {
  const d = val(v).replace(/\D/g, '');
  return d.length >= 10 && !/^(\d)\1+$/.test(d) ? d.slice(-10) : '';
};
const isEmail = (v) => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(val(v));
const key = (s) => val(s).toLowerCase();
// Arrives lowercased: "om  chauham". Capitals are only added when the file has
// none of its own.
const properName = (v) => {
  const s = val(v);
  if (!s || s !== s.toLowerCase()) return s;
  return s.replace(/[a-z]+/g, (w) => w[0].toUpperCase() + w.slice(1));
};

(async () => {
  const grid = parseCsv(fs.readFileSync(FILE, 'utf8')).filter((r) => r.some((c) => String(c).trim() !== ''));
  const head = grid.shift().map((x) => String(x).trim().toLowerCase());
  const at = (n) => head.indexOf(n);
  const C = { name: at('name'), email: at('email'), phone: at('phone'), phone2: at('phone2'),
    address: at('address'), city: at('city'), state: at('state'), zip: at('zip'),
    birthday: at('birth day'), notes: at('notes') };
  if (C.name < 0) { console.error('no Name column in ' + FILE); process.exit(1); }

  const people = grid.map((r) => {
    const g = (k) => (C[k] >= 0 ? val(r[C[k]]) : '');
    const phone = ten(g('phone')) ? g('phone') : (ten(g('phone2')) ? g('phone2') : g('phone'));
    const spare = ten(g('phone')) && ten(g('phone2')) ? g('phone2') : '';
    return {
      name: properName(g('name')),
      email: isEmail(g('email')) ? g('email') : '',
      phone,
      address: [g('address'), g('city'), [g('state'), g('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      notes: [g('notes'), spare ? `Second phone: ${spare}` : ''].filter(Boolean).join('\n'),
    };
  }).filter((p) => p.name || p.email || p.phone);

  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n${write ? 'APPLYING' : 'DRY RUN — nothing will be written'}`);
  console.log(`${FILE}\n${people.length} people in the file\n`);

  // ── Who belongs where ────────────────────────────────────────────────────
  const shops = {};
  for (const name of STORES) {
    const s = (await c.query('SELECT user_id FROM pos_settings WHERE store_name = $1', [name])).rows[0];
    if (!s) { console.error(`no shop called "${name}"`); process.exit(1); }
    // Everyone who has ever been rung up here, with the day they first were —
    // that day is the truest "customer since" we have for anyone the old till
    // never gave a record of their own.
    const sold = (await c.query(
      `SELECT LOWER(TRIM(customer_name)) AS n, MIN(COALESCE(original_sale_date, created_at)) AS first_seen
         FROM pos_transactions WHERE user_id = $1 AND COALESCE(customer_name,'') <> ''
        GROUP BY 1`, [s.user_id])).rows;
    const held = (await c.query(
      'SELECT id, name, email, phone, address, notes, created_at FROM customers WHERE user_id = $1', [s.user_id])).rows;
    shops[name] = {
      userId: s.user_id,
      sold: new Map(sold.map((r) => [r.n.replace(/\s+/g, ' '), r.first_seen])),
      byName: new Map(held.map((r) => [key(r.name), r])),
      byPhone: new Map(held.filter((r) => ten(r.phone)).map((r) => [ten(r.phone), r])),
      byEmail: new Map(held.filter((r) => key(r.email)).map((r) => [key(r.email), r])),
      held: held.length,
      plan: { create: [], fill: [], untouched: 0 },
    };
  }

  const homeless = [];
  for (const p of people) {
    const n = key(p.name);
    const mine = STORES.filter((s) => shops[s].sold.has(n) || shops[s].byName.has(n)
      || (ten(p.phone) && shops[s].byPhone.has(ten(p.phone)))
      || (p.email && shops[s].byEmail.has(key(p.email))));
    if (!mine.length) { homeless.push(p); continue; }

    for (const s of mine) {
      const shop = shops[s];
      const found = (p.email && shop.byEmail.get(key(p.email)))
        || (ten(p.phone) && shop.byPhone.get(ten(p.phone)))
        || shop.byName.get(n);
      if (!found) { shop.plan.create.push({ ...p, since: shop.sold.get(n) || null }); continue; }

      // Fill the gaps only. Never replace what is already there.
      const fields = {};
      for (const f of ['email', 'phone', 'address', 'notes']) {
        if (p[f] && !String(found[f] || '').trim()) fields[f] = p[f];
      }
      if (Object.keys(fields).length) shop.plan.fill.push({ id: found.id, name: found.name, fields });
      else shop.plan.untouched++;
    }
  }

  // ── What that comes to ───────────────────────────────────────────────────
  for (const s of STORES) {
    const { plan, held } = shops[s];
    console.log(`${s} — ${held} customers on file today`);
    console.log(`   ${String(plan.create.length).padStart(4)} new records for people who only exist as a name on a receipt`);
    console.log(`   ${String(plan.fill.length).padStart(4)} already here, gaining something they were missing`);
    console.log(`   ${String(plan.untouched).padStart(4)} already here with nothing to add`);
    for (const f of plan.fill.slice(0, 12)) {
      console.log(`        + ${f.name}: ${Object.keys(f.fields).join(', ')}`);
    }
    if (plan.fill.length > 12) console.log(`        … and ${plan.fill.length - 12} more`);
    console.log('');
  }
  if (homeless.length) {
    console.log(`${homeless.length} in the file have never been sold to at either shop — left alone:`);
    for (const p of homeless) console.log(`   ${p.name}${p.phone ? '  ' + p.phone : ''}`);
    console.log('');
  }

  if (!write) {
    console.log('Nothing written. Re-run with --write to apply.\n');
    await c.end();
    return;
  }

  let created = 0, filled = 0;
  for (const s of STORES) {
    const shop = shops[s];
    for (const p of shop.plan.create) {
      await c.query(
        `INSERT INTO customers (name, email, phone, address, notes, user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))`,
        [p.name, p.email, p.phone, p.address, p.notes, shop.userId, p.since]);
      created++;
    }
    for (const f of shop.plan.fill) {
      const cols = Object.keys(f.fields);
      await c.query(
        `UPDATE customers SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW()
          WHERE id = $${cols.length + 1}`,
        [...cols.map((k) => f.fields[k]), f.id]);
      filled++;
    }
  }
  console.log(`Done. ${created} customers created, ${filled} filled in.\n`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
