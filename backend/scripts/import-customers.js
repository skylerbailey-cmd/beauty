'use strict';

// Import a customer CSV (Name, Email, Phone, Phone2, Address, State, City, Zip,
// Birth Day, Notes) into the customers table for ONE company.
//
//   node scripts/import-customers.js --file "customers.csv" --user-id <id> [--apply]
//
// Dry run by default: it reports exactly what it would write and changes
// nothing. Pass --apply to actually write.
//
// Needs DATABASE_URL. Railway's postgres.railway.internal host only resolves
// inside Railway — from a laptop use the public proxy URL from the service's
// Connect tab (…proxy.rlwy.net).

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ─── CSV parsing (quoted fields, embedded commas/newlines) ──────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

// Placeholders this export uses for "no value".
const NULLISH = new Set(['none', 'n/a', 'na', 'null', '-', 'unknown', '0000-00-00']);
function clean(v) {
  const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return NULLISH.has(s.toLowerCase()) ? '' : s;
}
const digitsOf = v => String(v || '').replace(/\D/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--route-by-transactions') out.route = true;
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--user-id') out.userId = argv[++i];
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
  }
  return out;
}

// A single export can cover several stores. Rather than dumping all of it into
// one company, send each customer to the store they actually bought from,
// matched on name against that store's transaction history. Someone who shows
// up at two stores is a customer of both and gets a record in each, since
// customers are per-company.
async function routeByTransactions(pool, records) {
  const companies = (await pool.query(
    `SELECT user_id, store_name FROM pos_settings WHERE TRIM(COALESCE(store_name,'')) <> '' ORDER BY store_name`)).rows;
  for (const c of companies) {
    c.names = new Set((await pool.query(
      `SELECT DISTINCT LOWER(TRIM(customer_name)) AS n FROM pos_transactions
       WHERE user_id = $1 AND TRIM(COALESCE(customer_name,'')) <> ''`, [c.user_id])).rows.map(r => r.n));
  }
  const targets = [];
  const unmatched = [];
  for (const rec of records) {
    const key = rec.name.toLowerCase().replace(/\s+/g, ' ');
    const hits = companies.filter(c => c.names.has(key));
    if (!hits.length) { unmatched.push(rec); continue; }
    for (const c of hits) targets.push({ rec, userId: c.user_id, store: c.store_name });
  }
  return { companies, targets, unmatched };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file || (!args.userId && !args.route)) {
    console.error('Usage: node scripts/import-customers.js --file <csv> (--user-id <id> | --route-by-transactions) [--apply] [--limit N]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const rows = parseCSV(fs.readFileSync(path.resolve(args.file), 'utf8'));
  const header = rows.shift().map(h => clean(h).toLowerCase());
  const col = name => header.indexOf(name);
  const idx = {
    name: col('name'), email: col('email'), phone: col('phone'), phone2: col('phone2'),
    address: col('address'), city: col('city'), state: col('state'), zip: col('zip'),
    birthday: col('birth day'), notes: col('notes'),
  };
  if (idx.name === -1) { console.error('No "Name" column found. Header was:', header); process.exit(1); }

  // ─── Clean and classify every row ─────────────────────────────────────────
  const prepared = [];
  const skipped = { no_contact: 0, no_name: 0, bad_email: [] };
  const seenEmail = new Map(), seenPhone = new Map();
  let mergedDupes = 0;

  for (const r of rows) {
    const name = clean(r[idx.name]);
    let email = clean(r[idx.email]).toLowerCase();
    const phoneRaw = clean(r[idx.phone]) || clean(r[idx.phone2]);
    const phoneDigits = digitsOf(phoneRaw);
    const phoneKey = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : '';

    if (email && !EMAIL_RE.test(email)) { skipped.bad_email.push(email); email = ''; }
    if (!name) { skipped.no_name++; continue; }
    // Nothing to key or contact them by — importing these creates rows that can
    // never be found again or de-duplicated.
    if (!email && !phoneKey) { skipped.no_contact++; continue; }

    const addressParts = [clean(r[idx.address]), clean(r[idx.city]), clean(r[idx.state]), clean(r[idx.zip])].filter(Boolean);
    const bday = clean(r[idx.birthday]);
    const rec = {
      name,
      email,
      phone: phoneKey ? phoneRaw : '',
      address: addressParts.join(', '),
      // Only a real date survives; this export writes 0000-00-00 for everyone.
      birthday: /^\d{4}-\d{2}-\d{2}$/.test(bday) && !bday.startsWith('0000') ? bday : null,
      notes: clean(r[idx.notes]),
    };

    // Collapse duplicates inside the file itself, so the DB never sees them.
    const key = email ? 'e:' + email : 'p:' + phoneKey;
    const prior = email ? seenEmail.get(email) : seenPhone.get(phoneKey);
    if (prior) {
      mergedDupes++;
      // Keep whichever copy carries more detail.
      if (!prior.address && rec.address) prior.address = rec.address;
      if (!prior.notes && rec.notes) prior.notes = rec.notes;
      if (!prior.phone && rec.phone) prior.phone = rec.phone;
      continue;
    }
    if (email) seenEmail.set(email, rec); else seenPhone.set(phoneKey, rec);
    prepared.push(rec);
  }

  const list = args.limit ? prepared.slice(0, args.limit) : prepared;

  console.log('─── Parsed ' + args.file);
  console.log('  rows in file        :', rows.length);
  console.log('  ready to import     :', prepared.length);
  console.log('    with an email     :', prepared.filter(r => r.email).length);
  console.log('    phone only        :', prepared.filter(r => !r.email).length);
  console.log('  skipped, no contact :', skipped.no_contact);
  console.log('  skipped, no name    :', skipped.no_name);
  console.log('  duplicates merged   :', mergedDupes);
  console.log('  emails dropped (malformed):', skipped.bad_email.length, skipped.bad_email.slice(0, 5));
  console.log('  birthdays kept      :', prepared.filter(r => r.birthday).length);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /proxy\.rlwy\.net|amazonaws|render|supabase/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  });

  // Decide which company (or companies) each record belongs to.
  let targets, unmatched = [];
  if (args.route) {
    const routed = await routeByTransactions(pool, list);
    targets = routed.targets;
    unmatched = routed.unmatched;
    console.log('\n─── Routed by transaction history');
    for (const c of routed.companies) {
      const mine = targets.filter(t => t.userId === c.user_id);
      console.log(`  ${c.store_name.padEnd(18)} ${String(mine.length).padStart(4)} customer(s)`);
    }
    const inBoth = targets.reduce((m, t) => m.set(t.rec, (m.get(t.rec) || 0) + 1), new Map());
    console.log('  customers at more than one store:', [...inBoth.values()].filter(n => n > 1).length);
    console.log('  no transactions at any store    :', unmatched.length,
      unmatched.slice(0, 5).map(r => r.name));
  } else {
    targets = list.map(rec => ({ rec, userId: args.userId, store: args.userId }));
  }

  // What's already there, per company, so the report separates new from existing.
  const byCompany = {};
  for (const t of targets) (byCompany[t.userId] = byCompany[t.userId] || []).push(t.rec);
  console.log('\n─── Against what is already in the database');
  for (const [uid, recs] of Object.entries(byCompany)) {
    const existing = (await pool.query(
      `SELECT LOWER(TRIM(email)) AS email,
              RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'\\D','','g'), 10) AS phone
       FROM customers WHERE user_id = $1`, [uid])).rows;
    const haveEmail = new Set(existing.map(r => r.email).filter(Boolean));
    const havePhone = new Set(existing.map(r => r.phone).filter(p => p && p.length === 10));
    const isNew = r => r.email ? !haveEmail.has(r.email) : !havePhone.has(digitsOf(r.phone).slice(-10));
    const store = targets.find(t => t.userId === uid)?.store || uid;
    console.log(`  ${String(store).padEnd(18)} already ${String(existing.length).padStart(4)} | would INSERT ${String(recs.filter(isNew).length).padStart(4)} | would UPDATE ${String(recs.filter(r => !isNew(r)).length).padStart(4)}`);
  }

  console.log('\n─── Sample of the first 5 to be written');
  for (const t of targets.slice(0, 5)) {
    const r = t.rec;
    console.log(`  [${t.store}] ${r.name} | ${r.email || '(no email)'} | ${r.phone || '(no phone)'}`);
  }

  if (!args.apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to write.');
    await pool.end();
    return;
  }

  let inserted = 0, updated = 0, failed = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of targets) {
      const r = t.rec;
      const uid = t.userId;
      // Same matching rule the app uses: email when there is one, else phone.
      const found = r.email
        ? (await client.query(
            `SELECT id FROM customers WHERE user_id = $1 AND LOWER(TRIM(email)) = $2 LIMIT 1`,
            [uid, r.email])).rows[0]
        : (await client.query(
            `SELECT id FROM customers WHERE user_id = $1 AND TRIM(COALESCE(email,'')) = ''
               AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'\\D','','g'), 10) = $2 LIMIT 1`,
            [uid, digitsOf(r.phone).slice(-10)])).rows[0];
      try {
        if (found) {
          // Only fill gaps — never overwrite details already in the system,
          // which are more likely to be current than a legacy export.
          await client.query(
            `UPDATE customers SET
               name    = CASE WHEN TRIM(COALESCE(name,''))    = '' THEN $2 ELSE name END,
               phone   = CASE WHEN TRIM(COALESCE(phone,''))   = '' THEN $3 ELSE phone END,
               address = CASE WHEN TRIM(COALESCE(address,'')) = '' THEN $4 ELSE address END,
               notes   = CASE WHEN TRIM(COALESCE(notes,''))   = '' THEN $5 ELSE notes END,
               updated_at = NOW()
             WHERE id = $1`,
            [found.id, r.name, r.phone, r.address, r.notes]);
          updated++;
        } else {
          await client.query(
            `INSERT INTO customers (name, email, phone, birthday, address, notes, user_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [r.name, r.email, r.phone, r.birthday, r.address, r.notes, uid]);
          inserted++;
        }
      } catch (e) {
        failed++;
        console.error('  failed:', t.store, r.name, r.email || r.phone, '→', e.message);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nRolled back — nothing was written:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  console.log(`\nDone. inserted ${inserted}, updated ${updated}, failed ${failed}.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
