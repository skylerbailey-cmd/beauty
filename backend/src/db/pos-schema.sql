-- POS Employees
CREATE TABLE IF NOT EXISTS pos_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  role TEXT DEFAULT 'sales',
  user_id TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_employees_user_id ON pos_employees(user_id);

-- Clock-in / Clock-out
CREATE TABLE IF NOT EXISTS pos_clock_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  clock_in DATETIME NOT NULL,
  clock_out DATETIME,
  user_id TEXT DEFAULT '',
  FOREIGN KEY (employee_id) REFERENCES pos_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_pos_clock_employee ON pos_clock_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_pos_clock_user ON pos_clock_entries(user_id);

-- Product prices (overlay on the existing PRODUCTS catalog)
CREATE TABLE IF NOT EXISTS pos_product_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  cost REAL DEFAULT 0,
  user_id TEXT DEFAULT '',
  UNIQUE(product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_prices_user ON pos_product_prices(user_id);

-- Transactions (sales & returns)
CREATE TABLE IF NOT EXISTS pos_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'sale',
  employee_id INTEGER,
  customer_id INTEGER,
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0.0875,
  tax_amount REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'card',
  notes TEXT DEFAULT '',
  receipt_number TEXT NOT NULL,
  original_transaction_id INTEGER,
  original_sale_date DATETIME,
  user_id TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES pos_employees(id),
  FOREIGN KEY (original_transaction_id) REFERENCES pos_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_pos_tx_user ON pos_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_pos_tx_employee ON pos_transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_pos_tx_receipt ON pos_transactions(receipt_number);
CREATE INDEX IF NOT EXISTS idx_pos_tx_created ON pos_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_pos_tx_type ON pos_transactions(type);

-- Transaction line items
CREATE TABLE IF NOT EXISTS pos_transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_pos_items_tx ON pos_transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_pos_items_product ON pos_transaction_items(product_id);

-- POS store settings
CREATE TABLE IF NOT EXISTS pos_settings (
  user_id TEXT PRIMARY KEY,
  store_name TEXT DEFAULT '',
  receipt_footer TEXT DEFAULT 'Thank you for your purchase!',
  timezone TEXT DEFAULT 'America/Los_Angeles'
);
