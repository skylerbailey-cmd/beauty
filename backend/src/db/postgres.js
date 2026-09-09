'use strict';

const { Pool, types } = require('pg');

// By default node-postgres parses DATE columns into a JS Date at local
// midnight, then callers serialize that to ISO with the server's local
// timezone offset — which can shift the calendar date by a day depending on
// where the server runs. Return DATE columns as the raw 'YYYY-MM-DD' string
// instead (OID 1082) so a birthday always round-trips as the date it was
// saved, regardless of server timezone.
types.setTypeParser(1082, val => val);

// Railway may inject DATABASE_URL, DATABASE_PUBLIC_URL, or POSTGRES_URL
const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.warn('[postgres] No DATABASE_URL found. Postgres features will be unavailable.');
}

const pool = connectionString ? new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
}) : null;

// Helper: returns empty result if pool not available
async function query(text, params) {
  if (!pool) return { rows: [] };
  return pool.query(text, params);
}

// Test connection on startup
if (pool) {
  pool.query('SELECT NOW()')
    .then(r => console.log(`[postgres] Connected: ${r.rows[0].now}`))
    .catch(err => console.error('[postgres] Connection failed:', err.message));
}

async function initSchema() {
  if (!pool) { console.warn('[postgres] Skipping schema init — no connection'); return; }
  await query(`
    -- Customers (shared CRM)
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      birthday DATE,
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      user_id TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_customers_user_email ON customers(user_id, email);
    CREATE INDEX IF NOT EXISTS idx_pg_customers_user_id ON customers(user_id);

    CREATE TABLE IF NOT EXISTS customer_products (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      purchased_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(customer_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pg_cp_customer ON customer_products(customer_id);
    CREATE INDEX IF NOT EXISTS idx_pg_cp_product ON customer_products(product_id);

    -- POS Employees
    CREATE TABLE IF NOT EXISTS pos_employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      role TEXT DEFAULT 'sales',
      commission_rate REAL DEFAULT 0,
      user_id TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_emp_user ON pos_employees(user_id);

    -- Product prices
    CREATE TABLE IF NOT EXISTS pos_product_prices (
      id SERIAL PRIMARY KEY,
      product_id TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      min_price REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      user_id TEXT DEFAULT '',
      UNIQUE(product_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pg_prices_user ON pos_product_prices(user_id);

    -- Custom products
    CREATE TABLE IF NOT EXISTS pos_custom_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT DEFAULT 'Custom',
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      price REAL DEFAULT 0,
      min_price REAL DEFAULT 0,
      user_id TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_custom_user ON pos_custom_products(user_id);

    -- Brand product visibility (which catalog products are enabled)
    CREATE TABLE IF NOT EXISTS pos_product_visibility (
      product_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      visible INTEGER DEFAULT 1,
      PRIMARY KEY(product_id, user_id)
    );

    -- Transactions
    CREATE TABLE IF NOT EXISTS pos_transactions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'sale',
      employee_id INTEGER REFERENCES pos_employees(id),
      customer_id INTEGER,
      customer_name TEXT DEFAULT '',
      customer_email TEXT DEFAULT '',
      customer_phone TEXT DEFAULT '',
      subtotal REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0.0875,
      tax_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT DEFAULT 'card',
      card_last4 TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      receipt_number TEXT NOT NULL,
      original_transaction_id INTEGER REFERENCES pos_transactions(id),
      original_sale_date TIMESTAMPTZ,
      employees_changed INTEGER DEFAULT 0,
      user_id TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_tx_user ON pos_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_pg_tx_employee ON pos_transactions(employee_id);
    CREATE INDEX IF NOT EXISTS idx_pg_tx_receipt ON pos_transactions(receipt_number);
    CREATE INDEX IF NOT EXISTS idx_pg_tx_created ON pos_transactions(created_at);

    -- Transaction line items
    CREATE TABLE IF NOT EXISTS pos_transaction_items (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES pos_transactions(id),
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pg_items_tx ON pos_transaction_items(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_pg_items_product ON pos_transaction_items(product_id);

    -- Transaction employee commissions
    CREATE TABLE IF NOT EXISTS pos_transaction_employees (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES pos_transactions(id),
      employee_id INTEGER NOT NULL REFERENCES pos_employees(id),
      commission_type TEXT DEFAULT 'percent',
      commission_value REAL DEFAULT 100,
      commission_amount REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pg_txemp_tx ON pos_transaction_employees(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_pg_txemp_emp ON pos_transaction_employees(employee_id);

    -- Split payments: one row per tender on a sale (card/cash/other). A sale
    -- with a single tender still gets one row here. Transactions created before
    -- this table existed have no rows and fall back to the pos_transactions
    -- payment_method/card_last4/total columns (see the card-sales reads).
    CREATE TABLE IF NOT EXISTS pos_transaction_payments (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES pos_transactions(id),
      method TEXT NOT NULL DEFAULT 'card',
      amount REAL NOT NULL DEFAULT 0,
      card_last4 TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_txpay_tx ON pos_transaction_payments(transaction_id);

    -- Welcome emails history
    CREATE TABLE IF NOT EXISTS welcome_emails (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      products TEXT NOT NULL,
      user_id TEXT DEFAULT '',
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_we_user ON welcome_emails(user_id);

    -- Full log of customer-facing emails actually sent (with the exact body)
    CREATE TABLE IF NOT EXISTS sent_emails (
      id SERIAL PRIMARY KEY,
      user_id TEXT DEFAULT '',
      to_email TEXT DEFAULT '',
      to_name TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      body TEXT DEFAULT '',
      kind TEXT DEFAULT 'welcome',
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_sent_user ON sent_emails(user_id, sent_at DESC);

    -- Campaigns history
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      recipient_count INTEGER DEFAULT 0,
      user_id TEXT DEFAULT '',
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pg_camp_user ON campaigns(user_id);

    -- Employee commission plans (tiered/special rules)
    -- plan_type: 'flat' (use base_rate always), 'daily_threshold' (if day sales > threshold, use tier_rate, else base_rate)
    CREATE TABLE IF NOT EXISTS pos_commission_plans (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES pos_employees(id),
      plan_type TEXT NOT NULL DEFAULT 'flat',
      base_rate REAL NOT NULL DEFAULT 35,
      tier_rate REAL DEFAULT 40,
      tier_threshold REAL DEFAULT 0,
      user_id TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pg_commplan_emp ON pos_commission_plans(employee_id);

    -- POS store settings
    CREATE TABLE IF NOT EXISTS pos_settings (
      user_id TEXT PRIMARY KEY,
      store_name TEXT DEFAULT '',
      store_address TEXT DEFAULT '',
      store_city TEXT DEFAULT '',
      store_state TEXT DEFAULT '',
      store_zip TEXT DEFAULT '',
      receipt_footer TEXT DEFAULT 'Thank you for your purchase!',
      timezone TEXT DEFAULT 'America/Los_Angeles',
      tax_rate REAL DEFAULT 0.081875,
      theme TEXT DEFAULT 'rose',
      brands TEXT DEFAULT '["avologi","avinichi","hydrasphere","spacetouch","lumieres"]'
    );

    -- Registry of stable (email-derived) user IDs, so the one-time legacy-data
    -- bridge can tell a real account from an orphaned pre-migration dataset.
    CREATE TABLE IF NOT EXISTS pos_known_users (
      user_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Each company's own Gmail refresh token, keyed by its account id, so the
    -- connection survives redeploys AND never bleeds between companies.
    CREATE TABLE IF NOT EXISTS pos_gmail_tokens (
      user_id TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      email TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Migrations for existing DBs
  const migrate = async (sql) => { try { await query(sql); } catch (_) {} };
  await migrate('ALTER TABLE pos_employees ADD COLUMN IF NOT EXISTS commission_rate REAL DEFAULT 0');
  await migrate('ALTER TABLE pos_product_prices ADD COLUMN IF NOT EXISTS min_price REAL DEFAULT 0');
  await migrate('ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS card_last4 TEXT DEFAULT \'\'');
  await migrate('ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS employees_changed INTEGER DEFAULT 0');
  await migrate("ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS customer_phone TEXT DEFAULT ''");
  // A sale the customer disputed and the bank pulled back. Kept as a flag on
  // the original sale rather than a new transaction: the money never came in,
  // so it isn't a refund the store chose to give.
  await migrate('ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS charged_back INTEGER DEFAULT 0');
  await migrate('ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS charged_back_at TIMESTAMPTZ');
  await migrate("ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS charged_back_note TEXT DEFAULT ''");

  // Batch reconciliation: which days have been reviewed, and audit date ranges
  // saved to come back to. Only the range is stored for a saved audit — it's
  // re-run against live data on open, so it reflects later edits to the
  // transactions rather than being a stale snapshot.
  await migrate(`CREATE TABLE IF NOT EXISTS pos_audit_reviews (
    user_id TEXT NOT NULL,
    audit_date DATE NOT NULL,
    reviewed INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT DEFAULT '',
    reviewed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, audit_date)
  )`);
  await migrate(`CREATE TABLE IF NOT EXISTS pos_saved_audits (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT DEFAULT '',
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await migrate('CREATE INDEX IF NOT EXISTS idx_pg_saved_audits_user ON pos_saved_audits(user_id)');
  await migrate('ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday DATE');
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_address TEXT DEFAULT ''");
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_city TEXT DEFAULT ''");
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_state TEXT DEFAULT ''");
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_zip TEXT DEFAULT ''");
  await migrate('ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS tax_rate REAL DEFAULT 0.0875');
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'rose'");
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS brands TEXT DEFAULT '[\"avologi\",\"avinichi\",\"hydrasphere\",\"spacetouch\",\"lumieres\"]'");
  // New companies default to the current 8.1875% sales tax
  await migrate('ALTER TABLE pos_settings ALTER COLUMN tax_rate SET DEFAULT 0.081875');
  // Maverick Payments reporting credentials (per company, server-side only)
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS maverick_dba_id TEXT DEFAULT ''");
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS maverick_token TEXT DEFAULT ''");

  // One-time data migrations, tracked so they run exactly once.
  await migrate('CREATE TABLE IF NOT EXISTS pos_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())');
  try {
    const done = await query("SELECT 1 FROM pos_migrations WHERE name = 'tax_8_1875'");
    if (done.rows.length === 0) {
      await query('UPDATE pos_settings SET tax_rate = 0.081875');
      await query("INSERT INTO pos_migrations (name) VALUES ('tax_8_1875') ON CONFLICT DO NOTHING");
      console.log('[postgres] One-time: set sales tax to 8.1875% for all companies');
    }
  } catch (e) {
    console.error('[postgres] tax migration failed:', e.message);
  }

  console.log('[postgres] Schema initialized');
}

// ─── Customers ──────────────────────────────────────────────────────────────

async function findOrCreateCustomer(name, email, userId, phone) {
  const existing = userId
    ? (await query('SELECT * FROM customers WHERE email = $1 AND user_id = $2', [email, userId])).rows[0]
    : (await query('SELECT * FROM customers WHERE email = $1', [email])).rows[0];
  if (existing) {
    const sets = [];
    const params = [];
    if (name && name !== existing.name) { sets.push(`name = $${sets.length + 1}`); params.push(name); existing.name = name; }
    if (phone && phone !== existing.phone) { sets.push(`phone = $${sets.length + 1}`); params.push(phone); existing.phone = phone; }
    if (sets.length) {
      sets.push('updated_at = NOW()');
      params.push(existing.id);
      await query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    return existing;
  }
  const result = await query(
    'INSERT INTO customers (name, email, phone, user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone RETURNING *',
    [name || '', email, phone || '', userId || '']
  );
  return result.rows[0];
}

async function addCustomerProducts(customerId, products) {
  for (const p of products) {
    await query(
      'INSERT INTO customer_products (customer_id, product_id, product_name) VALUES ($1, $2, $3) ON CONFLICT (customer_id, product_id) DO NOTHING',
      [customerId, p.id, p.name]
    );
  }
}

async function getCustomers(userId) {
  const customers = userId
    ? (await query('SELECT * FROM customers WHERE user_id = $1 ORDER BY updated_at DESC', [userId])).rows
    : (await query('SELECT * FROM customers ORDER BY updated_at DESC')).rows;
  for (const c of customers) {
    c.products = (await query('SELECT * FROM customer_products WHERE customer_id = $1 ORDER BY purchased_at DESC', [c.id])).rows;
  }
  return customers;
}

async function getCustomer(id) {
  const c = (await query('SELECT * FROM customers WHERE id = $1', [id])).rows[0];
  if (!c) return null;
  c.products = (await query('SELECT * FROM customer_products WHERE customer_id = $1 ORDER BY purchased_at DESC', [id])).rows;
  return c;
}

async function getCustomerByEmail(email, userId) {
  const c = userId
    ? (await query('SELECT * FROM customers WHERE email = $1 AND user_id = $2', [email, userId])).rows[0]
    : (await query('SELECT * FROM customers WHERE email = $1', [email])).rows[0];
  if (!c) return null;
  c.products = (await query('SELECT * FROM customer_products WHERE customer_id = $1 ORDER BY purchased_at DESC', [c.id])).rows;
  return c;
}

async function updateCustomer(id, fields) {
  const allowed = ['name', 'email', 'phone', 'birthday', 'address', 'notes'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      params.push(fields[key]);
      idx++;
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = NOW()');
  params.push(id);
  await query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${idx}`, params);
}

// ─── Employees ──────────────────────────────────────────────────────────────

async function getEmployees(userId) {
  return (await query('SELECT * FROM pos_employees WHERE user_id = $1 ORDER BY name', [userId])).rows;
}

async function getEmployee(id) {
  return (await query('SELECT * FROM pos_employees WHERE id = $1', [id])).rows[0];
}

async function createEmployee(name, pin, role, commissionRate, userId) {
  const result = await query(
    'INSERT INTO pos_employees (name, pin, role, commission_rate, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, pin, role || 'sales', commissionRate || 0, userId]
  );
  return result.rows[0];
}

async function updateEmployee(id, fields) {
  const allowed = ['name', 'pin', 'role', 'active', 'commission_rate'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      params.push(fields[key]);
      idx++;
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE pos_employees SET ${sets.join(', ')} WHERE id = $${idx}`, params);
}

// Verify an employee's PIN for a company, optionally requiring their name to
// match as well. The name has to be matched HERE rather than by the caller:
// PINs are only 4 digits and nothing enforced uniqueness historically, so
// looking up by PIN alone can return a different employee who happens to share
// that PIN — and a caller that then compares names would reject someone who
// typed their own PIN correctly. Matching both together picks the right row.
async function verifyEmployeePin(pin, userId, name) {
  const rows = (await query(
    'SELECT * FROM pos_employees WHERE pin = $1 AND user_id = $2 AND active = 1 ORDER BY id',
    [pin, userId]
  )).rows;
  if (!rows.length) return undefined;
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return rows[0];
  return rows.find(e => String(e.name || '').trim().toLowerCase() === wanted);
}

// ─── Product Prices ─────────────────────────────────────────────────────────

async function getProductPrices(userId) {
  return (await query('SELECT * FROM pos_product_prices WHERE user_id = $1', [userId])).rows;
}

async function setProductPrice(productId, price, minPrice, cost, userId) {
  await query(
    `INSERT INTO pos_product_prices (product_id, price, min_price, cost, user_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, user_id) DO UPDATE SET price = EXCLUDED.price, min_price = EXCLUDED.min_price, cost = EXCLUDED.cost`,
    [productId, price, minPrice || 0, cost || 0, userId]
  );
}

// ─── Transactions ───────────────────────────────────────────────────────────

async function generateReceiptNumber() {
  const result = await query("SELECT COALESCE(MAX(CAST(receipt_number AS INTEGER)), 1000) as num FROM pos_transactions WHERE receipt_number ~ '^[0-9]+$'");
  return String((result.rows[0]?.num || 1000) + 1);
}

// Ensure a receipt number is unique (returns can collide on "R<num>" if a sale
// is returned more than once — append -2, -3, … in that case).
async function uniqueReceiptNumber(base) {
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = (await query('SELECT 1 FROM pos_transactions WHERE receipt_number = $1 LIMIT 1', [candidate])).rows.length > 0;
    if (!exists) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

async function createTransaction(txData) {
  const receiptNumber = txData.receipt_number
    ? await uniqueReceiptNumber(txData.receipt_number)
    : await generateReceiptNumber();
  const result = await query(
    `INSERT INTO pos_transactions
      (type, employee_id, customer_id, customer_name, customer_email, customer_phone,
       subtotal, tax_rate, tax_amount, discount_amount, total,
       payment_method, card_last4, notes, receipt_number, original_transaction_id, original_sale_date, employees_changed, user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id, receipt_number`,
    [
      txData.type || 'sale', txData.employee_id || null, txData.customer_id || null,
      txData.customer_name || '', txData.customer_email || '', txData.customer_phone || '',
      txData.subtotal, txData.tax_rate ?? 0.0875, txData.tax_amount,
      txData.discount_amount || 0, txData.total,
      txData.payment_method || 'card', txData.card_last4 || '', txData.notes || '',
      receiptNumber, txData.original_transaction_id || null,
      txData.original_sale_date || null, txData.employees_changed ? 1 : 0, txData.user_id,
    ]
  );
  const id = result.rows[0].id;
  // Record individual tenders (split payment). The route always passes at least
  // one; guard anyway so a caller that omits them doesn't crash.
  if (Array.isArray(txData.payments) && txData.payments.length) {
    await addTransactionPayments(id, txData.payments);
  }
  return { id, receipt_number: result.rows[0].receipt_number };
}

async function addTransactionPayments(transactionId, payments) {
  for (const p of payments) {
    await query(
      `INSERT INTO pos_transaction_payments (transaction_id, method, amount, card_last4)
       VALUES ($1,$2,$3,$4)`,
      [transactionId, p.method || 'card', Math.abs(Number(p.amount) || 0), p.card_last4 || '']
    );
  }
}

async function receiptExists(receiptNumber, userId) {
  return (await query('SELECT 1 FROM pos_transactions WHERE receipt_number = $1 AND user_id = $2 LIMIT 1', [receiptNumber, userId])).rows.length > 0;
}

// Insert a historical transaction from an external export, with an explicit
// receipt number and backdated created_at (interpreted in the store timezone).
async function importTransaction(tx) {
  const rate = tx.subtotal > 0 ? Math.round((tx.tax_amount / tx.subtotal) * 10000) / 10000 : 0;
  const result = await query(
    `INSERT INTO pos_transactions
      (type, employee_id, customer_name, customer_email, subtotal, tax_rate, tax_amount,
       discount_amount, total, payment_method, card_last4, notes, receipt_number, user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, ($15)::timestamp AT TIME ZONE $16) RETURNING id`,
    [
      tx.type || 'sale', tx.employee_id || null, tx.customer_name || '', '',
      tx.subtotal, rate, tx.tax_amount, 0, tx.total,
      tx.payment_method || 'card', '', 'Imported from prior POS',
      tx.receipt_number, tx.user_id, tx.created_at, tx.tz || 'America/Los_Angeles',
    ]
  );
  const id = result.rows[0].id;
  if (tx.items?.length) await addTransactionItems(id, tx.items);
  if (tx.employees?.length) await addTransactionEmployees(id, tx.employees);
  return id;
}

async function addTransactionItems(transactionId, items) {
  for (const item of items) {
    await query(
      `INSERT INTO pos_transaction_items (transaction_id, product_id, product_name, brand, quantity, unit_price, discount, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [transactionId, item.product_id, item.product_name, item.brand || '', item.quantity || 1, item.unit_price, item.discount || 0, item.line_total]
    );
  }
}

async function addTransactionEmployees(transactionId, employees) {
  for (const emp of employees) {
    await query(
      `INSERT INTO pos_transaction_employees (transaction_id, employee_id, commission_type, commission_value, commission_amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [transactionId, emp.employee_id, emp.commission_type || 'percent', emp.commission_value || 100, emp.commission_amount || 0]
    );
  }
}

async function getTransaction(id, userId) {
  // When userId is provided, scope by company so one company can't read
  // another company's transaction by guessing its numeric id.
  const tx = userId
    ? (await query('SELECT * FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId])).rows[0]
    : (await query('SELECT * FROM pos_transactions WHERE id = $1', [id])).rows[0];
  if (!tx) return null;
  tx.items = (await query('SELECT * FROM pos_transaction_items WHERE transaction_id = $1', [id])).rows;
  tx.employees = (await query(
    `SELECT te.*, e.name as employee_name FROM pos_transaction_employees te
     JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [id]
  )).rows;
  tx.payments = await getTransactionPayments(tx);
  return tx;
}

// The tenders on a transaction. New sales have explicit rows; older rows (from
// before split payment existed) synthesize a single tender from the legacy
// columns so callers can always rely on tx.payments.
async function getTransactionPayments(tx) {
  const rows = (await query(
    'SELECT method, amount, card_last4 FROM pos_transaction_payments WHERE transaction_id = $1 ORDER BY id ASC', [tx.id]
  )).rows;
  if (rows.length) return rows.map(r => ({ method: r.method, amount: Number(r.amount) || 0, card_last4: r.card_last4 || '' }));
  return [{ method: tx.payment_method || 'card', amount: Number(tx.total) || 0, card_last4: tx.card_last4 || '' }];
}

// Manager-gated edit. Scoped by userId (company). Recomputes totals from the
// edited line items using the transaction's existing tax rate. Returns the
// updated transaction, or null if it doesn't exist / belong to this company.
async function updateTransaction(id, userId, data) {
  const existing = (await query('SELECT * FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
  if (!existing) return null;

  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) throw new Error('At least one item is required');

  const rate = existing.tax_rate ?? 0.0875;
  const disc = data.discount_amount !== undefined ? parseFloat(data.discount_amount || 0) : existing.discount_amount;
  const subtotal = items.reduce((sum, i) => sum + (i.unit_price * (i.quantity || 1) - (i.discount || 0)), 0);
  const taxable = subtotal - disc;
  const tax_amount = Math.round(taxable * rate * 100) / 100;
  const total = Math.round((taxable + tax_amount) * 100) / 100;

  const employees = Array.isArray(data.employees) ? data.employees : [];
  const primaryEmp = employees.length ? employees[0].employee_id : existing.employee_id;

  await query(
    `UPDATE pos_transactions SET
       customer_name = $1, customer_email = $2, customer_phone = $3, subtotal = $4, tax_amount = $5,
       discount_amount = $6, total = $7, payment_method = $8, card_last4 = $9,
       notes = $10, employee_id = $11
     WHERE id = $12 AND user_id = $13`,
    [
      data.customer_name ?? existing.customer_name,
      data.customer_email ?? existing.customer_email,
      data.customer_phone ?? existing.customer_phone,
      subtotal, tax_amount, disc, total,
      data.payment_method ?? existing.payment_method,
      data.card_last4 ?? existing.card_last4,
      data.notes ?? existing.notes,
      primaryEmp, id, userId,
    ]
  );

  // Replace line items
  await query('DELETE FROM pos_transaction_items WHERE transaction_id = $1', [id]);
  await addTransactionItems(id, items.map(i => ({
    product_id: i.product_id,
    product_name: i.product_name,
    brand: i.brand || '',
    quantity: i.quantity || 1,
    unit_price: i.unit_price,
    discount: i.discount || 0,
    line_total: i.unit_price * (i.quantity || 1) - (i.discount || 0),
  })));

  // Replace employee commissions
  await query('DELETE FROM pos_transaction_employees WHERE transaction_id = $1', [id]);
  if (employees.length) {
    await addTransactionEmployees(id, employees.map(ea => {
      const commissionAmount = ea.commission_type === 'dollar'
        ? (ea.commission_value || 0)
        : Math.round(subtotal * (ea.commission_value || 100) / 100 * 100) / 100;
      return {
        employee_id: ea.employee_id,
        commission_type: ea.commission_type || 'percent',
        commission_value: ea.commission_value || 100,
        commission_amount: commissionAmount,
      };
    }));
  }

  return getTransaction(id, userId);
}

// Move a transaction to another company (rung up on the wrong one).
//
// Only pos_transactions carries user_id — items and payments hang off
// transaction_id and travel with it automatically. The credited employees do
// NOT: pos_employees is company-scoped, so the crediting rows have to be
// re-pointed at the destination company's employees of the same name, or the
// sale would credit someone who isn't on that roster and would drop out of the
// destination's employee report entirely.
//
// Refuses rather than guesses when a name has no counterpart, so a move never
// silently loses an employee's credit. Returns { ok } or { ok:false, missing }.
async function moveTransactionToCompany(id, fromUserId, toUserId) {
  const tx = (await query('SELECT * FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, fromUserId])).rows[0];
  if (!tx) return { ok: false, notFound: true };
  if (fromUserId === toUserId) return { ok: false, sameCompany: true };

  const credited = (await query(
    `SELECT te.id, te.employee_id, e.name FROM pos_transaction_employees te
     JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [id]
  )).rows;

  const destRoster = (await query(
    'SELECT id, name FROM pos_employees WHERE user_id = $1 AND active = 1', [toUserId]
  )).rows;
  const byName = new Map(destRoster.map(e => [String(e.name).trim().toLowerCase(), e.id]));

  const remap = [];
  const missing = [];
  for (const c of credited) {
    const destId = byName.get(String(c.name).trim().toLowerCase());
    if (destId) remap.push({ rowId: c.id, destId });
    else missing.push(c.name);
  }
  if (missing.length) return { ok: false, missing: [...new Set(missing)] };

  for (const r of remap) {
    await query('UPDATE pos_transaction_employees SET employee_id = $1 WHERE id = $2', [r.destId, r.rowId]);
  }
  // Keep the summary column pointing at a valid employee for the new company.
  const primary = remap[0]?.destId || null;
  await query('UPDATE pos_transactions SET user_id = $1, employee_id = $2 WHERE id = $3 AND user_id = $4',
    [toUserId, primary, id, fromUserId]);

  // Mirror the customer into the destination company's CRM so their history
  // there is complete (keyed by email, same as a normal sale).
  if (tx.customer_email && String(tx.customer_email).trim()) {
    try {
      await findOrCreateCustomer(tx.customer_name || '', tx.customer_email, toUserId, tx.customer_phone || '');
    } catch (_) { /* non-critical */ }
  }
  return { ok: true, receipt_number: tx.receipt_number };
}

// Manager-gated delete. Scoped by userId (company).
async function deleteTransaction(id, userId) {
  const existing = (await query('SELECT id FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
  if (!existing) return false;
  // Detach any returns that referenced this sale so the FK doesn't block deletion
  await query('UPDATE pos_transactions SET original_transaction_id = NULL WHERE original_transaction_id = $1', [id]);
  await query('DELETE FROM pos_transaction_employees WHERE transaction_id = $1', [id]);
  await query('DELETE FROM pos_transaction_items WHERE transaction_id = $1', [id]);
  await query('DELETE FROM pos_transaction_payments WHERE transaction_id = $1', [id]);
  await query('DELETE FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId]);
  return true;
}

// ─── Batch audit: reviewed days + saved ranges ──────────────────────────────

// Which days in a range have been ticked off as reviewed, as { 'YYYY-MM-DD': {...} }.
async function getAuditReviews(userId, from, to) {
  const rows = (await query(
    `SELECT audit_date, reviewed, reviewed_by, reviewed_at
     FROM pos_audit_reviews
     WHERE user_id = $1 AND audit_date >= $2 AND audit_date <= $3`,
    [userId, from, to])).rows;
  const byDate = {};
  // audit_date is a DATE and the type parser hands DATEs back as plain strings
  // (see setTypeParser above), so it's already the 'YYYY-MM-DD' key we want.
  for (const r of rows) {
    byDate[r.audit_date] = { reviewed: !!r.reviewed, reviewed_by: r.reviewed_by || '', reviewed_at: r.reviewed_at };
  }
  return byDate;
}

async function setAuditReview(userId, date, reviewed, reviewedBy) {
  await query(
    `INSERT INTO pos_audit_reviews (user_id, audit_date, reviewed, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, audit_date) DO UPDATE
       SET reviewed = EXCLUDED.reviewed,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at`,
    [userId, date, reviewed ? 1 : 0, reviewed ? (reviewedBy || '') : '', reviewed ? new Date() : null]
  );
  return { ok: true };
}

// Saved audits, each with how many of its days have been reviewed so the list
// can show progress without opening every one.
async function getSavedAudits(userId) {
  return (await query(
    `SELECT s.id, s.label, s.date_from, s.date_to, s.created_at,
       (SELECT COUNT(*) FROM pos_audit_reviews r
         WHERE r.user_id = s.user_id AND r.reviewed = 1
           AND r.audit_date >= s.date_from AND r.audit_date <= s.date_to) AS reviewed_days
     FROM pos_saved_audits s
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId])).rows;
}

async function saveAudit(userId, label, from, to) {
  // Saving the same range twice is a mistake, not a second audit — keep one.
  const existing = (await query(
    'SELECT id FROM pos_saved_audits WHERE user_id = $1 AND date_from = $2 AND date_to = $3',
    [userId, from, to])).rows[0];
  if (existing) {
    await query('UPDATE pos_saved_audits SET label = $1 WHERE id = $2', [label || '', existing.id]);
    return { id: existing.id, existing: true };
  }
  const row = (await query(
    'INSERT INTO pos_saved_audits (user_id, label, date_from, date_to) VALUES ($1,$2,$3,$4) RETURNING id',
    [userId, label || '', from, to])).rows[0];
  return { id: row.id, existing: false };
}

async function deleteSavedAudit(id, userId) {
  const r = await query('DELETE FROM pos_saved_audits WHERE id = $1 AND user_id = $2', [id, userId]);
  return r.rowCount > 0;
}

// Flag (or clear) a sale as charged back. Scoped by user_id like every other
// single-transaction operation, so one company can't touch another's rows.
async function setTransactionChargeback(id, userId, chargedBack, note) {
  const existing = (await query(
    'SELECT id, type FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
  if (!existing) return null;
  // Only a sale can be disputed — a return is money already going back out.
  if (existing.type !== 'sale') return { error: 'Only a sale can be marked as a chargeback.' };
  await query(
    `UPDATE pos_transactions
     SET charged_back = $1, charged_back_at = $2, charged_back_note = $3
     WHERE id = $4 AND user_id = $5`,
    [chargedBack ? 1 : 0, chargedBack ? new Date() : null, chargedBack ? (note || '') : '', id, userId]
  );
  return { ok: true };
}

async function getTransactionByReceipt(receiptNumber, userId) {
  const tx = (await query('SELECT * FROM pos_transactions WHERE receipt_number = $1 AND user_id = $2', [receiptNumber, userId])).rows[0];
  if (!tx) return null;
  tx.items = (await query('SELECT * FROM pos_transaction_items WHERE transaction_id = $1', [tx.id])).rows;
  tx.employees = (await query(
    `SELECT te.*, e.name as employee_name FROM pos_transaction_employees te
     JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [tx.id]
  )).rows;
  tx.payments = await getTransactionPayments(tx);
  return tx;
}

// Reads accept either one company id or a list of them, so the Transactions
// and Reports tabs can show a single company (the default) or several combined.
// `= ANY($n::text[])` behaves identically to `= $n` for a single id, so every
// existing caller that passes a plain string keeps working unchanged.
const asCompanyIds = (u) => (Array.isArray(u) ? u : [u]).filter(Boolean);

async function getTransactions(userId, opts = {}) {
  const { type, startDate, endDate, employeeId, limit = 100 } = opts;
  let where = 'WHERE t.user_id = ANY($1::text[])';
  const params = [asCompanyIds(userId)];
  let idx = 2;

  if (type) { where += ` AND t.type = $${idx}`; params.push(type); idx++; }
  if (startDate) { where += ` AND t.created_at >= $${idx}`; params.push(startDate); idx++; }
  if (endDate) { where += ` AND t.created_at <= $${idx}`; params.push(endDate); idx++; }
  if (employeeId) { where += ` AND t.employee_id = $${idx}`; params.push(employeeId); idx++; }
  params.push(limit);

  const transactions = (await query(`
    SELECT t.* FROM pos_transactions t ${where} ORDER BY t.created_at DESC LIMIT $${idx}
  `, params)).rows;

  for (const tx of transactions) {
    tx.items = (await query('SELECT * FROM pos_transaction_items WHERE transaction_id = $1', [tx.id])).rows;
    tx.employees = (await query(
      `SELECT te.*, e.name as employee_name FROM pos_transaction_employees te
       JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [tx.id]
    )).rows;
    tx.payments = await getTransactionPayments(tx);
  }
  return transactions;
}

// Transactions an employee is personally tied to: either rung up as the
// primary cashier, or assigned as a participant (e.g. stylist/commission
// split) in pos_transaction_employees. Used for the employee-facing,
// read-only Transactions view (see POST /transactions/mine).
async function getEmployeeTransactions(userId, employeeId, opts = {}) {
  const { type, startDate, endDate, limit = 2000 } = opts;
  let where = `WHERE t.user_id = $1 AND (t.employee_id = $2
    OR EXISTS (SELECT 1 FROM pos_transaction_employees te WHERE te.transaction_id = t.id AND te.employee_id = $2))`;
  const params = [userId, employeeId];
  let idx = 3;

  if (type) { where += ` AND t.type = $${idx}`; params.push(type); idx++; }
  if (startDate) { where += ` AND t.created_at >= $${idx}`; params.push(startDate); idx++; }
  if (endDate) { where += ` AND t.created_at <= $${idx}`; params.push(endDate); idx++; }
  params.push(limit);

  const transactions = (await query(`
    SELECT t.* FROM pos_transactions t ${where} ORDER BY t.created_at DESC LIMIT $${idx}
  `, params)).rows;

  for (const tx of transactions) {
    tx.items = (await query('SELECT * FROM pos_transaction_items WHERE transaction_id = $1', [tx.id])).rows;
    tx.employees = (await query(
      `SELECT te.*, e.name as employee_name FROM pos_transaction_employees te
       JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [tx.id]
    )).rows;
    tx.payments = await getTransactionPayments(tx);
  }
  return transactions;
}

// ─── Reports ────────────────────────────────────────────────────────────────

async function getSalesReport(userId, startDate, endDate) {
  const result = await query(`
    SELECT
      COUNT(CASE WHEN type = 'sale' THEN 1 END) as total_sales,
      COUNT(CASE WHEN type = 'return' THEN 1 END) as total_returns,
      -- Revenue figures EXCLUDE tax (tax is reported separately as net_tax).
      -- Use the stored subtotal directly rather than deriving it as
      -- total - tax_amount: the stored value is the authoritative pre-tax
      -- amount, and the derived form also silently subtracts any order-level
      -- discount_amount and carries the rounding done when total was computed.
      COALESCE(SUM(CASE WHEN type = 'sale' THEN subtotal ELSE 0 END), 0) as sales_revenue,
      COALESCE(SUM(CASE WHEN type = 'return' THEN subtotal ELSE 0 END), 0) as returns_total,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN subtotal ELSE -subtotal END), 0) as net_revenue,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN tax_amount ELSE -tax_amount END), 0) as net_tax,
      -- Disputed sales the bank pulled the money back on. Reported alongside
      -- the revenue above rather than deducted from it — the sale did happen
      -- and the commission was earned; this is the part that wasn't kept.
      COUNT(CASE WHEN type = 'sale' AND charged_back = 1 THEN 1 END) as chargeback_count,
      COALESCE(SUM(CASE WHEN type = 'sale' AND charged_back = 1 THEN subtotal ELSE 0 END), 0) as chargeback_total
    FROM pos_transactions
    WHERE user_id = ANY($1::text[])
      AND COALESCE(original_sale_date, created_at) >= $2
      AND COALESCE(original_sale_date, created_at) <= $3
  `, [asCompanyIds(userId), startDate, endDate]);
  return result.rows[0];
}

async function getEmployeeSalesReport(userId, startDate, endDate) {
  // Get base report from the standard query
  const baseReport = (await query(`
    SELECT
      e.id as employee_id, e.name as employee_name, e.commission_rate, e.active,
      COUNT(DISTINCT CASE WHEN t.type = 'sale' THEN t.id END) as sale_count,
      COUNT(DISTINCT CASE WHEN t.type = 'return' THEN t.id END) as return_count,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount ELSE 0 END), 0) as sales_total,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN te.commission_amount ELSE 0 END), 0) as returns_total,
      -- net = sales - returns; rows outside the date range (t IS NULL) must NOT
      -- be subtracted, so use an explicit WHEN for returns and ELSE 0
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount WHEN t.type = 'return' THEN -te.commission_amount ELSE 0 END), 0) as net_total,
      -- This employee's credited share of any sale that was later charged
      -- back. Not deducted from sales_total above — shown beside it, so it's
      -- visible without quietly rewriting what they sold.
      COUNT(DISTINCT CASE WHEN t.type = 'sale' AND t.charged_back = 1 THEN t.id END) as chargeback_count,
      COALESCE(SUM(CASE WHEN t.type = 'sale' AND t.charged_back = 1 THEN te.commission_amount ELSE 0 END), 0) as chargeback_total
    FROM pos_employees e
    LEFT JOIN pos_transaction_employees te ON e.id = te.employee_id
    LEFT JOIN pos_transactions t ON te.transaction_id = t.id
      AND t.user_id = ANY($1::text[])
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
    -- Active employees always appear (even with no sales, so the roster is
    -- complete). A DEACTIVATED employee still appears if they have activity in
    -- this range — otherwise their sales silently vanish from this table and
    -- the leaderboard while still counting in the KPI tiles above, making the
    -- report under-report revenue by exactly their share.
    WHERE e.user_id = ANY($4::text[]) AND (e.active = 1 OR t.id IS NOT NULL)
    GROUP BY e.id ORDER BY net_total DESC
  `, [asCompanyIds(userId), startDate, endDate, asCompanyIds(userId)])).rows;

  // Check for special commission plans and recalculate those employees
  const plans = (await Promise.all(asCompanyIds(userId).map(id => getAllCommissionPlans(id)))).flat();
  const planByEmp = {};
  for (const p of plans) planByEmp[p.employee_id] = p;

  for (const row of baseReport) {
    if (planByEmp[row.employee_id]) {
      const recalc = await calculateEmployeeCommission(row.employee_id, userId, startDate, endDate);
      row.sales_total = recalc.sales_total;
      row.returns_total = recalc.returns_total;
      row.net_total = recalc.net_total;
      // Sale columns above stay comparable across every employee; the plan's
      // computed payout rides along separately for the Commission column.
      row.commission_total = recalc.commission_total;
      row.has_special_plan = true;
    }
  }

  // Re-sort after recalc
  baseReport.sort((a, b) => b.net_total - a.net_total);
  return baseReport;
}

async function getTopProductsReport(userId, startDate, endDate) {
  return (await query(`
    SELECT ti.product_id, ti.product_name, ti.brand,
      SUM(CASE WHEN t.type = 'sale' THEN ti.quantity ELSE -ti.quantity END) as units_sold,
      SUM(CASE WHEN t.type = 'sale' THEN ti.line_total ELSE -ti.line_total END) as revenue
    FROM pos_transaction_items ti
    JOIN pos_transactions t ON ti.transaction_id = t.id
    WHERE t.user_id = ANY($1::text[])
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
    GROUP BY ti.product_id, ti.product_name, ti.brand ORDER BY revenue DESC
  `, [asCompanyIds(userId), startDate, endDate])).rows;
}

async function getCustomerReport(userId, startDate, endDate) {
  const customers = (await query(`
    SELECT t.customer_name as raw_customer_name, t.customer_email,
      COALESCE(cust.name, t.customer_name) as customer_name,
      COUNT(CASE WHEN t.type = 'sale' THEN 1 END) as purchases,
      COUNT(CASE WHEN t.type = 'return' THEN 1 END) as returns,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.total ELSE -t.total END), 0) as total_spent,
      -- Biggest single sale, used to flag high-value customers in the Customers
      -- tab. Subtotal, not total, so the threshold is the value of what was
      -- actually bought and doesn't move with the tax rate.
      COALESCE(MAX(CASE WHEN t.type = 'sale' THEN t.subtotal END), 0) as largest_sale,
      cust.id as customer_id, cust.birthday, cust.address, cust.notes,
      -- Prefer the CRM record's phone (a manager may have corrected it in the
      -- Customers detail view), but fall back to whatever the sale itself
      -- captured — phone-only customers have no CRM row to join to, since
      -- that table is keyed by email.
      COALESCE(NULLIF(cust.phone, ''), NULLIF(MAX(t.customer_phone), '')) as phone
    FROM pos_transactions t
    LEFT JOIN customers cust ON cust.email = t.customer_email AND cust.user_id = t.user_id AND t.customer_email != ''
    WHERE t.user_id = $1
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
      AND t.customer_name != ''
    GROUP BY t.customer_name, t.customer_email, cust.id, cust.name, cust.phone, cust.birthday, cust.address, cust.notes
    ORDER BY total_spent DESC
  `, [userId, startDate, endDate])).rows;

  // Attach the distinct products each customer purchased (sales only) in range
  const prodRows = (await query(`
    SELECT DISTINCT t.customer_name, t.customer_email, ti.product_id, ti.product_name
    FROM pos_transaction_items ti
    JOIN pos_transactions t ON ti.transaction_id = t.id
    WHERE t.user_id = $1 AND t.type = 'sale'
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
  `, [userId, startDate, endDate])).rows;
  const byCustomer = {};
  for (const r of prodRows) {
    const key = `${r.customer_name}|${r.customer_email}`;
    (byCustomer[key] = byCustomer[key] || []).push({ product_id: r.product_id, product_name: r.product_name });
  }

  // Attach the distinct employees who rang up each customer's sales in range
  const empRows = (await query(`
    SELECT DISTINCT t.customer_name, t.customer_email, e.id as employee_id, e.name as employee_name
    FROM pos_transaction_employees te
    JOIN pos_transactions t ON te.transaction_id = t.id
    JOIN pos_employees e ON te.employee_id = e.id
    WHERE t.user_id = $1 AND t.type = 'sale'
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
  `, [userId, startDate, endDate])).rows;
  const empByCustomer = {};
  for (const r of empRows) {
    const key = `${r.customer_name}|${r.customer_email}`;
    (empByCustomer[key] = empByCustomer[key] || []).push({ id: r.employee_id, name: r.employee_name });
  }

  for (const c of customers) {
    // Products/employees are keyed by the RAW transaction name (what prodRows/
    // empRows select), not the CRM's possibly-since-edited display name.
    const key = `${c.raw_customer_name}|${c.customer_email}`;
    c.products = byCustomer[key] || [];
    c.employees = empByCustomer[key] || [];
    delete c.raw_customer_name;
  }
  return customers;
}

// Returns where the credited employees differ from the original sale.
async function getFlaggedReturns(userId, startDate, endDate) {
  const rows = (await query(`
    SELECT r.id, r.receipt_number, r.created_at, r.total, r.tax_amount,
           orig.receipt_number as original_receipt
    FROM pos_transactions r
    LEFT JOIN pos_transactions orig ON r.original_transaction_id = orig.id
    WHERE r.user_id = ANY($1::text[]) AND r.type = 'return' AND r.employees_changed = 1
      AND COALESCE(r.original_sale_date, r.created_at) >= $2
      AND COALESCE(r.original_sale_date, r.created_at) <= $3
    ORDER BY r.created_at DESC
  `, [asCompanyIds(userId), startDate, endDate])).rows;
  for (const r of rows) {
    r.return_employees = (await query(
      `SELECT e.name FROM pos_transaction_employees te JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [r.id]
    )).rows.map(x => x.name);
    r.sale_employees = r.original_receipt ? (await query(
      `SELECT e.name FROM pos_transaction_employees te
       JOIN pos_employees e ON te.employee_id = e.id
       JOIN pos_transactions orig ON te.transaction_id = orig.id
       WHERE orig.receipt_number = $1 AND orig.user_id = ANY($2::text[])`, [r.original_receipt, asCompanyIds(userId)]
    )).rows.map(x => x.name) : [];
  }
  return rows;
}

// Card sales recorded in the POS for a single local calendar day (for batch
// reconciliation). Amounts include tax, matching what the card was charged.
// One row per CARD tender, expanding split payments. New sales have explicit
// tender rows in pos_transaction_payments; legacy card sales (no tender rows)
// synthesize a single card tender from the transaction's own columns. The
// amounts here are the card portion only, so a split sale contributes just the
// part actually charged to a card — which is what settles at the merchant.
const CARD_TENDERS_CTE = `
  WITH card_pay AS (
    SELECT p.transaction_id, p.amount, p.card_last4
    FROM pos_transaction_payments p
    WHERE p.method = 'card'
    UNION ALL
    SELECT t.id, t.total, t.card_last4
    FROM pos_transactions t
    WHERE t.payment_method = 'card'
      AND NOT EXISTS (SELECT 1 FROM pos_transaction_payments p2 WHERE p2.transaction_id = t.id)
  )`;

async function getCardSalesForDate(userId, dateStr, tz) {
  const timezone = tz || 'America/Los_Angeles';
  const rows = (await query(`
    ${CARD_TENDERS_CTE}
    SELECT
      COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'sale')   AS sale_count,
      COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'return') AS return_count,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN cp.amount ELSE 0 END), 0)    AS sales_total,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN cp.amount ELSE 0 END), 0)  AS returns_total,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN cp.amount ELSE -cp.amount END), 0) AS net_total
    FROM pos_transactions t
    JOIN card_pay cp ON cp.transaction_id = t.id
    WHERE t.user_id = $1
      AND (t.created_at AT TIME ZONE $3)::date = $2::date
  `, [userId, dateStr, timezone])).rows;
  const r = rows[0] || {};
  return {
    sale_count: Number(r.sale_count || 0),
    return_count: Number(r.return_count || 0),
    sales_total: Number(r.sales_total || 0),
    returns_total: Number(r.returns_total || 0),
    net_total: Number(r.net_total || 0),
  };
}

// Net card sales per local day over a range (for the batch audit).
async function getCardSalesByDateRange(userId, fromStr, toStr, tz) {
  const timezone = tz || 'America/Los_Angeles';
  const rows = (await query(`
    ${CARD_TENDERS_CTE}
    SELECT (t.created_at AT TIME ZONE $4)::date AS d,
      COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'sale')   AS sale_count,
      COUNT(DISTINCT t.id) FILTER (WHERE t.type = 'return') AS return_count,
      COALESCE(SUM(cp.amount) FILTER (WHERE t.type = 'sale'), 0)   AS sales_total,
      COALESCE(SUM(cp.amount) FILTER (WHERE t.type = 'return'), 0) AS returns_total,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN cp.amount ELSE -cp.amount END), 0) AS net_total
    FROM pos_transactions t
    JOIN card_pay cp ON cp.transaction_id = t.id
    WHERE t.user_id = $1
      AND (t.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
    GROUP BY d ORDER BY d
  `, [userId, fromStr, toStr, timezone])).rows;
  return rows.map(r => ({
    date: (r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10)),
    sale_count: Number(r.sale_count || 0),
    return_count: Number(r.return_count || 0),
    sales_total: Number(r.sales_total || 0),
    returns_total: Number(r.returns_total || 0),
    net_total: Number(r.net_total || 0),
  }));
}

// One row per CARD tender for the day (split sales yield multiple rows), so the
// drill-down matcher can match each card charge to its Maverick settlement.
// `total` here is the tender's amount, not the whole sale.
async function getCardTransactionsForDate(userId, dateStr, tz) {
  const timezone = tz || 'America/Los_Angeles';
  return (await query(`
    ${CARD_TENDERS_CTE}
    SELECT t.id, t.type, cp.amount AS total, cp.card_last4, t.receipt_number, t.customer_name, t.created_at,
      (SELECT string_agg(e.name, ', ' ORDER BY e.name)
       FROM pos_transaction_employees te
       JOIN pos_employees e ON te.employee_id = e.id
       WHERE te.transaction_id = t.id) AS employee_names
    FROM pos_transactions t
    JOIN card_pay cp ON cp.transaction_id = t.id
    WHERE t.user_id = $1
      AND (t.created_at AT TIME ZONE $3)::date = $2::date
    ORDER BY t.created_at ASC
  `, [userId, dateStr, timezone])).rows;
}

// All tenders (any method), with the same legacy fallback as CARD_TENDERS_CTE,
// for the end-of-day report's cash/card/other breakdown.
const ALL_TENDERS_CTE = `
  WITH all_pay AS (
    SELECT p.transaction_id, p.method, p.amount
    FROM pos_transaction_payments p
    UNION ALL
    SELECT t.id, t.payment_method, t.total
    FROM pos_transactions t
    WHERE NOT EXISTS (SELECT 1 FROM pos_transaction_payments p2 WHERE p2.transaction_id = t.id)
  )`;

// End-of-day report for a single local calendar day: tender totals (net of
// same-day refunds), the day's sales summary, products sold, and each sales
// associate's contribution. Mirrors the printed "Day Summary" receipts stores
// are used to from their prior POS.
async function getDaySummary(userId, dateStr, tz) {
  const timezone = tz || 'America/Los_Angeles';
  const dayFilter = '(t.created_at AT TIME ZONE $3)::date = $2::date';

  const tenderRows = (await query(`
    ${ALL_TENDERS_CTE}
    SELECT ap.method,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN ap.amount ELSE 0 END), 0) AS sales_total,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN ap.amount ELSE 0 END), 0) AS returns_total
    FROM pos_transactions t
    JOIN all_pay ap ON ap.transaction_id = t.id
    WHERE t.user_id = $1 AND ${dayFilter}
    GROUP BY ap.method
  `, [userId, dateStr, timezone])).rows;

  // Keep in step with PAYMENT_METHODS in routes/pos.js — a method missing here
  // still counts, but silently as "Other" on the printed day summary.
  const tenders = { cash: 0, card: 0, check: 0, other: 0 };
  for (const r of tenderRows) {
    const method = ['cash', 'card', 'check', 'other'].includes(r.method) ? r.method : 'other';
    tenders[method] += Number(r.sales_total || 0) - Number(r.returns_total || 0);
  }

  const summaryRow = (await query(`
    SELECT
      COUNT(CASE WHEN t.type = 'sale' THEN 1 END) as total_sales,
      COUNT(CASE WHEN t.type = 'return' THEN 1 END) as total_returns,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.total - t.tax_amount ELSE 0 END), 0) as sales_revenue,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN t.total - t.tax_amount ELSE 0 END), 0) as returns_revenue,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN t.total ELSE 0 END), 0) as refunded_total,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.tax_amount ELSE -t.tax_amount END), 0) as net_tax,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.total ELSE -t.total END), 0) as net_total
    FROM pos_transactions t
    WHERE t.user_id = $1 AND ${dayFilter}
  `, [userId, dateStr, timezone])).rows[0] || {};

  const products = (await query(`
    SELECT ti.product_name,
      SUM(CASE WHEN t.type = 'sale' THEN ti.quantity ELSE -ti.quantity END) as qty
    FROM pos_transaction_items ti
    JOIN pos_transactions t ON ti.transaction_id = t.id
    WHERE t.user_id = $1 AND ${dayFilter}
    GROUP BY ti.product_name
    HAVING SUM(CASE WHEN t.type = 'sale' THEN ti.quantity ELSE -ti.quantity END) != 0
    ORDER BY qty DESC
  `, [userId, dateStr, timezone])).rows;

  // Gross sales per associate = their proportional (commission-based) share of
  // each transaction's tax-inclusive total, not just the pre-tax commission.
  const associates = (await query(`
    SELECT e.name as employee_name,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN tiq.qty ELSE -tiq.qty END), 0) as total_products,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount ELSE -te.commission_amount END), 0) as net_sales,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount / NULLIF(t.subtotal, 0) * t.total
                        ELSE -(te.commission_amount / NULLIF(t.subtotal, 0) * t.total) END), 0) as gross_sales
    FROM pos_transaction_employees te
    JOIN pos_employees e ON te.employee_id = e.id
    JOIN pos_transactions t ON te.transaction_id = t.id
    JOIN (SELECT transaction_id, SUM(quantity) as qty FROM pos_transaction_items GROUP BY transaction_id) tiq
      ON tiq.transaction_id = t.id
    WHERE t.user_id = $1 AND ${dayFilter}
    GROUP BY e.id, e.name
    HAVING COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount ELSE -te.commission_amount END), 0) != 0
        OR COALESCE(SUM(CASE WHEN t.type = 'sale' THEN tiq.qty ELSE -tiq.qty END), 0) != 0
    ORDER BY net_sales DESC
  `, [userId, dateStr, timezone])).rows;

  return {
    date: dateStr,
    tenders,
    summary: {
      total_sales: Number(summaryRow.total_sales || 0),
      total_returns: Number(summaryRow.total_returns || 0),
      refunded_total: Number(summaryRow.refunded_total || 0),
      net_tax: Number(summaryRow.net_tax || 0),
      net_total: Number(summaryRow.net_total || 0),
      net_revenue: Number(summaryRow.sales_revenue || 0) - Number(summaryRow.returns_revenue || 0),
    },
    products: products.map(p => ({ product_name: p.product_name, qty: Number(p.qty) })),
    associates: associates.map(a => ({
      employee_name: a.employee_name,
      total_products: Number(a.total_products),
      net_sales: Number(a.net_sales),
      gross_sales: Number(a.gross_sales),
    })),
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

async function getSettings(userId) {
  let result = await query('SELECT * FROM pos_settings WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) {
    await query('INSERT INTO pos_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    result = await query('SELECT * FROM pos_settings WHERE user_id = $1', [userId]);
  }
  return result.rows[0];
}

async function updateSettings(userId, fields) {
  const allowed = ['store_name', 'store_address', 'store_city', 'store_state', 'store_zip', 'receipt_footer', 'timezone', 'tax_rate', 'theme', 'brands', 'maverick_dba_id', 'maverick_token'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      params.push(fields[key]);
      idx++;
    }
  }
  if (sets.length === 0) return;
  // Ensure a row exists for this company (own query/params — $1 here).
  await query('INSERT INTO pos_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  // UPDATE uses $1..$idx-1 for the fields and $idx for the user_id.
  params.push(userId);
  await query(`UPDATE pos_settings SET ${sets.join(', ')} WHERE user_id = $${idx}`, params);
}

// ─── Commission Plans ───────────────────────────────────────────────────────

async function getCommissionPlan(employeeId) {
  return (await query('SELECT * FROM pos_commission_plans WHERE employee_id = $1', [employeeId])).rows[0] || null;
}

async function setCommissionPlan(employeeId, plan, userId) {
  // Delete old and insert fresh (simpler than upsert on employee_id)
  await query('DELETE FROM pos_commission_plans WHERE employee_id = $1', [employeeId]);
  await query(
    `INSERT INTO pos_commission_plans (employee_id, plan_type, base_rate, tier_rate, tier_threshold, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [employeeId, plan.plan_type, plan.base_rate, plan.tier_rate || 0, plan.tier_threshold || 0, userId]
  );
}

