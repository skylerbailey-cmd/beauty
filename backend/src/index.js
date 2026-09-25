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
const signupRoutes = require('./routes/signup');
const { initSchema: initPostgres } = require('./db/postgres');
const { hardenRouter } = require('./lib/safe-async');
const { tenantMiddleware, cookieDomainFor } = require('./lib/tenancy');
const { getAllUsers } = require('./db');
const { setupGmailWatch } = require('./services/gmail');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Railway's proxy. Without this, every request looks like it came from
// the proxy — which would make the rate limiter treat the whole internet as
// one client, and secure cookies think the connection was plain HTTP.
app.set('trust proxy', 1);

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

// ─── One session across the shop addresses ───────────────────────────────────
// Set per request rather than in the session config: on the Railway hostname
// there is no app domain to scope to, and a cookie pinned to the wrong domain
// is a cookie the browser throws away.

app.use((req, res, next) => {
  const domain = cookieDomainFor(req);
  if (domain && req.session?.cookie) req.session.cookie.domain = domain;
  next();
});

// Which shop this address names, and a stop on reading one shop's data from
// another's address. Before the routes, after the session.
app.use(tenantMiddleware());

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

// The front door.
//
// This used to serve the welcome email generator, which had its own sign-in
// and its own idea of who you were. So the address a shop was given led to a
// page that was never the way into the register, and typing an email into it
// appeared to work. There is one way in now: signed in goes to the register,
// and everyone else goes to the one screen that can actually sign you in.
app.get('/', (req, res) => {
  res.redirect(req.session?.userId ? '/pos.html' : '/signup.html');
});

// Anything still asking for the old standalone pages by name.
app.get(['/index.html', '/inbox.html'], (req, res) => res.redirect('/pos.html#emails'));

// Serve the web UI.
// In Docker: /app/web; in local dev: ../../web
const webDir = path.join(__dirname, '../web');
const webDirAlt = path.join(__dirname, '../../web');
const fs = require('fs');
app.use(express.static(fs.existsSync(webDir) ? webDir : webDirAlt, {
  etag: true,
  // No directory index: "/" is answered above, deliberately, and a stray
  // index.html appearing in the web folder must never quietly take it back.
  index: false,
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
// Signing in with any email address, by one-time link. Mounted before the
// Google routes so /auth/link is reached whether or not Google is configured.
app.use('/auth', hardenRouter(require('./routes/login')));
app.use('/auth', hardenRouter(authRoutes));
app.use('/api/emails', hardenRouter(emailRoutes));
app.use('/api/welcome', hardenRouter(welcomeRoutes));
app.use('/api/pos', hardenRouter(posRoutes));
// Public — the customer's reschedule/cancel page, reached from a link in their
// confirmation email. Mounted outside /api/pos precisely because everything
// under there requires a signed-in session.
app.use('/api/booking', hardenRouter(bookingRoutes));
// Opening an account. Public by necessity, so every endpoint under it is rate
// limited and every account is created from a proven email address — either a
// completed Google sign-in or a one-time link the shop clicked in its inbox.
app.use('/api/signup', hardenRouter(signupRoutes));
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

  // Whether sign-in links can actually be sent. Reduced to one word on
  // purpose: this endpoint is public, and the underlying error names the
  // account we send from. Without it, a broken app password is only
  // discovered by a shop that cannot get in and has no way to say so.
  let mailStatus = 'not configured';
  try {
    const { verifyMailer } = require('./services/mailer');
    const r = await verifyMailer();
    mailStatus = r.ok ? 'ok' : (r.reason && /not set/.test(r.reason) ? 'not configured' : 'error');
    // The one word above is all the public gets; the reason belongs in the
    // logs, which is the only place anyone can act on it.
    if (!r.ok) console.warn('[mail] Not able to send:', r.reason);
  } catch (e) { mailStatus = 'error'; console.warn('[mail] Check failed:', e.message); }

  res.json({
    status: 'ok',
    app: 'SkySale Backend',
    postgres: pgStatus,
    mail: mailStatus,
    timestamp: new Date().toISOString(),
  });
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
    // Every named shop gets its own address on the app domain, assigned once.
    await require('./db/postgres').ensureCompanySlugs();
  } catch (err) {
    console.error('[startup] Postgres init error:', err.message);
  }

  const emailLoginOpen = process.env.LEGACY_EMAIL_LOGIN === '1'
    || (process.env.LEGACY_EMAIL_LOGIN !== '0' && !process.env.APP_DOMAIN);
  if (emailLoginOpen) {
    console.warn('[server] Email-only sign-in is OPEN: an email address alone signs a company in. Set LEGACY_EMAIL_LOGIN=0 once Google sign-in is confirmed.');
  } else {
    console.log('[server] Email-only sign-in is closed; Google sign-in only.');
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
