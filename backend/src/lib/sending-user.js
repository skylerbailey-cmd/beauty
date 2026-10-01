'use strict';

// The Gmail account a shop sends from — for audit and sale alerts, receipts,
// welcome emails and mass email.
//
// The connection is kept in Postgres (pos_gmail_tokens) precisely because the
// SQLite copy does not survive a redeploy. But the lookup used to start from
// SQLite's user row and only fell back to Postgres when that row existed with
// its token missing; when the whole row was gone — after any redeploy, until
// someone from the shop signed in again — it answered "no Gmail connected",
// and the morning's audit alert, the sale texts and every receipt email were
// quietly not sent. Now Postgres alone is enough.

const pgDb = require('../db/postgres');

async function sendingUser(userId) {
  if (!userId) return null;
  let user = null;
  try { user = require('../db').getUser(userId) || null; } catch (_) {}
  let account = null;
  try { account = await pgDb.getGmailAccount(userId); } catch (_) {}

  if (user) {
    // Postgres's token wins when the two differ: it is the one a reconnect
    // updates and a redeploy keeps, where SQLite's may be an old one.
    if (account?.refresh_token && user.refresh_token !== account.refresh_token) {
      try { require('../db').updateUserTokens(userId, null, account.refresh_token); } catch (_) {}
      user.refresh_token = account.refresh_token;
    } else if (user.refresh_token && !account?.refresh_token) {
      // Keep Postgres's copy, so the next redeploy cannot lose it.
      try { await pgDb.saveGmailToken(userId, user.refresh_token, user.email); } catch (_) {}
    }
    if (!user.email && account?.email) user.email = account.email;
    return user;
  }

  if (!account?.refresh_token) return null;
  const settings = await pgDb.getSettings(userId).catch(() => null);
  return {
    id: userId,
    email: account.email || '',
    refresh_token: account.refresh_token,
    company_name: settings?.store_name || '',
  };
}

module.exports = { sendingUser };
