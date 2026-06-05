'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || './data/glow.db';

// Ensure data directory exists
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrations — add columns that may not exist in older DBs
try { db.exec('ALTER TABLE users ADD COLUMN company_name TEXT'); } catch (_) { /* already exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'rose'"); } catch (_) { /* already exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN websites TEXT DEFAULT '[]'"); } catch (_) { /* already exists */ }

// ─── Users ────────────────────────────────────────────────────────────────────

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users').all();
}

function saveUser({ id, email, access_token, refresh_token, push_token, gmail_history_id }) {
  db.prepare(`
    INSERT INTO users (id, email, access_token, refresh_token, push_token, gmail_history_id)
    VALUES (@id, @email, @access_token, @refresh_token, @push_token, @gmail_history_id)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, users.refresh_token),
      push_token = COALESCE(excluded.push_token, users.push_token),
      gmail_history_id = COALESCE(excluded.gmail_history_id, users.gmail_history_id)
  `).run({ id, email, access_token, refresh_token, push_token: push_token || null, gmail_history_id: gmail_history_id || null });
  return getUser(id);
}

function updateUserTokens(userId, access_token, refresh_token) {
  db.prepare(`
    UPDATE users SET
      access_token = ?,
      refresh_token = COALESCE(?, refresh_token)
    WHERE id = ?
  `).run(access_token, refresh_token || null, userId);
}

function updateUserHistoryId(userId, historyId) {
  db.prepare('UPDATE users SET gmail_history_id = ? WHERE id = ?').run(historyId, userId);
}

function updateUserPushToken(userId, pushToken) {
  db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(pushToken, userId);
}

// ─── Emails ───────────────────────────────────────────────────────────────────

