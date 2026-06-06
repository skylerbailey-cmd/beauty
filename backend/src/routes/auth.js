'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createOAuthClient, setupGmailWatch } = require('../services/gmail');
const { db, saveUser, getUser, updateUserPushToken } = require('../db');

const router = express.Router();

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ─── POST /auth/web-login ─────────────────────────────────────────────────────
// Simple email-based login for the web UI (no password)

router.post('/web-login', (req, res) => {
  const { email, companyName } = req.body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const { findOrCreateUserByEmail, updateCompanyName } = require('../db');
  const { user, isNew } = findOrCreateUserByEmail(email.trim().toLowerCase(), companyName?.trim() || null);

  // Update company name if provided and user already existed without one
  if (companyName?.trim() && !user.company_name) {
    updateCompanyName(user.id, companyName.trim());
    user.company_name = companyName.trim();
  }

  req.session.userId = user.id;

  // Set long-lived signed cookies so login persists across Railway redeploys
  const cookieOpts = {
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    httpOnly: true,
    signed: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  };
  res.cookie('glow_user_email', user.email, cookieOpts);
  if (user.company_name) {
    res.cookie('glow_company_name', user.company_name, cookieOpts);
  }

  res.json({
    success: true,
    isNew,
    user: {
      id: user.id,
      email: user.email,
      companyName: user.company_name,
      theme: user.theme || 'rose',
      websites: JSON.parse(user.websites || '[]'),
      brands: JSON.parse(user.brands || '["avologi","avinichi","hydrasphere"]'),
      hasGmail: !!user.refresh_token,
    },
  });
});

// ─── GET /auth/google ──────────────────────────────────────────────────────────
// Redirect user to Google OAuth consent screen

router.get('/google', (req, res) => {
  const from = req.query.from;
  if (from === 'web') {
    req.session.oauthFrom = 'web';
  }

  const oauth2Client = createOAuthClient();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: OAUTH_SCOPES,
    prompt: 'consent',
    include_granted_scopes: true,
  });

  res.redirect(authUrl);
});

// ─── GET /auth/google/callback ─────────────────────────────────────────────────
// Handle OAuth callback, save tokens, set up Gmail watch

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[auth] OAuth error:', error);
    return res.redirect(`${process.env.FRONTEND_DEEP_LINK || 'glowsf://'}auth-error?reason=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_DEEP_LINK || 'glowsf://'}auth-error?reason=no_code`);
  }

  try {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user profile
    const { google } = require('googleapis');
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const profileRes = await oauth2.userinfo.get();
    const profile = profileRes.data;

    const isWebLogin = req.session?.oauthFrom === 'web';
    const sessionUserId = req.session?.userId;

    // If coming from web login, update the existing user row with Gmail tokens
    // Otherwise, create/update based on Google profile ID (mobile flow)
    let userId;
    if (isWebLogin && sessionUserId) {
      // Update existing user's tokens and email
      const { updateUserTokens, getUserByEmail } = require('../db');
      const existingUser = getUser(sessionUserId);
      if (existingUser) {
        // Update email to match Google account and save tokens
        db.prepare('UPDATE users SET email = ?, access_token = ?, refresh_token = COALESCE(?, refresh_token) WHERE id = ?')
          .run(profile.email, tokens.access_token, tokens.refresh_token || null, sessionUserId);
        userId = sessionUserId;
      } else {
        userId = profile.id || uuidv4();
        saveUser({
          id: userId,
          email: profile.email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          push_token: null,
          gmail_history_id: null,
        });
      }
    } else {
      userId = profile.id || uuidv4();
      saveUser({
        id: userId,
        email: profile.email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        push_token: null,
        gmail_history_id: null,
      });
    }

    // Set up Gmail push notifications
    try {
      await setupGmailWatch(userId);
    } catch (watchErr) {
      console.error('[auth] Gmail watch setup failed (non-fatal):', watchErr.message);
    }

    // Store userId in session
    req.session.userId = userId;
    delete req.session.oauthFrom;

    // Set persistent signed cookie with email so login survives redeploys
    const cookieOpts = {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    };
    res.cookie('glow_user_email', profile.email, cookieOpts);

    // Also persist the refresh token in a cookie so Gmail stays connected across redeploys
    if (tokens.refresh_token) {
      res.cookie('glow_gmail_refresh', tokens.refresh_token, cookieOpts);
    }

    if (isWebLogin) {
      // Redirect back to the web UI
      return res.redirect('/');
    }

    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#FDF6F0;">
        <h2 style="color:#D4A0A0;">✓ Gmail Connected!</h2>
        <p style="color:#2D2D2D;">Your User ID: <strong>${userId}</strong></p>
        <p style="color:#8A8A8A;">Copy this ID and add it to your mobile app .env as<br><code>EXPO_PUBLIC_USER_ID=${userId}</code></p>
        <p style="color:#8A8A8A;margin-top:30px;">You can close this tab.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('[auth] Callback error:', err);
    res.redirect(`${process.env.FRONTEND_DEEP_LINK || 'glowsf://'}auth-error?reason=${encodeURIComponent(err.message)}`);
  }
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────
// Return current authenticated user info

