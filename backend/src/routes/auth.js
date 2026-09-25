'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createOAuthClient, setupGmailWatch } = require('../services/gmail');
const { db, saveUser, getUser, updateUserPushToken } = require('../db');

const router = express.Router();

// Two different asks, deliberately kept apart.
//
// Proving who you are needs nothing but your name and address, and Google
// hands those over to any app without review. Reading a mailbox is another
// matter: gmail.modify and gmail.compose are *restricted* scopes, which means
// Google grants them only after verification and a third-party security
// assessment — and until that clears, nobody outside the test-user list can
// complete the consent screen at all.
//
// Asking for both at the front door therefore made signing in impossible for
// every shop that isn't us. So sign-in asks for identity alone and works for
// anyone today; the mailbox scopes are requested later, the first time a shop
// actually opens its Emails tab, and only that feature waits on verification.
const SIGN_IN_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  ...SIGN_IN_SCOPES,
];

// ─── POST /auth/web-login ─────────────────────────────────────────────────────
//
// Email-only sign-in: type a company's address and you are that company. That
// was survivable while the app lived at an unguessable Railway URL and nothing
// linked to it. It is not survivable on a published address with a Sign in
// button pointing at it — the shop's customer list, bookings and register sit
// behind it, and a company's email address is not a secret.
//
// Google sign-in (/auth/google?from=web) is the way in now. This route stays
// only while LEGACY_EMAIL_LOGIN is set, so an existing bookmark keeps working
// through the changeover; clear that variable to close it for good.

// Explicitly on or off if the variable says so; otherwise it closes exactly
// when the app becomes publicly addressable. Deploying this changes nothing
// while the app still lives at the Railway hostname — nobody gets locked out
// of a register mid-shift — and the door shuts the moment APP_DOMAIN points a
// guessable address at it.
function emailLoginAllowed() {
  const flag = process.env.LEGACY_EMAIL_LOGIN;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return !process.env.APP_DOMAIN;
}

