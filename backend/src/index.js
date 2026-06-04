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
const { getAllUsers } = require('./db');
const { setupGmailWatch } = require('./services/gmail');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(cookieParser());

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'glow-sf-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// ─── Routes ────────────────────────────────────────────────────────────────────

// Serve the welcome email generator web UI
// In Docker: /app/web; in local dev: ../../web
const webDir = path.join(__dirname, '../web');
const webDirAlt = path.join(__dirname, '../../web');
const fs = require('fs');
app.use(express.static(fs.existsSync(webDir) ? webDir : webDirAlt));

app.use('/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/welcome', welcomeRoutes);
app.use('/webhook', webhookRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'Glow SF Backend', timestamp: new Date().toISOString() });
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
  console.log(`[server] Glow SF backend running on port ${PORT}`);

  // Restore watches after server is ready
  try {
    await restoreGmailWatches();
  } catch (err) {
    console.error('[startup] Error during watch restoration:', err.message);
  }
});

module.exports = app;