function getEmails(userId, status = null, limit = 50, offset = 0) {
  // Deduplicate by thread — only return one email per thread (the one with the latest rowid)
  if (status) {
    return db.prepare(`
      SELECT * FROM emails
      WHERE user_id = ? AND status = ?
        AND rowid IN (
          SELECT MAX(rowid) FROM emails
          WHERE user_id = ? AND status = ?
          GROUP BY gmail_thread_id
        )
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, status, userId, status, limit, offset);
  }
  return db.prepare(`
    SELECT * FROM emails
    WHERE user_id = ?
      AND rowid IN (
        SELECT MAX(rowid) FROM emails
        WHERE user_id = ?
        GROUP BY gmail_thread_id
      )
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, limit, offset);
}

function getEmail(id) {
  return db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
}

function getEmailByMessageId(gmailMessageId) {
  return db.prepare('SELECT * FROM emails WHERE gmail_message_id = ?').get(gmailMessageId);
}

function getEmailsByThreadId(userId, threadId) {
  return db.prepare(`
    SELECT * FROM emails
    WHERE user_id = ? AND gmail_thread_id = ?
    ORDER BY received_at ASC
  `).all(userId, threadId);
}

function saveEmail({
  id, user_id, gmail_thread_id, gmail_message_id,
  subject, from_email, from_name, snippet, body,
  received_at, status, draft_content, gmail_draft_id
}) {
  db.prepare(`
    INSERT INTO emails (
      id, user_id, gmail_thread_id, gmail_message_id,
      subject, from_email, from_name, snippet, body,
      received_at, status, draft_content, gmail_draft_id
    ) VALUES (
      @id, @user_id, @gmail_thread_id, @gmail_message_id,
      @subject, @from_email, @from_name, @snippet, @body,
      @received_at, @status, @draft_content, @gmail_draft_id
    )
    ON CONFLICT(id) DO UPDATE SET
      status = COALESCE(excluded.status, emails.status),
      draft_content = COALESCE(excluded.draft_content, emails.draft_content),
      gmail_draft_id = COALESCE(excluded.gmail_draft_id, emails.gmail_draft_id)
  `).run({
    id, user_id, gmail_thread_id, gmail_message_id,
    subject: subject || '(no subject)',
    from_email: from_email || '',
    from_name: from_name || '',
    snippet: snippet || '',
    body: body || '',
    received_at: received_at || new Date().toISOString(),
    status: status || 'pending',
    draft_content: draft_content || null,
    gmail_draft_id: gmail_draft_id || null
  });
  return getEmail(id);
}

function updateEmailStatus(id, status) {
  db.prepare('UPDATE emails SET status = ? WHERE id = ?').run(status, id);
}

function archiveEmail(id) {
  db.prepare("UPDATE emails SET status = 'archived' WHERE id = ?").run(id);
}

function saveEmailDraft(id, draftContent, gmailDraftId) {
  db.prepare(`
    UPDATE emails SET
      draft_content = ?,
      gmail_draft_id = ?,
      status = 'draft_ready'
    WHERE id = ?
  `).run(draftContent, gmailDraftId || null, id);
}

function updateDraftContent(id, draftContent) {
  db.prepare('UPDATE emails SET draft_content = ? WHERE id = ?').run(draftContent, id);
}

function markEmailSent(id) {
  db.prepare(`
    UPDATE emails SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(id);
}

function getFollowUpEmails(userId, hoursThreshold = 48) {
  return db.prepare(`
    SELECT * FROM emails
    WHERE user_id = ?
      AND status = 'sent'
      AND sent_at <= datetime('now', ? || ' hours')
      AND gmail_thread_id NOT IN (
        SELECT DISTINCT gmail_thread_id FROM emails
        WHERE user_id = ? AND received_at > sent_at AND status != 'sent'
      )
    ORDER BY sent_at ASC
  `).all(userId, `-${hoursThreshold}`, userId);
}

// ─── Welcome Emails ──────────────────────────────────────────────────────────

function saveWelcomeEmail({ customer_name, customer_email, products }) {
  const stmt = db.prepare(`
    INSERT INTO welcome_emails (customer_name, customer_email, products)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(customer_name, customer_email, JSON.stringify(products));
  return result.lastInsertRowid;
}

function getWelcomeEmails(limit = 50) {
  return db.prepare(`
    SELECT * FROM welcome_emails
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit);
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

function saveCampaign({ subject, body, recipient_count }) {
  const stmt = db.prepare(`
    INSERT INTO campaigns (subject, body, recipient_count)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(subject, body, recipient_count);
  return result.lastInsertRowid;
}

function getCampaigns(limit = 50) {
  return db.prepare(`
    SELECT * FROM campaigns
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit);
}

function getUniqueCustomerEmails() {
  return db.prepare(`
    SELECT DISTINCT customer_email FROM welcome_emails
    ORDER BY customer_email
  `).all().map(row => row.customer_email);
}

// ─── CRM: Customers ─────────────────────────────────────────────────────────

function findOrCreateCustomer(name, email) {
  let customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  if (customer) {
    // Update name if it changed
    if (name && name !== customer.name) {
      db.prepare('UPDATE customers SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, customer.id);
      customer.name = name;
    }
    return customer;
  }
  const result = db.prepare('INSERT INTO customers (name, email) VALUES (?, ?)').run(name || '', email);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
}

function addCustomerProducts(customerId, products) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO customer_products (customer_id, product_id, product_name)
    VALUES (?, ?, ?)
  `);
  for (const p of products) {
    stmt.run(customerId, p.id, p.name);
  }
}

function getCustomers() {
  const customers = db.prepare('SELECT * FROM customers ORDER BY updated_at DESC').all();
  const productStmt = db.prepare('SELECT * FROM customer_products WHERE customer_id = ? ORDER BY purchased_at DESC');
  return customers.map(c => ({
    ...c,
    products: productStmt.all(c.id),
  }));
}

function getCustomersByProduct(productId) {
  const rows = db.prepare(`
    SELECT DISTINCT c.* FROM customers c
    JOIN customer_products cp ON c.id = cp.customer_id
    WHERE cp.product_id = ?
    ORDER BY c.updated_at DESC
  `).all(productId);
  const productStmt = db.prepare('SELECT * FROM customer_products WHERE customer_id = ? ORDER BY purchased_at DESC');
  return rows.map(c => ({
    ...c,
    products: productStmt.all(c.id),
  }));
}

function getCustomer(id) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) return null;
  customer.products = db.prepare('SELECT * FROM customer_products WHERE customer_id = ? ORDER BY purchased_at DESC').all(id);
  return customer;
}

function updateCustomerNotes(id, notes) {
  db.prepare('UPDATE customers SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(notes, id);
}

function findOrCreateUserByEmail(email, companyName) {
  let user = getUserByEmail(email);
  let isNew = false;
  if (!user) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.prepare(`
      INSERT INTO users (id, email, company_name) VALUES (?, ?, ?)
    `).run(id, email, companyName || null);
    user = getUser(id);
    isNew = true;
  }
  return { user, isNew };
}

function updateCompanyName(userId, companyName) {
  db.prepare('UPDATE users SET company_name = ? WHERE id = ?').run(companyName, userId);
}

function updateUserTheme(userId, theme) {
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, userId);
}

function updateUserWebsites(userId, websites) {
  db.prepare('UPDATE users SET websites = ? WHERE id = ?').run(JSON.stringify(websites), userId);
}

module.exports = {
  db,
  getUser,
  getUserByEmail,
  getAllUsers,
  saveUser,
  updateUserTokens,
  updateUserHistoryId,
  updateUserPushToken,
  getEmails,
  getEmail,
  getEmailByMessageId,
  getEmailsByThreadId,
  saveEmail,
  updateEmailStatus,
  archiveEmail,
  saveEmailDraft,
  updateDraftContent,
  markEmailSent,
  getFollowUpEmails,
  findOrCreateUserByEmail,
  updateCompanyName,
  updateUserTheme,
  updateUserWebsites,
  saveWelcomeEmail,
  getWelcomeEmails,
  saveCampaign,
  getCampaigns,
  getUniqueCustomerEmails,
  findOrCreateCustomer,
  addCustomerProducts,
  getCustomers,
  getCustomersByProduct,
  getCustomer,
  updateCustomerNotes,
};
