'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/emails');
const webhookRoutes = require('./routes/webhook');
const { router: welcomeRoutes } = require('./routes/welcome');
const posRoutes = require('./routes/pos');
const bookingRoutes = require('./routes/booking');
const { initSchema: initPostgres } = require('./db/postgres');
const { hardenRouter } = require('./lib/safe-async');
const { getAllUsers } = require('./db');
const { setupGmailWatch } = require('./services/gmail');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'skysale-dev-secret-change-in-prod';

app.use(cookieParser(SESSION_SECRET)); // signed cookies use the same secret

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// ─── Persistent auth: restore session from signed cookie after redeploy ───────
// The session store is in-memory and SQLite is ephemeral on Railway,
// so we store the user's email in a long-lived signed cookie.
// On each request, if the session is gone but the cookie exists,
// we recreate the user and restore the session automatically.

app.use(async (req, res, next) => {
  // Skip if already authenticated
  if (req.session?.userId) return next();

  const savedEmail = req.signedCookies?.glow_user_email;
  const savedCompany = req.signedCookies?.glow_company_name;
  const savedTheme = req.signedCookies?.glow_theme;
  const savedBrands = req.signedCookies?.glow_brands;
  const savedWebsites = req.signedCookies?.glow_websites;
  if (savedEmail) {
    const { findOrCreateUserByEmail, updateUserTokens, updateUserTheme, updateUserBrands, updateUserWebsites } = require('./db');
    try {
      const { user } = findOrCreateUserByEmail(savedEmail, savedCompany || null);
      // Restore THIS company's own Gmail token from Postgres (per-company,
      // never from a shared cookie — that used to bleed tokens across companies)
      if (!user.refresh_token) {
        try {
          const { getGmailToken } = require('./db/postgres');
          const rt = await getGmailToken(user.id);
          if (rt) updateUserTokens(user.id, null, rt);
        } catch (_) {}
      }
      // Restore settings from cookies if DB has defaults but cookies have real values
      if (savedTheme && savedTheme !== 'rose' && (!user.theme || user.theme === 'rose')) {
        updateUserTheme(user.id, savedTheme);
      }
      // "Looks like a never-customized row" — both the original 3-brand
      // default and the current 5-brand default (added when spacetouch/
      // lumieres launched) count, so a DB wipe doesn't strand a user back on
      // whichever default happens to be current at the time.
      const DEFAULT_BRANDS_JSON = ['["avologi","avinichi","hydrasphere"]', '["avologi","avinichi","hydrasphere","spacetouch","lumieres"]'];
      if (savedBrands && (!user.brands || DEFAULT_BRANDS_JSON.includes(user.brands))) {
        try { updateUserBrands(user.id, JSON.parse(savedBrands)); } catch (_) {}
      }
      if (savedWebsites && (!user.websites || user.websites === '[]')) {
        try { updateUserWebsites(user.id, JSON.parse(savedWebsites)); } catch (_) {}
      }
      req.session.userId = user.id;
    } catch (e) {
      // Cookie is stale or DB issue — ignore, user will need to log in again
    }
  }
  next();
});

// ─── Routes ────────────────────────────────────────────────────────────────────

// Serve the welcome email generator web UI
// In Docker: /app/web; in local dev: ../../web
const webDir = path.join(__dirname, '../web');
const webDirAlt = path.join(__dirname, '../../web');
const fs = require('fs');
app.use(express.static(fs.existsSync(webDir) ? webDir : webDirAlt, {
  etag: true,
  setHeaders: (res, filePath) => {
    // Never cache HTML, so redeploys take effect immediately (incl. the
    // embedded Emails iframe) without a hard refresh.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// hardenRouter: a rejected promise inside an async handler must come back as a
// 500, not end the process. See lib/safe-async.js.
app.use('/auth', hardenRouter(authRoutes));
app.use('/api/emails', hardenRouter(emailRoutes));
app.use('/api/welcome', hardenRouter(welcomeRoutes));
app.use('/api/pos', hardenRouter(posRoutes));
// Public — the customer's reschedule/cancel page, reached from a link in their
// confirmation email. Mounted outside /api/pos precisely because everything
// under there requires a signed-in session.
app.use('/api/booking', hardenRouter(bookingRoutes));
app.use('/webhook', hardenRouter(webhookRoutes));

// Health check
app.get('/health', async (req, res) => {
  let pgStatus = 'not configured';
  try {
    const { pool } = require('./db/postgres');
    if (pool) {
      await pool.query('SELECT 1');
      pgStatus = 'connected';
    }
  } catch (err) { pgStatus = 'error: ' + err.message; }
  res.json({ status: 'ok', app: 'SkySale Backend', postgres: pgStatus, timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ─── Never exit on a stray rejection ─────────────────────────────────────────
//
// The routers above hand request-time rejections to the error handler. This
// catches the rest — a timer, the keep-alive ping, a background restore —
// which Node would otherwise end the process over. A POS that disappears
// mid-sale is worse than one carrying a logged fault.

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection (kept running):', reason?.stack || reason);
});

// ─── Startup: restore Gmail watches ───────────────────────────────────────────

async function restoreGmailWatches() {
  const users = getAllUsers();
  console.log(`[startup] Restoring Gmail watches for ${users.length} user(s)...`);

  for (const user of users) {
    try {
      await setupGmailWatch(user.id);
      console.log(`[startup] Gmail watch restored for ${user.email}`);
    } catch (err) {
      // Don't crash on startup — token may need re-auth
      console.error(`[startup] Failed to restore watch for ${user.email}:`, err.message);
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`[server] SkySale backend running on port ${PORT}`);

  // Initialize Postgres schema for POS/CRM
  try {
    await initPostgres();
  } catch (err) {
    console.error('[startup] Postgres init error:', err.message);
  }

  // Restore watches after server is ready
  try {
    await restoreGmailWatches();
  } catch (err) {
    console.error('[startup] Error during watch restoration:', err.message);
  }

  // Keep-alive: ping own public URL every 5 minutes to prevent Railway from sleeping
  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (publicDomain) {
    const keepAliveUrl = `https://${publicDomain}/health`;
    setInterval(() => {
      fetch(keepAliveUrl).catch(() => {});
    }, 5 * 60 * 1000);
    console.log(`[keep-alive] Pinging ${keepAliveUrl} every 5 minutes`);
  }
});

module.exports = app;
