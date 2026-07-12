'use strict';

const { Pool } = require('pg');

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

    -- POS store settings
    CREATE TABLE IF NOT EXISTS pos_settings (
      user_id TEXT PRIMARY KEY,
      store_name TEXT DEFAULT '',
      store_address TEXT DEFAULT '',
      receipt_footer TEXT DEFAULT 'Thank you for your purchase!',
      timezone TEXT DEFAULT 'America/Los_Angeles',
      tax_rate REAL DEFAULT 0.0875
    );
  `);
  // Migrations for existing DBs
  const migrate = async (sql) => { try { await query(sql); } catch (_) {} };
  await migrate('ALTER TABLE pos_employees ADD COLUMN IF NOT EXISTS commission_rate REAL DEFAULT 0');
  await migrate('ALTER TABLE pos_product_prices ADD COLUMN IF NOT EXISTS min_price REAL DEFAULT 0');
  await migrate('ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS card_last4 TEXT DEFAULT \'\'');
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_address TEXT DEFAULT ''");
  await migrate('ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS tax_rate REAL DEFAULT 0.0875');

  console.log('[postgres] Schema initialized');
}

// ─── Customers ──────────────────────────────────────────────────────────────

async function findOrCreateCustomer(name, email, userId) {
  const existing = userId
    ? (await query('SELECT * FROM customers WHERE email = $1 AND user_id = $2', [email, userId])).rows[0]
    : (await query('SELECT * FROM customers WHERE email = $1', [email])).rows[0];
  if (existing) {
    if (name && name !== existing.name) {
      await query('UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2', [name, existing.id]);
      existing.name = name;
    }
    return existing;
  }
  const result = await query(
    'INSERT INTO customers (name, email, user_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, email) DO UPDATE SET name = EXCLUDED.name RETURNING *',
    [name || '', email, userId || '']
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
  const allowed = ['name', 'email', 'phone', 'address', 'notes'];
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

async function verifyEmployeePin(pin, userId) {
  return (await query('SELECT * FROM pos_employees WHERE pin = $1 AND user_id = $2 AND active = 1', [pin, userId])).rows[0];
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

async function createTransaction(txData) {
  const receiptNumber = await generateReceiptNumber();
  const result = await query(
    `INSERT INTO pos_transactions
      (type, employee_id, customer_id, customer_name, customer_email,
       subtotal, tax_rate, tax_amount, discount_amount, total,
       payment_method, card_last4, notes, receipt_number, original_transaction_id, original_sale_date, user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, receipt_number`,
    [
      txData.type || 'sale', txData.employee_id || null, txData.customer_id || null,
      txData.customer_name || '', txData.customer_email || '',
      txData.subtotal, txData.tax_rate ?? 0.0875, txData.tax_amount,
      txData.discount_amount || 0, txData.total,
      txData.payment_method || 'card', txData.card_last4 || '', txData.notes || '',
      receiptNumber, txData.original_transaction_id || null,
      txData.original_sale_date || null, txData.user_id,
    ]
  );
  return { id: result.rows[0].id, receipt_number: result.rows[0].receipt_number };
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

async function getTransaction(id) {
  const tx = (await query('SELECT * FROM pos_transactions WHERE id = $1', [id])).rows[0];
  if (!tx) return null;
  tx.items = (await query('SELECT * FROM pos_transaction_items WHERE transaction_id = $1', [id])).rows;
  tx.employees = (await query(
    `SELECT te.*, e.name as employee_name FROM pos_transaction_employees te
     JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [id]
  )).rows;
  return tx;
}

