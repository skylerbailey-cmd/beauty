'use strict';

const { db } = require('./index');
const fs = require('fs');
const path = require('path');

// Initialize POS schema
const posSchema = fs.readFileSync(path.join(__dirname, 'pos-schema.sql'), 'utf8');
db.exec(posSchema);

// Migrations
try { db.exec("ALTER TABLE pos_transactions ADD COLUMN original_sale_date DATETIME"); } catch (_) { /* already exists */ }

// ─── Employees ──────────────────────────────────────────────────────────────

function getEmployees(userId) {
  return db.prepare('SELECT * FROM pos_employees WHERE user_id = ? ORDER BY name').all(userId);
}

function getEmployee(id) {
  return db.prepare('SELECT * FROM pos_employees WHERE id = ?').get(id);
}

function createEmployee(name, pin, role, userId) {
  const result = db.prepare(
    'INSERT INTO pos_employees (name, pin, role, user_id) VALUES (?, ?, ?, ?)'
  ).run(name, pin, role || 'sales', userId);
  return getEmployee(result.lastInsertRowid);
}

function updateEmployee(id, fields) {
  const allowed = ['name', 'pin', 'role', 'active'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE pos_employees SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function verifyEmployeePin(pin, userId) {
  return db.prepare('SELECT * FROM pos_employees WHERE pin = ? AND user_id = ? AND active = 1').get(pin, userId);
}

// ─── Clock Entries ──────────────────────────────────────────────────────────

function clockIn(employeeId, userId) {
  // Check if already clocked in
  const open = db.prepare(
    'SELECT * FROM pos_clock_entries WHERE employee_id = ? AND clock_out IS NULL'
  ).get(employeeId);
  if (open) return open;
  const result = db.prepare(
    'INSERT INTO pos_clock_entries (employee_id, clock_in, user_id) VALUES (?, datetime(\'now\'), ?)'
  ).run(employeeId, userId);
  return db.prepare('SELECT * FROM pos_clock_entries WHERE id = ?').get(result.lastInsertRowid);
}

function clockOut(employeeId) {
  db.prepare(
    'UPDATE pos_clock_entries SET clock_out = datetime(\'now\') WHERE employee_id = ? AND clock_out IS NULL'
  ).run(employeeId);
}

function getOpenClockEntry(employeeId) {
  return db.prepare(
    'SELECT * FROM pos_clock_entries WHERE employee_id = ? AND clock_out IS NULL'
  ).get(employeeId);
}

function getClockEntries(userId, startDate, endDate) {
  return db.prepare(`
    SELECT ce.*, e.name as employee_name
    FROM pos_clock_entries ce
    JOIN pos_employees e ON ce.employee_id = e.id
    WHERE ce.user_id = ?
      AND ce.clock_in >= ? AND ce.clock_in <= ?
    ORDER BY ce.clock_in DESC
  `).all(userId, startDate, endDate);
}

// ─── Product Prices ─────────────────────────────────────────────────────────

function getProductPrices(userId) {
  return db.prepare('SELECT * FROM pos_product_prices WHERE user_id = ?').all(userId);
}

function setProductPrice(productId, price, cost, userId) {
  db.prepare(`
    INSERT INTO pos_product_prices (product_id, price, cost, user_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, user_id) DO UPDATE SET price = excluded.price, cost = excluded.cost
  `).run(productId, price, cost || 0, userId);
}

function getProductPrice(productId, userId) {
  return db.prepare('SELECT * FROM pos_product_prices WHERE product_id = ? AND user_id = ?').get(productId, userId);
}

// ─── Transactions ───────────────────────────────────────────────────────────

function generateReceiptNumber() {
  // Simple incrementing receipt number per store
  const last = db.prepare('SELECT MAX(CAST(receipt_number AS INTEGER)) as num FROM pos_transactions WHERE receipt_number GLOB \'[0-9]*\'').get();
  const next = (last?.num || 1000) + 1;
  return String(next);
}

function createTransaction(txData) {
  const receiptNumber = generateReceiptNumber();
  const result = db.prepare(`
    INSERT INTO pos_transactions
      (type, employee_id, customer_id, customer_name, customer_email,
       subtotal, tax_rate, tax_amount, discount_amount, total,
       payment_method, notes, receipt_number, original_transaction_id, original_sale_date, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txData.type || 'sale',
    txData.employee_id || null,
    txData.customer_id || null,
    txData.customer_name || '',
    txData.customer_email || '',
    txData.subtotal,
    txData.tax_rate ?? 0.0875,
    txData.tax_amount,
    txData.discount_amount || 0,
    txData.total,
    txData.payment_method || 'card',
    txData.notes || '',
    receiptNumber,
    txData.original_transaction_id || null,
    txData.original_sale_date || null,
    txData.user_id
  );
  return { id: result.lastInsertRowid, receipt_number: receiptNumber };
}

function addTransactionItems(transactionId, items) {
  const stmt = db.prepare(`
    INSERT INTO pos_transaction_items
      (transaction_id, product_id, product_name, brand, quantity, unit_price, discount, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    stmt.run(
      transactionId,
      item.product_id,
      item.product_name,
      item.brand || '',
      item.quantity || 1,
      item.unit_price,
      item.discount || 0,
      item.line_total
    );
  }
}

function getTransaction(id) {
  const tx = db.prepare('SELECT * FROM pos_transactions WHERE id = ?').get(id);
  if (!tx) return null;
  tx.items = db.prepare('SELECT * FROM pos_transaction_items WHERE transaction_id = ?').all(id);
  return tx;
}

function getTransactionByReceipt(receiptNumber, userId) {
  const tx = db.prepare('SELECT * FROM pos_transactions WHERE receipt_number = ? AND user_id = ?').get(receiptNumber, userId);
  if (!tx) return null;
  tx.items = db.prepare('SELECT * FROM pos_transaction_items WHERE transaction_id = ?').all(tx.id);
  return tx;
}

function getTransactions(userId, opts = {}) {
  const { type, startDate, endDate, employeeId, limit = 100 } = opts;
  let where = 'WHERE t.user_id = ?';
  const params = [userId];

  if (type) { where += ' AND t.type = ?'; params.push(type); }
  if (startDate) { where += ' AND t.created_at >= ?'; params.push(startDate); }
  if (endDate) { where += ' AND t.created_at <= ?'; params.push(endDate); }
  if (employeeId) { where += ' AND t.employee_id = ?'; params.push(employeeId); }
  params.push(limit);

  const transactions = db.prepare(`
    SELECT t.*, e.name as employee_name
    FROM pos_transactions t
    LEFT JOIN pos_employees e ON t.employee_id = e.id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(...params);

  const itemStmt = db.prepare('SELECT * FROM pos_transaction_items WHERE transaction_id = ?');
  return transactions.map(tx => ({ ...tx, items: itemStmt.all(tx.id) }));
}

// ─── Reports ────────────────────────────────────────────────────────────────

function getSalesReport(userId, startDate, endDate) {
  // Returns are attributed to the original sale date, not the return date
  const summary = db.prepare(`
    SELECT
      COUNT(CASE WHEN type = 'sale' THEN 1 END) as total_sales,
      COUNT(CASE WHEN type = 'return' THEN 1 END) as total_returns,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE 0 END), 0) as sales_revenue,
      COALESCE(SUM(CASE WHEN type = 'return' THEN total ELSE 0 END), 0) as returns_total,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE -total END), 0) as net_revenue,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN tax_amount ELSE -tax_amount END), 0) as net_tax
    FROM pos_transactions
    WHERE user_id = ?
      AND COALESCE(original_sale_date, created_at) >= ?
      AND COALESCE(original_sale_date, created_at) <= ?
  `).get(userId, startDate, endDate);

  return summary;
}

function getEmployeeSalesReport(userId, startDate, endDate) {
  // Returns attributed to original sale date for commission accuracy
  return db.prepare(`
    SELECT
      e.id as employee_id,
      e.name as employee_name,
      COUNT(CASE WHEN t.type = 'sale' THEN 1 END) as sale_count,
      COUNT(CASE WHEN t.type = 'return' THEN 1 END) as return_count,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.total ELSE 0 END), 0) as sales_total,
      COALESCE(SUM(CASE WHEN t.type = 'return' THEN t.total ELSE 0 END), 0) as returns_total,
      COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.total ELSE -t.total END), 0) as net_total
    FROM pos_employees e
    LEFT JOIN pos_transactions t ON e.id = t.employee_id
      AND t.user_id = ?
      AND COALESCE(t.original_sale_date, t.created_at) >= ?
      AND COALESCE(t.original_sale_date, t.created_at) <= ?
    WHERE e.user_id = ?
    GROUP BY e.id
    ORDER BY net_total DESC
  `).all(userId, startDate, endDate, userId);
}

function getTopProductsReport(userId, startDate, endDate) {
  return db.prepare(`
    SELECT
      ti.product_id,
      ti.product_name,
      ti.brand,
      SUM(CASE WHEN t.type = 'sale' THEN ti.quantity ELSE -ti.quantity END) as units_sold,
      SUM(CASE WHEN t.type = 'sale' THEN ti.line_total ELSE -ti.line_total END) as revenue
    FROM pos_transaction_items ti
    JOIN pos_transactions t ON ti.transaction_id = t.id
    WHERE t.user_id = ?
      AND COALESCE(t.original_sale_date, t.created_at) >= ?
      AND COALESCE(t.original_sale_date, t.created_at) <= ?
    GROUP BY ti.product_id
    ORDER BY revenue DESC
  `).all(userId, startDate, endDate);
}

function getCustomerReport(userId, startDate, endDate) {
  return db.prepare(`
    SELECT
      customer_name,
      customer_email,
      COUNT(CASE WHEN type = 'sale' THEN 1 END) as purchases,
      COUNT(CASE WHEN type = 'return' THEN 1 END) as returns,
      COALESCE(SUM(CASE WHEN type = 'sale' THEN total ELSE -total END), 0) as total_spent
    FROM pos_transactions
    WHERE user_id = ?
      AND COALESCE(original_sale_date, created_at) >= ?
      AND COALESCE(original_sale_date, created_at) <= ?
      AND customer_name != ''
    GROUP BY customer_email
    ORDER BY total_spent DESC
  `).all(userId, startDate, endDate);
}

// ─── Settings ───────────────────────────────────────────────────────────────

function getSettings(userId) {
  let settings = db.prepare('SELECT * FROM pos_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare('INSERT INTO pos_settings (user_id) VALUES (?)').run(userId);
    settings = db.prepare('SELECT * FROM pos_settings WHERE user_id = ?').get(userId);
  }
  return settings;
}

function updateSettings(userId, fields) {
  const allowed = ['store_name', 'receipt_footer', 'timezone'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return;
  params.push(userId);
  // Ensure row exists
  db.prepare('INSERT OR IGNORE INTO pos_settings (user_id) VALUES (?)').run(userId);
  db.prepare(`UPDATE pos_settings SET ${sets.join(', ')} WHERE user_id = ?`).run(...params);
}

module.exports = {
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  verifyEmployeePin,
  clockIn,
  clockOut,
  getOpenClockEntry,
  getClockEntries,
  getProductPrices,
  setProductPrice,
  getProductPrice,
  createTransaction,
  addTransactionItems,
  getTransaction,
  getTransactionByReceipt,
  getTransactions,
  getSalesReport,
  getEmployeeSalesReport,
  getTopProductsReport,
  getCustomerReport,
  getSettings,
  updateSettings,
};
