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
  if (status) {
    return db.prepare(`
      SELECT * FROM emails
      WHERE user_id = ? AND status = ?
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, status, limit, offset);
  }
  return db.prepare(`
    SELECT * FROM emails
    WHERE user_id = ?
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
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

function findOrCreateUserByEmail(email) {
  let user = getUserByEmail(email);
  if (!user) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.prepare(`
      INSERT INTO users (id, email) VALUES (?, ?)
    `).run(id, email);
    user = getUser(id);
  }
  return user;
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
  saveWelcomeEmail,
  getWelcomeEmails,
};