router.get('/me', (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = getUser(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Don't expose tokens
  res.json({
    id: user.id,
    email: user.email,
    companyName: user.company_name,
    theme: user.theme || 'rose',
    websites: JSON.parse(user.websites || '[]'),
    brands: JSON.parse(user.brands || '["avologi","avinichi","hydrasphere"]'),
    hasGmail: !!user.refresh_token,
    push_token: user.push_token,
    gmail_history_id: user.gmail_history_id,
    created_at: user.created_at,
  });
});

// ─── POST /auth/push-token ─────────────────────────────────────────────────────
// Save/update Expo push notification token for the user

router.post('/push-token', (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { push_token } = req.body;
  if (!push_token || typeof push_token !== 'string') {
    return res.status(400).json({ error: 'push_token is required' });
  }

  updateUserPushToken(userId, push_token);
  res.json({ success: true });
});

// ─── POST /auth/theme ──────────────────────────────────────────────────────────
// Save user's theme preference

router.post('/theme', (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { theme } = req.body;
  const VALID_THEMES = ['rose', 'earth', 'lavender', 'ocean', 'sage'];
  if (!theme || !VALID_THEMES.includes(theme)) {
    return res.status(400).json({ error: `Invalid theme. Must be one of: ${VALID_THEMES.join(', ')}` });
  }

  const { updateUserTheme } = require('../db');
  updateUserTheme(userId, theme);
  res.json({ success: true, theme });
});

// ─── POST /auth/company-name ──────────────────────────────────────────────────
// Update user's company name

router.post('/company-name', (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { companyName } = req.body;
  if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  const { updateCompanyName } = require('../db');
  updateCompanyName(userId, companyName.trim());
  res.json({ success: true, companyName: companyName.trim() });
});

// ─── POST /auth/websites ──────────────────────────────────────────────────────
// Save user's website list

router.post('/websites', (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { websites } = req.body;
  if (!Array.isArray(websites)) {
    return res.status(400).json({ error: 'websites must be an array' });
  }

  // Validate and clean URLs
  const cleaned = websites
    .map(w => (typeof w === 'string' ? w.trim() : ''))
    .filter(w => w.length > 0);

  const { updateUserWebsites } = require('../db');
  updateUserWebsites(userId, cleaned);
  res.json({ success: true, websites: cleaned });
});

// ─── POST /auth/brands ──────────────────────────────────────────────────────
// Save user's selected product brands

router.post('/brands', (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { brands } = req.body;
  if (!Array.isArray(brands)) {
    return res.status(400).json({ error: 'brands must be an array' });
  }

  const VALID_BRANDS = ['avologi', 'avinichi', 'hydrasphere'];
  const cleaned = brands.filter(b => VALID_BRANDS.includes(b));

  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'At least one brand must be selected' });
  }

  const { updateUserBrands } = require('../db');
  updateUserBrands(userId, cleaned);
  res.json({ success: true, brands: cleaned });
});

// ─── POST /auth/logout ─────────────────────────────────────────────────────────
// Clear session

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth] Session destroy error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.clearCookie('glow_user_email');
    res.clearCookie('glow_company_name');
    res.json({ success: true });
  });
});

module.exports = router;