router.post('/web-login', (req, res) => {
  if (!emailLoginAllowed()) {
    // Names the way in that actually exists. Google is still offered, but
    // the link is what most shops will use and what the sign-in screen leads
    // with, and pointing at the wrong one reads as "you cannot get in".
    return res.status(403).json({
      error: 'Signing in with an email address alone is no longer possible. Ask for a sign-in link instead.',
      useGoogle: true,
      signInUrl: '/signup.html',
    });
  }
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
  // A multi-company view was authorised against the previous company's manager
  // PIN, so it must not carry over into a different company's session.
  req.session.companyScope = null;

  // Set long-lived signed cookies so login persists across Railway redeploys
  const { cookieDomainFor } = require('../lib/tenancy');
  const cookieOpts = {
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    httpOnly: true,
    signed: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Undefined on the Railway hostname, which keeps today's behaviour.
    domain: cookieDomainFor(req),
  };
  res.cookie('glow_user_email', user.email, cookieOpts);
  // Refresh ALL preference cookies to THIS company's values on every login/switch.
  // Otherwise a stale cookie from the previously-active company can bleed its
  // brands/theme into this company via the persistent-auth restore middleware.
  res.cookie('glow_company_name', user.company_name || '', cookieOpts);
  res.cookie('glow_theme', user.theme || 'rose', cookieOpts);
  res.cookie('glow_brands', user.brands || '[]', cookieOpts);
  res.cookie('glow_websites', user.websites || '[]', cookieOpts);

  res.json({
    success: true,
    isNew,
    user: {
      id: user.id,
      email: user.email,
      companyName: user.company_name,
      theme: user.theme || 'rose',
      websites: JSON.parse(user.websites || '[]'),
      brands: JSON.parse(user.brands || '[]'),
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
  // Remember where to return after auth (only same-site relative paths allowed)
  const ret = req.query.return;
  if (typeof ret === 'string' && ret.startsWith('/') && !ret.startsWith('//')) {
    req.session.oauthReturn = ret;
  }

  // The mailbox is asked for only when a shop goes to connect it, and on the
  // mobile flow, whose whole purpose is handing back a Gmail-linked user id.
  const wantsGmail = req.query.connect === 'gmail' || from !== 'web';
  req.session.oauthWants = wantsGmail ? 'gmail' : 'identity';

  const oauth2Client = createOAuthClient();

  const authUrl = oauth2Client.generateAuthUrl({
    // A refresh token is only worth holding for a mailbox we send from later.
    // Signing in needs one answer, once, so it asks for no standing access.
    access_type: wantsGmail ? 'offline' : 'online',
    scope: wantsGmail ? GMAIL_SCOPES : SIGN_IN_SCOPES,
    // Re-prompting is what forces Google to re-issue a refresh token, so it
    // matters for the mailbox and only gets in the way of signing in.
    prompt: wantsGmail ? 'consent' : 'select_account',
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
    return res.redirect(`${process.env.FRONTEND_DEEP_LINK || 'skysale://'}auth-error?reason=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_DEEP_LINK || 'skysale://'}auth-error?reason=no_code`);
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
    let cookieEmail = profile.email;
    if (isWebLogin && sessionUserId) {
      // Attach Gmail tokens to the CURRENT company's account. Do NOT change the
      // account's login email — the account id is derived from it, and changing
      // it would orphan the company's data and its Gmail connection on redeploy.
      const existingUser = getUser(sessionUserId);
      if (existingUser) {
        db.prepare('UPDATE users SET access_token = ?, refresh_token = COALESCE(?, refresh_token) WHERE id = ?')
          .run(tokens.access_token, tokens.refresh_token || null, sessionUserId);
        userId = sessionUserId;
        cookieEmail = existingUser.email; // keep the stable login email
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
    } else if (isWebLogin) {
      // Signing a shop in from the web. The account id has to come out the same
      // as the one email sign-in derived, because every row this company owns
      // in Postgres is keyed by it. Google's own numeric profile id is a
      // different number entirely — use it here and a shop that has been
      // trading for months signs in to an empty register, its transactions,
      // staff and customers all still in the database under the other id.
      //
      // So the verified Google address is put through the same derivation the
      // email door used. Whichever way a shop comes in, it lands on its own
      // account.
      const { findOrCreateUserByEmail } = require('../db');
      const email = String(profile.email || '').trim().toLowerCase();
      if (!email) throw new Error('Google did not return an email address.');
      const { user } = findOrCreateUserByEmail(email, null);
      userId = user.id;
      cookieEmail = user.email;
      if (tokens.access_token || tokens.refresh_token) {
        db.prepare('UPDATE users SET access_token = COALESCE(?, access_token), refresh_token = COALESCE(?, refresh_token) WHERE id = ?')
          .run(tokens.access_token || null, tokens.refresh_token || null, userId);
      }
    } else {
      // The mobile flow, which exists to hand a Gmail-linked user id back to
      // the Expo app. Its ids have always been Google's, and rekeying them
      // here would orphan exactly what the web change above is preventing.
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

    // Persist this company's refresh token in Postgres so the Gmail connection
    // survives redeploys and stays isolated to this company only.
    if (tokens.refresh_token) {
      try {
        const pgDb = require('../db/postgres');
        await pgDb.saveGmailToken(userId, tokens.refresh_token, profile.email);
      } catch (e) {
        console.error('[auth] Failed to persist Gmail token to Postgres:', e.message);
      }
    }

    // Only worth doing when a mailbox was actually granted. On a plain sign-in
    // there is nothing to watch, and asking anyway fails on every single login.
    if (req.session?.oauthWants !== 'identity') {
      try {
        await setupGmailWatch(userId);
      } catch (watchErr) {
        console.error('[auth] Gmail watch setup failed (non-fatal):', watchErr.message);
      }
    }
    delete req.session.oauthWants;

    // Store userId in session
    req.session.userId = userId;
    // Signing in with Google proves this address too, so the company joins the
    // set this browser may switch between without another round trip.
    {
      const list = Array.isArray(req.session.authedCompanies) ? req.session.authedCompanies : [];
      if (!list.includes(userId)) list.push(userId);
      req.session.authedCompanies = list;
    }
    delete req.session.oauthFrom;

    // Set persistent signed cookie with email so login survives redeploys
    const { cookieDomainFor: googleCookieDomain } = require('../lib/tenancy');
    const cookieOpts = {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      // Scoped to the whole domain, as the email door already does. Signing in
      // happens at app.sky-sale.com and the shop is then sent to its own
      // address; a cookie pinned to the sign-in host alone would not travel
      // there, and the first redeploy — which empties the session store —
      // would drop them back to a login screen.
      domain: googleCookieDomain(req),
    };
    res.cookie('glow_user_email', cookieEmail, cookieOpts);
    // NOTE: the Gmail refresh token is intentionally NOT stored in a cookie —
    // a single browser-wide cookie bleeds one company's Gmail into another.
    // Tokens are persisted per-company in Postgres instead.

    if (isWebLogin) {
      const dest = req.session.oauthReturn || '/';
      delete req.session.oauthReturn;

      // Signing in centrally at app.sky-sale.com: send them on to their own
      // shop's address, so the tab they end up working in says which shop it
      // is. Already on a shop's address — or no address configured — and this
      // does nothing.
      try {
        const { slugFromHost, companyUrl, appDomain } = require('../lib/tenancy');
        if (appDomain() && !slugFromHost(req)) {
          const slug = await require('../db/postgres').getCompanySlug(userId);
          if (slug) return res.redirect(companyUrl(slug, dest.startsWith('/') ? dest : '/pos.html'));
        }
      } catch (e) {
        console.error('[auth] Could not route to the company address:', e.message);
      }
      return res.redirect(dest);
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
    res.redirect(`${process.env.FRONTEND_DEEP_LINK || 'skysale://'}auth-error?reason=${encodeURIComponent(err.message)}`);
  }
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────
// Return current authenticated user info

router.get('/me', async (req, res) => {
  const userId = req.session?.userId || req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = getUser(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Back-fill an already-connected Gmail token into Postgres (fire-and-forget)
  // so the connection survives future redeploys without a reconnect.
  if (user.refresh_token) {
    (async () => {
      try {
        const pgDb = require('../db/postgres');
        const rt = await pgDb.getGmailToken(userId);
        if (!rt) await pgDb.saveGmailToken(userId, user.refresh_token, user.email);
      } catch (_) {}
    })();
  }

  // SQLite forgets the company name on every redeploy, so fall back to the
  // copy in Postgres and put it back — otherwise Settings shows the signup
  // name again and looks as though saving never worked.
  if (!user.company_name) {
    try {
      const saved = await require('../db/postgres').getCompanyName(userId);
      if (saved) {
        user.company_name = saved;
        require('../db').updateCompanyName(userId, saved);
      }
    } catch (_) { /* the name just stays as it is */ }
  }

  // Don't expose tokens
  res.json({
    id: user.id,
    email: user.email,
    companyName: user.company_name,
    theme: user.theme || 'rose',
    websites: JSON.parse(user.websites || '[]'),
    brands: JSON.parse(user.brands || '[]'),
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
  const cookieOpts = { maxAge: 365*24*60*60*1000, httpOnly: true, signed: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
  res.cookie('glow_theme', theme, cookieOpts);
  res.json({ success: true, theme });
});

// ─── POST /auth/company-name ──────────────────────────────────────────────────
// Update user's company name

router.post('/company-name', async (req, res) => {
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
  // Also to Postgres: SQLite is wiped on every redeploy, so on its own the
  // name would quietly revert to whatever it was at signup.
  try {
    await require('../db/postgres').saveCompanyName(userId, companyName.trim());
  } catch (err) {
    console.error('[auth] could not mirror company name to postgres:', err.message);
  }
  const cookieOpts = { maxAge: 365*24*60*60*1000, httpOnly: true, signed: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
  res.cookie('glow_company_name', companyName.trim(), cookieOpts);
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
  const cookieOpts = { maxAge: 365*24*60*60*1000, httpOnly: true, signed: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
  res.cookie('glow_websites', JSON.stringify(cleaned), cookieOpts);
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

  const VALID_BRANDS = ['avologi', 'avinichi', 'hydrasphere', 'spacetouch', 'lumieres'];
  const cleaned = brands.filter(b => VALID_BRANDS.includes(b));

  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'At least one brand must be selected' });
  }

  const { updateUserBrands } = require('../db');
  updateUserBrands(userId, cleaned);
  const cookieOpts = { maxAge: 365*24*60*60*1000, httpOnly: true, signed: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
  res.cookie('glow_brands', JSON.stringify(cleaned), cookieOpts);
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
    // A cookie is only cleared by a matching domain. These are written scoped
    // to the whole app domain, so clearing them unscoped leaves every one of
    // them in place — and glow_user_email alone silently signs the browser
    // straight back in on the next request, which is not a logout at all.
    // Both spellings are cleared because sessions started on the Railway
    // hostname have host-only cookies that the scoped clear would miss.
    const { cookieDomainFor } = require('../lib/tenancy');
    const domain = cookieDomainFor(req);
    const NAMES = ['connect.sid', 'glow_user_email', 'glow_company_name',
      'glow_gmail_refresh', 'glow_theme', 'glow_brands', 'glow_websites'];
    for (const name of NAMES) {
      res.clearCookie(name);
      if (domain) res.clearCookie(name, { domain });
    }
    res.json({ success: true });
  });
});

module.exports = router;