async function deleteCommissionPlan(employeeId) {
  await query('DELETE FROM pos_commission_plans WHERE employee_id = $1', [employeeId]);
}

async function getAllCommissionPlans(userId) {
  return (await query('SELECT * FROM pos_commission_plans WHERE user_id = $1', [userId])).rows;
}

// An employee's credited SALE amounts over a date range, plus the commission
// those earn under their plan.
//
// sales_total / returns_total / net_total are always credited SALE dollars —
// the same thing the plain SQL report returns for employees with no plan — so
// the Sales/Net Sales columns and the leaderboard mean the same thing for
// everyone. The commission itself is reported separately as commission_total.
// (These used to be overwritten with the commission for tiered-plan employees,
// which made the leaderboard show their commission next to everyone else's
// sales — e.g. $157.50 of commission beside $800 of sales.)
//
// pos_transaction_employees.commission_amount is misleadingly named: it stores
// the employee's credited share of the pre-tax subtotal, not a commission.
async function calculateEmployeeCommission(employeeId, userId, startDate, endDate) {
  const plan = await getCommissionPlan(employeeId);

  // Get all transactions this employee was on
  // userId is a company SCOPE (an array) everywhere this is called from, so it
  // has to be matched with ANY. A plain `= $2` silently matched nothing —
  // node-pg renders the array as the literal '{company-a}', which never equals
  // a company id — zeroing the sales of every employee on a commission plan.
  const txResult = await query(`
    SELECT t.id, t.type, t.created_at, te.commission_value, te.commission_amount
    FROM pos_transactions t
    JOIN pos_transaction_employees te ON t.id = te.transaction_id
    WHERE te.employee_id = $1 AND t.user_id = ANY($2::text[])
      AND COALESCE(t.original_sale_date, t.created_at) >= $3
      AND COALESCE(t.original_sale_date, t.created_at) <= $4
  `, [employeeId, asCompanyIds(userId), startDate, endDate]);

  if (!plan || plan.plan_type === 'flat') {
    let salesTotal = 0, returnsTotal = 0, saleCount = 0, returnCount = 0;
    for (const tx of txResult.rows) {
      // Number() because commission_amount only arrives as a JS number while
      // the column is REAL — as NUMERIC it would come back a string and these
      // += would concatenate ("5400" + "150" = "5400150") rather than add.
      const amt = Number(tx.commission_amount) || 0;
      if (tx.type === 'sale') { salesTotal += amt; saleCount++; }
      else { returnsTotal += amt; returnCount++; }
    }
    const netTotal = salesTotal - returnsTotal;
    const rate = plan ? Number(plan.base_rate) || 0 : null;
    return {
      sale_count: saleCount, return_count: returnCount,
      sales_total: salesTotal, returns_total: returnsTotal, net_total: netTotal,
      // No plan row at all → let the caller fall back to the employee's own
      // commission_rate rather than asserting a rate here.
      commission_total: rate === null ? null : netTotal * rate / 100,
    };
  }

  if (plan.plan_type === 'daily_threshold') {
    // Group transactions by calendar day
    const byDay = {};
    for (const tx of txResult.rows) {
      const day = new Date(tx.created_at).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(tx);
    }

    let salesTotal = 0, returnsTotal = 0, saleCount = 0, returnCount = 0, commissionTotal = 0;
    for (const [, dayTxs] of Object.entries(byDay)) {
      // Which rate the day earns depends on that day's net credited SALES
      // (pre-tax, this employee's share) — not on commission dollars, and not
      // on the tax-inclusive total, which would push them over the threshold
      // early and inflate the payout.
      const dayNetSales = dayTxs.reduce((sum, tx) => {
        const amt = Number(tx.commission_amount) || 0;
        return sum + (tx.type === 'sale' ? amt : -amt);
      }, 0);

      const rate = dayNetSales > plan.tier_threshold ? plan.tier_rate : plan.base_rate;

      for (const tx of dayTxs) {
        const empShare = Number(tx.commission_amount) || 0;
        const commission = empShare * (rate / 100);
        if (tx.type === 'sale') { salesTotal += empShare; commissionTotal += commission; saleCount++; }
        else { returnsTotal += empShare; commissionTotal -= commission; returnCount++; }
      }
    }
    return {
      sale_count: saleCount, return_count: returnCount,
      sales_total: salesTotal, returns_total: returnsTotal, net_total: salesTotal - returnsTotal,
      commission_total: commissionTotal,
    };
  }

  return { sale_count: 0, return_count: 0, sales_total: 0, returns_total: 0, net_total: 0, commission_total: 0 };
}

