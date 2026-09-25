'use strict';

// Signing in with your own email address, whoever it is with.
//
// A shop types an address, we mail a one-time link, and clicking it proves
// they can read that inbox. That proof is the whole authentication: there is
// no password to store, leak, reuse or reset, and the address is verified by
// the act of signing in rather than by a separate step someone can skip.
//
// Four rules this file exists to keep:
//
//   The reply never says whether an account exists. "Check your inbox" comes
//   back for every address, so this cannot be used to find out which shops
//   have accounts.
//
//   Links are rate limited by address as well as by caller. Otherwise anyone
//   with a few IP addresses can fill one shop's inbox with login mail.
//
//   A link is spent when used. The database claims it in a single conditional
//   update, so a link that is forwarded, quoted in a reply, or clicked twice
//   by an over-eager mail scanner opens nothing the second time.
//
//   A send that fails says so. A link silently dropped looks like a slow
//   inbox, and the shop waits for mail that is never coming.

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const { rateLimit, consume, clientKey } = require('../lib/rate-limit');
const { cookieDomainFor, companyUrl, appDomain } = require('../lib/tenancy');

const LINK_MINUTES = 60;

// The showroom account, if this deployment has one.
//
// A list rather than one address, because test@demo.com and demo@test.com are
// equally memorable and nobody should have to remember which way round it
// goes to get into a demo. Every spelling opens the same company: the first
// in the list is the one it belongs to, and the rest are simply let through
// to it.
const demoAddresses = () => String(process.env.DEMO_EMAIL || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const isDemoAddress = (email) => demoAddresses().includes(email);

// Deliberately loose. The job here is to catch a typo and obvious nonsense,
// not to adjudicate the RFC — a real address that a strict pattern rejects is
// a shop that cannot sign up at all.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const normalise = (v) => String(v || '').trim().toLowerCase();

function originOf(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

// ─── POST /auth/link ────────────────────────────────────────────────────────
// Ask for a sign-in link.

router.post('/link',
  rateLimit({
    limit: 20, windowMs: 15 * 60 * 1000, name: 'login-link-ip',
    message: 'Too many sign-in attempts from here. Try again shortly.',
  }),
  async (req, res) => {
    const email = normalise(req.body?.email);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'That doesn\'t look like an email address.' });
    }

    // Per-address, so a flood cannot be aimed at one inbox from many places.
    const perAddress = consume({
      name: 'login-link-email', key: email, limit: 5, windowMs: 15 * 60 * 1000,
    });
    if (!perAddress.ok) {
      // Still not a statement about whether the account exists — the same
      // answer comes back for an address that has never been seen.
      return res.status(429).json({
        error: 'A few links have already gone to that address. Check your inbox, or try again in a little while.',
      });
    }

    // ── The demo shop ──
    //
    // One address, and only when DEMO_EMAIL names it, signs in without a
    // link. It has to: nobody can read mail at test@demo.com, and a demo you
    // cannot get into is not a demo.
    //
    // This is a password-less door, so it is worth being plain about what
    // keeps it safe. It opens exactly one company, whose every customer,
    // sale and staff member is invented; it is rebuilt from a script, so
    // anything a visitor does to it is temporary; and it reaches no other
    // company, because a session names one shop and tenancy does the rest.
    // Unset DEMO_EMAIL and the door does not exist.
    if (isDemoAddress(email)) {
      const { findOrCreateUserByEmail } = require('../db');
      // Always the first address in the list — otherwise a second spelling
      // would derive a different account id and open an empty shop with the
      // demo's name on the door.
      const { user } = findOrCreateUserByEmail(demoAddresses()[0], null);
      req.session.userId = user.id;
      // A combined view is authorised against one company's manager PIN, for
      // that company's session. It must not survive a change of company —
      // otherwise a browser that had combined two shops for payroll carries
      // both of them into whichever shop it signs into next, and their staff
      // appear on a register that has nothing to do with them.
      req.session.companyScope = null;
      rememberAuthenticated(req, user.id);
      res.cookie('glow_user_email', user.email, {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true, signed: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        domain: cookieDomainFor(req),
      });
      let slug = null;
      try { slug = await pgDb.getCompanySlug(user.id); } catch (_) {}
      return res.json({
        ok: true,
        demo: true,
        redirect: slug && appDomain() ? companyUrl(slug, '/pos.html') : '/pos.html',
      });
    }

    let isNew = true;
    try {
      // Only to choose the wording of the mail. It is never revealed here.
      isNew = !(await pgDb.emailHasAccount(email));
    } catch (_) { /* wording is not worth failing a sign-in over */ }

    try {
      const token = await pgDb.createLoginLink(email, LINK_MINUTES);
      const url = `${originOf(req)}/auth/link/${encodeURIComponent(token)}`;
      const { sendLoginLink } = require('../services/mailer');
      await sendLoginLink({ to: email, url, isNew, minutes: LINK_MINUTES });
    } catch (err) {
      console.error('[login] Could not send a sign-in link:', err.message);
      // The one case where saying nothing would be worse than saying too
      // much. The shop is owed the difference between "check your inbox" and
      // "our mail is broken", because only one of those is worth waiting on.
      return res.status(err.status === 503 ? 503 : 502).json({
        error: 'We could not send the email just now. Try again in a moment, or sign in with Google.',
      });
    }

    res.json({ ok: true, message: 'Check your inbox.' });
  });

