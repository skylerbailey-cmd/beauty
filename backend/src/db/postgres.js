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
      receipt_footer TEXT DEFAULT 'Thank you for your purchase!',
      timezone TEXT DEFAULT 'America/Los_Angeles',
      tax_rate REAL DEFAULT 0.0875,
      theme TEXT DEFAULT 'rose',
      brands TEXT DEFAULT '["avologi","avinichi","hydrasphere"]'
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
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS store_address TEXT DEFAULT ''");
  await migrate('ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS tax_rate REAL DEFAULT 0.0875');
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'rose'");
  await migrate("ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS brands TEXT DEFAULT '[\"avologi\",\"avinichi\",\"hydrasphere\"]'");

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
      (type, employee_id, customer_id, customer_name, customer_email,
       subtotal, tax_rate, tax_amount, discount_amount, total,
       payment_method, card_last4, notes, receipt_number, original_transaction_id, original_sale_date, employees_changed, user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, receipt_number`,
    [
      txData.type || 'sale', txData.employee_id || null, txData.customer_id || null,
      txData.customer_name || '', txData.customer_email || '',
      txData.subtotal, txData.tax_rate ?? 0.0875, txData.tax_amount,
      txData.discount_amount || 0, txData.total,
      txData.payment_method || 'card', txData.card_last4 || '', txData.notes || '',
      receiptNumber, txData.original_transaction_id || null,
      txData.original_sale_date || null, txData.employees_changed ? 1 : 0, txData.user_id,
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
  return tx;
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
       customer_name = $1, customer_email = $2, subtotal = $3, tax_amount = $4,
       discount_amount = $5, total = $6, payment_method = $7, card_last4 = $8,
       notes = $9, employee_id = $10
     WHERE id = $11 AND user_id = $12`,
    [
      data.customer_name ?? existing.customer_name,
      data.customer_email ?? existing.customer_email,
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

// Manager-gated delete. Scoped by userId (company).
async function deleteTransaction(id, userId) {
  const existing = (await query('SELECT id FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
  if (!existing) return false;
  // Detach any returns that referenced this sale so the FK doesn't block deletion
  await query('UPDATE pos_transactions SET original_transaction_id = NULL WHERE original_transaction_id = $1', [id]);
  await query('DELETE FROM pos_transaction_employees WHERE transaction_id = $1', [id]);
  await query('DELETE FROM pos_transaction_items WHERE transaction_id = $1', [id]);
  await query('DELETE FROM pos_transactions WHERE id = $1 AND user_id = $2', [id, userId]);
  return true;
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
      -- Revenue figures EXCLUDE tax (tax is reported separately as net_tax)
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total - tax_amount ELSE 0 END), 0) as sales_revenue,
      COALESCE(SUM(CASE WHEN type = 'return' THEN total - tax_amount ELSE 0 END), 0) as returns_total,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total - tax_amount ELSE -(total - tax_amount) END), 0) as net_revenue,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN tax_amount ELSE -tax_amount END), 0) as net_tax
    FROM pos_transactions
    WHERE user_id = $1
      AND COALESCE(original_sale_date, created_at) >= $2
      AND COALESCE(original_sale_date, created_at) <= $3
  `, [userId, startDate, endDate]);
  return result.rows[0];
}

async function getEmployeeSalesReport(userId, startDate, endDate) {
  // Get base report from the standard query
  const baseReport = (await query(`
    SELECT
      e.id as employee_id, e.name as employee_name, e.commission_rate,
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
    WHERE e.user_id = $4 AND e.active = 1
    GROUP BY e.id ORDER BY net_total DESC
  `, [userId, startDate, endDate, userId])).rows;

  // Check for special commission plans and recalculate those employees
  const plans = await getAllCommissionPlans(userId);
  const planByEmp = {};
  for (const p of plans) planByEmp[p.employee_id] = p;

  for (const row of baseReport) {
    if (planByEmp[row.employee_id]) {
      const recalc = await calculateEmployeeCommission(row.employee_id, userId, startDate, endDate);
      row.sales_total = recalc.sales_total;
      row.returns_total = recalc.returns_total;
      row.net_total = recalc.net_total;
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

// Returns where the credited employees differ from the original sale.
async function getFlaggedReturns(userId, startDate, endDate) {
  const rows = (await query(`
    SELECT r.id, r.receipt_number, r.created_at, r.total, r.tax_amount,
           orig.receipt_number as original_receipt
    FROM pos_transactions r
    LEFT JOIN pos_transactions orig ON r.original_transaction_id = orig.id
    WHERE r.user_id = $1 AND r.type = 'return' AND r.employees_changed = 1
      AND COALESCE(r.original_sale_date, r.created_at) >= $2
      AND COALESCE(r.original_sale_date, r.created_at) <= $3
    ORDER BY r.created_at DESC
  `, [userId, startDate, endDate])).rows;
  for (const r of rows) {
    r.return_employees = (await query(
      `SELECT e.name FROM pos_transaction_employees te JOIN pos_employees e ON te.employee_id = e.id WHERE te.transaction_id = $1`, [r.id]
    )).rows.map(x => x.name);
    r.sale_employees = r.original_receipt ? (await query(
      `SELECT e.name FROM pos_transaction_employees te
       JOIN pos_employees e ON te.employee_id = e.id
       JOIN pos_transactions orig ON te.transaction_id = orig.id
       WHERE orig.receipt_number = $1 AND orig.user_id = $2`, [r.original_receipt, userId]
    )).rows.map(x => x.name) : [];
  }
  return rows;
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
  const allowed = ['store_name', 'store_address', 'receipt_footer', 'timezone', 'tax_rate', 'theme', 'brands'];
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
  await query(
    `INSERT INTO pos_commission_plans (employee_id, plan_type, base_rate, tier_rate, tier_threshold, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [employeeId, plan.plan_type, plan.base_rate, plan.tier_rate || 0, plan.tier_threshold || 0, userId]
  );
  // Delete old and insert fresh (simpler than upsert on employee_id)
  await query('DELETE FROM pos_commission_plans WHERE employee_id = $1', [employeeId]);
  await query(
    `INSERT INTO pos_commission_plans (employee_id, plan_type, base_rate, tier_rate, tier_threshold, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [employeeId, plan.plan_type, plan.base_rate, plan.tier_rate || 0, plan.tier_threshold || 0, userId]
  );
}

async function getAllCommissionPlans(userId) {
  return (await query('SELECT * FROM pos_commission_plans WHERE user_id = $1', [userId])).rows;
}

// Calculate actual commission for an employee over a date range,
// respecting daily threshold tiers
async function calculateEmployeeCommission(employeeId, userId, startDate, endDate) {
  const plan = await getCommissionPlan(employeeId);

  // Get all transactions this employee was on
  const txResult = await query(`
    SELECT t.id, t.type, t.total, t.created_at, te.commission_value, te.commission_amount
    FROM pos_transactions t
    JOIN pos_transaction_employees te ON t.id = te.transaction_id
    WHERE te.employee_id = $1 AND t.user_id = $2
      AND COALESCE(t.original_sale_date, t.created_at) >= $3
      AND COALESCE(t.original_sale_date, t.created_at) <= $4
  `, [employeeId, userId, startDate, endDate]);

  if (!plan || plan.plan_type === 'flat') {
    // Simple: sum up commission_amount as recorded
    let salesTotal = 0, returnsTotal = 0, saleCount = 0, returnCount = 0;
    for (const tx of txResult.rows) {
      if (tx.type === 'sale') { salesTotal += tx.commission_amount; saleCount++; }
      else { returnsTotal += tx.commission_amount; returnCount++; }
    }
    return { sale_count: saleCount, return_count: returnCount, sales_total: salesTotal, returns_total: returnsTotal, net_total: salesTotal - returnsTotal };
  }

  if (plan.plan_type === 'daily_threshold') {
    // Group transactions by calendar day
    const byDay = {};
    for (const tx of txResult.rows) {
      const day = new Date(tx.created_at).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(tx);
    }

    let salesTotal = 0, returnsTotal = 0, saleCount = 0, returnCount = 0;
    for (const [, dayTxs] of Object.entries(byDay)) {
      // Calculate day's net credited sales (using the % of sale assigned to this employee)
      const dayNetSales = dayTxs.reduce((sum, tx) => {
        const empShare = tx.total * (tx.commission_value / 100);
        return sum + (tx.type === 'sale' ? empShare : -empShare);
      }, 0);

      const rate = dayNetSales > plan.tier_threshold ? plan.tier_rate : plan.base_rate;

      for (const tx of dayTxs) {
        const empShare = tx.total * (tx.commission_value / 100);
        const commission = empShare * (rate / 100);
        if (tx.type === 'sale') { salesTotal += commission; saleCount++; }
        else { returnsTotal += commission; returnCount++; }
      }
    }
    return { sale_count: saleCount, return_count: returnCount, sales_total: salesTotal, returns_total: returnsTotal, net_total: salesTotal - returnsTotal };
  }

  return { sale_count: 0, return_count: 0, sales_total: 0, returns_total: 0, net_total: 0 };
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
  updateTransaction,
  deleteTransaction,
  // Reports
  getSalesReport,
  getEmployeeSalesReport,
  getTopProductsReport,
  getCustomerReport,
  getFlaggedReturns,
  // Settings
  getSettings,
  updateSettings,
  // Commission Plans
  getCommissionPlan,
  setCommissionPlan,
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