// ─── Additional Customer queries ────────────────────────────────────────────

async function updateCustomerNotes(id, notes) {
  await query('UPDATE customers SET notes = $1, updated_at = NOW() WHERE id = $2', [notes, id]);
}

async function getCustomersByProduct(productId, userId) {
  const rows = userId
    ? (await query(`SELECT DISTINCT c.* FROM customers c JOIN customer_products cp ON c.id = cp.customer_id WHERE cp.product_id = $1 AND c.user_id = $2 ORDER BY c.updated_at DESC`, [productId, userId])).rows
    : (await query(`SELECT DISTINCT c.* FROM customers c JOIN customer_products cp ON c.id = cp.customer_id WHERE cp.product_id = $1 ORDER BY c.updated_at DESC`, [productId])).rows;
  for (const c of rows) {
    c.products = (await query('SELECT * FROM customer_products WHERE customer_id = $1 ORDER BY purchased_at DESC', [c.id])).rows;
  }
  return rows;
}

async function getCustomersByProducts(productIds, userId) {
  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
  const params = [...productIds];
  let whereExtra = '';
  if (userId) {
    whereExtra = ` AND c.user_id = $${params.length + 1}`;
    params.push(userId);
  }
  const rows = (await query(`SELECT DISTINCT c.* FROM customers c JOIN customer_products cp ON c.id = cp.customer_id WHERE cp.product_id IN (${placeholders})${whereExtra} ORDER BY c.updated_at DESC`, params)).rows;
  for (const c of rows) {
    c.products = (await query('SELECT * FROM customer_products WHERE customer_id = $1 ORDER BY purchased_at DESC', [c.id])).rows;
  }
  return rows;
}