// ─── GET /auth/link/:token ──────────────────────────────────────────────────
// Spend a link and sign in.

router.get('/link/:token',
  rateLimit({
    limit: 60, windowMs: 15 * 60 * 1000, name: 'login-link-use',
    message: 'Too many attempts. Try again shortly.',
  }),
  async (req, res) => {
    let email = null;
    try {
      email = await pgDb.consumeLoginLink(req.params.token);
    } catch (err) {
      console.error('[login] Could not read the sign-in link:', err.message);
      return res.redirect('/signup.html?problem=server');
    }

    if (!email) {
      // Used, expired, or never real — all the same to whoever is holding it,
      // and worth the same answer.
      return res.redirect('/signup.html?problem=link');
    }

    const { findOrCreateUserByEmail } = require('../db');
    const { user } = findOrCreateUserByEmail(email, null);

    try { await pgDb.rememberUser(user.id); } catch (_) {}

    req.session.userId = user.id;
    // As above: a combined payroll view belongs to the session that
    // authorised it, not to the browser.
    req.session.companyScope = null;
    rememberAuthenticated(req, user.id);
    res.cookie('glow_user_email', user.email, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: cookieDomainFor(req),
    });

    // A shop that has finished setting up belongs at its own address; one that
    // has not belongs back in the wizard.
    let slug = null;
    try { slug = await pgDb.getCompanySlug(user.id); } catch (_) {}
    if (!slug) return res.redirect('/signup.html');
    if (appDomain()) return res.redirect(companyUrl(slug, '/pos.html'));
    return res.redirect('/pos.html');
  });

// ─── Which companies this browser has actually proved it can open ──────────
//
// A shop with two locations wants to move between them without a round trip
// to an inbox each time. But a session is per company, and the old switcher
// simply asserted the new company's email and was let in — which was only
// ever possible because email alone used to be a credential. It is not.
//
// So: proving an address adds that company to a list on the session, and
// switching is allowed only to a company already on it. One sign-in per
// company per browser session, then move freely. Adding a new one needs a
// fresh link, because that is what proving an address means.

function rememberAuthenticated(req, userId) {
  if (!req.session || !userId) return;
  const list = Array.isArray(req.session.authedCompanies) ? req.session.authedCompanies : [];
  if (!list.includes(userId)) list.push(userId);
  req.session.authedCompanies = list;
}

function hasAuthenticated(req, userId) {
  return Array.isArray(req.session?.authedCompanies) && req.session.authedCompanies.includes(userId);
}

const idForEmail = (email) => {
  const { v5: uuidv5 } = require('uuid');
  return uuidv5('mailto:' + String(email).trim().toLowerCase(), uuidv5.URL);
};

// ─── POST /auth/switch ──────────────────────────────────────────────────────
// Move to another company this browser has already signed in to.

router.post('/switch', async (req, res) => {
  const email = normalise(req.body?.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Which company?' });

  const userId = idForEmail(email);
  if (!hasAuthenticated(req, userId)) {
    // Never says whether the company exists — only that this browser has not
    // proved it can open it.
    return res.status(403).json({
      error: 'Sign in to that company first.',
      needsSignIn: true,
      email,
    });
  }

  const { getUser } = require('../db');
  req.session.userId = userId;
  // A multi-company report view was authorised against the previous company's
  // manager PIN. It does not carry across.
  req.session.companyScope = null;

  let user = null;
  try { user = getUser(userId); } catch (_) {}
  // SQLite is wiped on every deploy, so the row may not be there even though
  // the company plainly is. The address is what identifies it.
  if (!user) {
    const { findOrCreateUserByEmail } = require('../db');
    user = findOrCreateUserByEmail(email, null).user;
  }

  res.cookie('glow_user_email', user.email, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true, signed: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: cookieDomainFor(req),
  });

  // The shop's name and address live in Postgres, which survives a deploy.
  // SQLite's company_name is a leftover that is usually empty, and reading it
  // here left the switcher listing an address where a name should be.
  let slug = null, storeName = null;
  try {
    const st = await pgDb.getSettings(userId);
    slug = st?.slug || null;
    storeName = st?.store_name || null;
  } catch (_) {}

  res.json({
    ok: true,
    user: {
      id: userId,
      email: user.email,
      companyName: storeName || user.company_name || null,
      brands: JSON.parse(user.brands || '[]'),
    },
    slug,
    url: slug && appDomain() ? companyUrl(slug, '/pos.html') : null,
  });
});

// ─── GET /auth/companies ────────────────────────────────────────────────────
// Which ones this browser can switch to without signing in again.

router.get('/companies', async (req, res) => {
  const ids = Array.isArray(req.session?.authedCompanies) ? req.session.authedCompanies : [];
  const out = [];
  for (const id of ids) {
    let name = null, slug = null;
    try {
      const st = await pgDb.getSettings(id);
      name = st?.store_name || null;
      slug = st?.slug || null;
    } catch (_) {}
    out.push({ id, companyName: name, slug, current: id === req.session?.userId });
  }
  res.json({ companies: out });
});

module.exports = router;