async function getTransactionByReceipt(receiptNumber, userId) {
  const tx = (await query('SELECT * FROM pos_transactions WHERE receipt_number = $1 AND user_id = $2', [receiptNumber, userId])).rows[0];
  if (!tx) return null;
  tx.items = (await query('SELECT * FROM pos_transaction_items WHERE transaction_id = $1', [tx.id])).rows;
  tx.employees = (await query(
    `SELECT te.*, e.name as employee_name FROM pos_transaction_employees te
     JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [tx.id]
  )).rows;
  return tx;
}

async function getTransactions(userId, opts = {}) {
  const { type, startDate, endDate, employeeId, limit = 100 } = opts;
  let where = 'WHERE t.user_id = $1';
  const params = [userId];
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
  }
  return transactions;
}

// ─── Reports ────────────────────────────────────────────────────────────────

async function getSalesReport(userId, startDate, endDate) {
  const result = await query(`
    SELECT
      COUNT(CASE WHEN type = 'sale' THEN 1 END) as total_sales,
      COUNT(CASE WHEN type = 'return' THEN 1 END) as total_returns,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE 0 END), 0) as sales_revenue,
      COALESCE(SUM(CASE WHEN type = 'return' THEN total ELSE 0 END), 0) as returns_total,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE -total END), 0) as net_revenue,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN tax_amount ELSE -tax_amount END), 0) as net_tax
    FROM pos_transactions
    WHERE user_id = $1
      AND COALESCE(original_sale_date, created_at) >= $2
      AND COALESCE(original_sale_date, created_at) <= $3
  `, [userId, startDate, endDate]);
  return result.rows[0];
}

async function getEmployeeSalesReport(userId, startDate, endDate) {
  return (await query(`
    SELECT
      e.id as employee_id, e.name as employee_name,
      COUNT(DISTINCT CASE WHEN t.type = 'sale' THEN t.id END) as sale_count,
      COUNT(DISTINCT CASE WHEN t.type = 'return' THEN t.id END) as return_count,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount ELSE 0 END), 0) as sales_total,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN te.commission_amount ELSE 0 END), 0) as returns_total,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN te.commission_amount ELSE -te.commission_amount END), 0) as net_total
    FROM pos_employees e
    LEFT JOIN pos_transaction_employees te ON e.id = te.employee_id
    LEFT JOIN pos_transactions t ON te.transaction_id = t.id
      AND t.user_id = $1
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
    WHERE e.user_id = $4
    GROUP BY e.id ORDER BY net_total DESC
  `, [userId, startDate, endDate, userId])).rows;
}

async function getTopProductsReport(userId, startDate, endDate) {
  return (await query(`
    SELECT ti.product_id, ti.product_name, ti.brand,
      SUM(CASE WHEN t.type = 'sale' THEN ti.quantity ELSE -ti.quantity END) as units_sold,
      SUM(CASE WHEN t.type = 'sale' THEN ti.line_total ELSE -ti.line_total END) as revenue
    FROM pos_transaction_items ti
    JOIN pos_transactions t ON ti.transaction_id = t.id
    WHERE t.user_id = $1
      AND COALESCE(t.original_sale_date, t.created_at) >= $2
      AND COALESCE(t.original_sale_date, t.created_at) <= $3
    GROUP BY ti.product_id, ti.product_name, ti.brand ORDER BY revenue DESC
  `, [userId, startDate, endDate])).rows;
}

async function getCustomerReport(userId, startDate, endDate) {
  return (await query(`
    SELECT customer_name, customer_email,
      COUNT(CASE WHEN type = 'sale' THEN 1 END) as purchases,
      COUNT(CASE WHEN type = 'return' THEN 1 END) as returns,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE -total END), 0) as total_spent
    FROM pos_transactions
    WHERE user_id = $1
      AND COALESCE(original_sale_date, created_at) >= $2
      AND COALESCE(original_sale_date, created_at) <= $3
      AND customer_name != ''
    GROUP BY customer_name, customer_email ORDER BY total_spent DESC
  `, [userId, startDate, endDate])).rows;
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
  const allowed = ['store_name', 'store_address', 'receipt_footer', 'timezone', 'tax_rate'];
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
  await query(`INSERT INTO pos_settings (user_id) VALUES ($${idx}) ON CONFLICT DO NOTHING`, [userId]);
  params.push(userId);
  await query(`UPDATE pos_settings SET ${sets.join(', ')} WHERE user_id = $${idx}`, params);
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

module.exports = {
  pool,
  initSchema,
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
  getTransaction,
  getTransactionByReceipt,
  getTransactions,
  // Reports
  getSalesReport,
  getEmployeeSalesReport,
  getTopProductsReport,
  getCustomerReport,
  // Settings
  getSettings,
  updateSettings,
  // Custom Products
  getCustomProducts,
  createCustomProduct,
  updateCustomProduct,
  // Product Visibility
  getProductVisibility,
  setProductVisibility,
};