async function getUniqueCustomerEmails(userId) {
  if (userId) {
    return (await query('SELECT DISTINCT email FROM customers WHERE user_id = $1 ORDER BY email', [userId])).rows.map(r => r.email);
  }
  return (await query('SELECT DISTINCT customer_email FROM welcome_emails ORDER BY customer_email')).rows.map(r => r.customer_email);
}

// ─── Welcome Emails ─────────────────────────────────────────────────────────

async function saveWelcomeEmail({ customer_name, customer_email, products, user_id }) {
  const result = await query(
    'INSERT INTO welcome_emails (customer_name, customer_email, products, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [customer_name, customer_email, JSON.stringify(products), user_id || '']
  );
  return result.rows[0].id;
}

async function getWelcomeEmails(userId, limit = 50) {
  if (userId) {
    return (await query('SELECT * FROM welcome_emails WHERE user_id = $1 ORDER BY sent_at DESC LIMIT $2', [userId, limit])).rows;
  }
  return (await query('SELECT * FROM welcome_emails ORDER BY sent_at DESC LIMIT $1', [limit])).rows;
}

// ─── Sent Emails log ────────────────────────────────────────────────────────

async function logSentEmail({ user_id, to_email, to_name, subject, body, kind }) {
  try {
    const result = await query(
      `INSERT INTO sent_emails (user_id, to_email, to_name, subject, body, kind)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user_id || '', to_email || '', to_name || '', subject || '', body || '', kind || 'welcome']
    );
    return result.rows[0]?.id;
  } catch (e) {
    console.error('[postgres] logSentEmail failed:', e.message);
    return null;
  }
}

async function getSentEmails(userId, limit = 200) {
  return (await query(
    `SELECT id, to_email, to_name, subject, kind, sent_at
     FROM sent_emails WHERE user_id = $1 ORDER BY sent_at DESC LIMIT $2`,
    [userId, limit]
  )).rows;
}

async function getSentEmail(id, userId) {
  return (await query('SELECT * FROM sent_emails WHERE id = $1 AND user_id = $2', [id, userId])).rows[0] || null;
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

async function saveCampaign({ subject, body, recipient_count, user_id }) {
  const result = await query(
    'INSERT INTO campaigns (subject, body, recipient_count, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [subject, body, recipient_count, user_id || '']
  );
  return result.rows[0].id;
}

async function getCampaigns(userId, limit = 50) {
  if (userId) {
    return (await query('SELECT * FROM campaigns WHERE user_id = $1 ORDER BY sent_at DESC LIMIT $2', [userId, limit])).rows;
  }
  return (await query('SELECT * FROM campaigns ORDER BY sent_at DESC LIMIT $1', [limit])).rows;
}

// ─── Custom Products ────────────────────────────────────────────────────────

async function getCustomProducts(userId) {
  return (await query('SELECT * FROM pos_custom_products WHERE user_id = $1 AND active = 1 ORDER BY name', [userId])).rows;
}

async function createCustomProduct(fields, userId) {
  const result = await query(
    'INSERT INTO pos_custom_products (name, brand, description, image, price, min_price, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [fields.name, fields.brand || 'Custom', fields.description || '', fields.image || '', fields.price || 0, fields.min_price || 0, userId]
  );
  return result.rows[0];
}

async function updateCustomProduct(id, fields) {
  const allowed = ['name', 'brand', 'description', 'image', 'price', 'min_price', 'active'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) { sets.push(`${key} = $${idx}`); params.push(fields[key]); idx++; }
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE pos_custom_products SET ${sets.join(', ')} WHERE id = $${idx}`, params);
}

// ─── Product Visibility ─────────────────────────────────────────────────────

async function getProductVisibility(userId) {
  return (await query('SELECT * FROM pos_product_visibility WHERE user_id = $1', [userId])).rows;
}

async function setProductVisibility(productId, userId, visible) {
  await query(
    `INSERT INTO pos_product_visibility (product_id, user_id, visible) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, user_id) DO UPDATE SET visible = EXCLUDED.visible`,
    [productId, userId, visible ? 1 : 0]
  );
}

// ─── Gmail tokens (per-company, persistent) ─────────────────────────────────

async function saveGmailToken(userId, refreshToken, email) {
  if (!userId || !refreshToken) return;
  await query(
    `INSERT INTO pos_gmail_tokens (user_id, refresh_token, email, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, email = EXCLUDED.email, updated_at = NOW()`,
    [userId, refreshToken, email || '']
  );
}

async function getGmailToken(userId) {
  if (!userId) return null;
  const r = await query('SELECT refresh_token FROM pos_gmail_tokens WHERE user_id = $1', [userId]);
  return r.rows[0]?.refresh_token || null;
}

// ─── Legacy data bridge ───────────────────────────────────────────────────
// Move every user-scoped row from one userId to another.
async function migrateDataBetweenUsers(oldUserId, newUserId) {
  if (!pool || !oldUserId || oldUserId === newUserId) return;

  // pos_settings.user_id is a PRIMARY KEY, so clear the destination row first
  try {
    const oldSettings = await query('SELECT 1 FROM pos_settings WHERE user_id = $1', [oldUserId]);
    if (oldSettings.rows.length > 0) {
      await query('DELETE FROM pos_settings WHERE user_id = $1', [newUserId]);
      await query('UPDATE pos_settings SET user_id = $1 WHERE user_id = $2', [newUserId, oldUserId]);
    }
  } catch (_) {}

  const tables = [
    'pos_product_prices', 'pos_employees', 'pos_custom_products',
    'pos_product_visibility', 'pos_transactions',
    'pos_commission_plans', 'customers', 'welcome_emails', 'campaigns',
  ];
  for (const table of tables) {
    try {
      await query(`DELETE FROM ${table} WHERE user_id = $1`, [newUserId]);
      await query(`UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [newUserId, oldUserId]);
    } catch (_) { /* table might not exist yet */ }
  }
}

// Since user IDs are now stable (derived from the login email), data no longer
// churns across redeploys. This one-time, NON-destructive bridge reattaches a
// pre-existing orphaned dataset to its rightful company, and — crucially —
// never pulls another company's data:
//   • It registers each stable userId in pos_known_users.
//   • It only considers "legacy" datasets that are NOT known stable users.
//   • It only claims a legacy dataset when it is unambiguous: either its store
//     name matches this company's name, or it is the only legacy dataset.
async function bridgeLegacyData(newUserId, companyName) {
  if (!pool || !newUserId) return;

  // Register this account as a known stable user.
  await query('INSERT INTO pos_known_users (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [newUserId]);

  // If this account already has data, there is nothing to bridge.
  const hasData = (await query(
    `SELECT 1 FROM pos_transactions WHERE user_id = $1
     UNION SELECT 1 FROM pos_product_prices WHERE user_id = $1 LIMIT 1`, [newUserId]
  )).rows.length > 0;
  if (hasData) return;

  // Candidate legacy datasets: have data, aren't this user, aren't a known stable user.
  const legacy = (await query(`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM pos_product_prices
      UNION SELECT user_id FROM pos_transactions
      UNION SELECT user_id FROM pos_custom_products
      UNION SELECT user_id FROM pos_employees
    ) d
    WHERE user_id <> '' AND user_id <> $1
      AND user_id NOT IN (SELECT user_id FROM pos_known_users)
  `, [newUserId])).rows.map(r => r.user_id);
  if (legacy.length === 0) return;

  // Look up each legacy dataset's store name so we can attribute it safely.
  const legacyInfo = [];
  for (const uid of legacy) {
    const s = (await query('SELECT store_name FROM pos_settings WHERE user_id = $1', [uid])).rows[0];
    legacyInfo.push({ uid, store: (s?.store_name || '').trim().toLowerCase() });
  }

  let target = null;
  const name = (companyName || '').trim().toLowerCase();
  if (name) {
    // Prefer an exact store-name match.
    const matches = legacyInfo.filter(l => l.store && l.store === name);
    if (matches.length === 1) {
      target = matches[0].uid;
    } else if (matches.length === 0 && legacyInfo.length === 1 && !legacyInfo[0].store) {
      // Only claim a single, truly UNATTRIBUTED dataset (no store name of its own).
      // Never let a named company grab a dataset that belongs to a different store.
      target = legacyInfo[0].uid;
    }
  } else if (legacyInfo.length === 1) {
    // This account has no company name; safe only when there's exactly one orphan.
    target = legacyInfo[0].uid;
  }
  if (!target) return; // ambiguous — never risk cross-company corruption

  await migrateDataBetweenUsers(target, newUserId);
  console.log(`[postgres] Bridged legacy POS data ${target} -> ${newUserId} (${companyName || 'unnamed'})`);
}

module.exports = {
  pool,
  initSchema,
  bridgeLegacyData,
  migrateDataBetweenUsers,
  saveGmailToken,
  getGmailToken,
  // Customers
  findOrCreateCustomer,
  addCustomerProducts,
  getCustomers,
  getCustomer,
  getCustomerByEmail,
  updateCustomer,
  updateCustomerNotes,
  getCustomersByProduct,
  getCustomersByProducts,
  getUniqueCustomerEmails,
  // Welcome Emails & Campaigns
  saveWelcomeEmail,
  getWelcomeEmails,
  logSentEmail,
  getSentEmails,
  getSentEmail,
  saveCampaign,
  getCampaigns,
  // Employees
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  verifyEmployeePin,
  // Prices
  getProductPrices,
  setProductPrice,
  // Transactions
  createTransaction,
  addTransactionItems,
  addTransactionEmployees,
  addTransactionPayments,
  getTransaction,
  getTransactionByReceipt,
  getTransactions,
  getEmployeeTransactions,
  updateTransaction,
  deleteTransaction,
  setTransactionChargeback,
  getAuditReviews,
  setAuditReview,
  getSavedAudits,
  saveAudit,
  deleteSavedAudit,
  moveTransactionToCompany,
  receiptExists,
  importTransaction,
  // Reports
  getSalesReport,
  getEmployeeSalesReport,
  getTopProductsReport,
  getCustomerReport,
  getFlaggedReturns,
  getDaySummary,
  // Settings
  getSettings,
  updateSettings,
  getCardSalesForDate,
  getCardSalesByDateRange,
  getCardTransactionsForDate,
  // Commission Plans
  getCommissionPlan,
  setCommissionPlan,
  deleteCommissionPlan,
  getAllCommissionPlans,
  calculateEmployeeCommission,
  // Custom Products
  getCustomProducts,
  createCustomProduct,
  updateCustomProduct,
  // Product Visibility
  getProductVisibility,
  setProductVisibility,
};
