'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createOAuthClient, setupGmailWatch } = require('../services/gmail');
const { saveUser, getUser, updateUserPushToken } = require('../db');

const router = express.Router();

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ─── GET /auth/google ──────────────────────────────────────────────────────────
// Redirect user to Google OAuth consent screen

router.get('/google', (req, res) => {
  const oauth2Client = createOAuthClient();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: OAUTH_SCOPES,
    prompt: 'consent', // force refresh_token on every login
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

    // Generate a stable user ID from Google sub
    const userId = profile.id || uuidv4();

    // Save/update user record
    const user = saveUser({
      id: userId,
      email: profile.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      push_token: null,
      gmail_history_id: null,
    });

    // Set up Gmail push notifications
    try {
      await setupGmailWatch(userId);
    } catch (watchErr) {
      console.error('[auth] Gmail watch setup failed (non-fatal):', watchErr.message);
    }

    // Store userId in session
    req.session.userId = userId;

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

// ─── POST /auth/logout ─────────────────────────────────────────────────────────
// Clear session

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth] Session destroy error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

module.exports = router;
