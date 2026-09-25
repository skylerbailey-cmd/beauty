'use strict';

// Opening an account.
//
// Everything here is reachable without a session, which makes it the most
// exposed surface on the server. Three things follow from that and are not
// negotiable:
//
//   The email is verified. Every account is created from a completed Google
//   sign-in, so the address on it has been proven by Google. There is no
//   "type your email and you're in" path — that is the door we just closed on
//   the main login and it is not being reopened here.
//
//   Everything is rate limited. Slug checks, product imports and account
//   creation each have their own budget, because one script claiming every
//   good subdomain overnight is the obvious first attack.
//
//   A shop can only ever touch its own record. The session decides which
//   company is being set up — never a company id in the request body.

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const { rateLimit } = require('../lib/rate-limit');
const { appDomain, companyUrl } = require('../lib/tenancy');

// Addresses the product itself uses, plus the ones that would let somebody
// pass themselves off as us to a shop's staff.
const RESERVED_SLUGS = new Set([
  'app', 'www', 'admin', 'api', 'mail', 'email', 'static', 'assets', 'cdn',
  'login', 'signup', 'signin', 'account', 'accounts', 'billing', 'pay',
  'support', 'help', 'docs', 'status', 'blog', 'shop', 'store', 'test',
  'staging', 'dev', 'demo', 'sandbox', 'skysale', 'sky', 'sale', 'security',
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function slugProblem(slug) {
  const s = String(slug || '').toLowerCase().trim();
  if (!s) return 'Pick an address for your shop.';
  if (s.length < 3) return 'That\'s too short — three characters or more.';
  if (s.length > 40) return 'That\'s too long — forty characters or fewer.';
  if (!SLUG_RE.test(s)) return 'Letters, numbers and hyphens only, starting and ending with a letter or number.';
  if (s.includes('--')) return 'Two hyphens in a row is hard to read aloud.';
  if (RESERVED_SLUGS.has(s)) return 'That one is reserved.';
  return null;
}

function requireSignedIn(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Sign in with Google to continue.', useGoogle: true });
  }
  next();
}

// ─── Is this address free? ──────────────────────────────────────────────────

router.get('/slug-available',
  rateLimit({ limit: 60, windowMs: 60 * 1000, name: 'slug' }),
  async (req, res) => {
    const slug = String(req.query.slug || '').toLowerCase().trim();
    const problem = slugProblem(slug);
    if (problem) return res.json({ available: false, reason: problem, slug });

    const taken = await pgDb.getCompanyBySlug(slug);
    // Taken by this very account is not taken — it's them, coming back.
    const mine = taken && req.session?.userId && taken.user_id === req.session.userId;
    res.json({
      available: !taken || !!mine,
      reason: taken && !mine ? 'Somebody already has that one.' : null,
      slug,
      url: appDomain() ? `${slug}.${appDomain()}` : `${slug}.sky-sale.com`,
    });
  });

// ─── Where am I up to? ──────────────────────────────────────────────────────
// Signup is resumable: close the tab at step four and come back to step four.

router.get('/state', requireSignedIn, async (req, res) => {
  const userId = req.session.userId;
  const settings = await pgDb.getSettings(userId);
  const employees = await pgDb.getEmployees(userId);
  const products = await pgDb.getCustomProducts(userId).catch(() => []);
  const txCount = await pgDb.countTransactions(userId).catch(() => 0);

  const { getUser } = require('../db');
  const user = getUser(userId) || {};

  res.json({
    email: user.email || '',
    shop: {
      store_name: settings?.store_name || '',
      slug: settings?.slug || '',
      store_address: settings?.store_address || '',
      store_city: settings?.store_city || '',
      store_state: settings?.store_state || '',
      store_zip: settings?.store_zip || '',
      store_phone: settings?.store_phone || '',
      timezone: settings?.timezone || '',
      tax_rate: settings?.tax_rate ?? null,
    },
    done: {
      shop: !!(settings?.store_name && settings?.slug),
      admin: employees.some((e) => e.role === 'admin' && e.active),
      products: products.length > 0,
      history: txCount > 0,
    },
    counts: { staff: employees.filter((e) => e.active).length, products: products.length, transactions: txCount },
    live_url: settings?.slug ? companyUrl(settings.slug, '/pos.html') : null,
  });
});

// ─── Step: the shop ─────────────────────────────────────────────────────────

router.post('/shop',
  requireSignedIn,
  rateLimit({ limit: 20, windowMs: 10 * 60 * 1000, name: 'shop' }),
  async (req, res) => {
    const b = req.body || {};
    const userId = req.session.userId;

    const name = String(b.store_name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'What is the shop called?' });

    const slug = String(b.slug || '').toLowerCase().trim();
    const problem = slugProblem(slug);
    if (problem) return res.status(400).json({ error: problem, field: 'slug' });

    // Claimed between the browser checking and submitting, or by somebody else
    // entirely — either way it isn't theirs.
    const holder = await pgDb.getCompanyBySlug(slug);
    if (holder && holder.user_id !== userId) {
      return res.status(409).json({ error: 'Somebody claimed that address a moment ago. Pick another.', field: 'slug' });
    }

    const tax = Number(b.tax_rate);
    if (!Number.isFinite(tax) || tax < 0 || tax > 0.3) {
      return res.status(400).json({ error: 'Sales tax should be a rate like 8.25, between 0 and 30.', field: 'tax_rate' });
    }
    if (!String(b.timezone || '').trim()) {
      return res.status(400).json({ error: 'Which timezone is the shop in?', field: 'timezone' });
    }

    await pgDb.updateSettings(userId, {
      store_name: name,
      slug,
      store_address: String(b.store_address || '').trim(),
      store_city: String(b.store_city || '').trim(),
      store_state: String(b.store_state || '').trim(),
      store_zip: String(b.store_zip || '').trim(),
      store_phone: String(b.store_phone || '').trim(),
      store_email: String(b.store_email || '').trim(),
      timezone: String(b.timezone).trim(),
      tax_rate: tax,
      // A new shop sells nothing until it says otherwise.
      //
      // The server carries a built-in catalogue of brands, and the column
      // default opts every new row into all of them. That was harmless while
      // there was one shop, whose brands those were. It is not harmless now:
      // it would put another company's product range on a stranger's register
      // on their first morning, with brand filters for ranges they have never
      // heard of, and they would have to work out which of it was theirs.
      brands: '[]',
    });

    res.json({ ok: true, slug, url: companyUrl(slug, '/pos.html') });
  });

// ─── Step: the person who can see everything ────────────────────────────────

router.post('/admin',
  requireSignedIn,
  rateLimit({ limit: 20, windowMs: 10 * 60 * 1000, name: 'admin' }),
  async (req, res) => {
    const userId = req.session.userId;
    const name = String(req.body?.name || '').trim();
    const pin = String(req.body?.pin || '').trim();

    if (name.length < 2) return res.status(400).json({ error: 'Who is the administrator?', field: 'name' });
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'The admin PIN is four digits.', field: 'pin' });
    }
    // Still refuses the handful anyone would try first — four of the same, or
    // a straight run up or down. A PIN that unlocks payroll is worth that much.
    if (/^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      return res.status(400).json({ error: 'Pick something less guessable than that.', field: 'pin' });
    }

    const existing = (await pgDb.getEmployees(userId)).find(
      (e) => e.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      await pgDb.updateEmployee(existing.id, { pin, role: 'admin', active: 1 });
      return res.json({ ok: true, id: existing.id, updated: true });
    }
    const emp = await pgDb.createEmployee(name, pin, 'admin', 0, userId);
    res.json({ ok: true, id: emp.id, updated: false });
  });

// ─── Step: what they sell ───────────────────────────────────────────────────

// Reading a supplier's page costs a paid API call and fetches a URL on the
// server's behalf, so this is the tightest budget on the server.
router.post('/read-products',
  requireSignedIn,
  rateLimit({
    limit: 8, windowMs: 60 * 60 * 1000, name: 'read-products',
    message: 'That\'s enough page reads for now. Add the rest by hand or upload a file, and try again in an hour.',
  }),
  async (req, res) => {
    const { extractProductsFromUrl } = require('../services/product-import');
    try {
      const result = await extractProductsFromUrl(req.body?.url);
      res.json({
        ok: true,
        products: result.products,
        source_url: result.sourceUrl,
        page_title: result.pageTitle,
        hint: result.hint || null,
        // Said plainly, because the next screen asks them to check it.
        note: 'Read from the page — check every price before saving.',
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'That page could not be read.' });
    }
  });

router.post('/products',
  requireSignedIn,
  rateLimit({ limit: 30, windowMs: 10 * 60 * 1000, name: 'products' }),
  async (req, res) => {
    const userId = req.session.userId;
    const rows = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!rows.length) return res.status(400).json({ error: 'No products to save.' });

    let saved = 0, skipped = 0;
    for (const p of rows) {
      const name = String(p?.name || '').trim();
      const price = Number(p?.price);
      if (!name || !Number.isFinite(price) || price < 0) { skipped++; continue; }
      try {
        await pgDb.createCustomProduct({
          name,
          price,
          brand: String(p?.brand || '').trim() || 'Custom',
          category: String(p?.category || '').trim(),
          description: String(p?.description || '').trim(),
          usage: String(p?.usage || '').trim(),
          // Only ever an address the extractor saw on the page — it filters
          // the model's answer against what it actually found. Kept as a
          // remote URL rather than copied: a supplier who replaces a photo
          // should have the till follow, and we are not in the business of
          // rehosting their catalogue.
          image: String(p?.image || '').trim(),
          source_url: String(p?.source_url || '').trim(),
        }, userId);
        saved++;
      } catch (_) { skipped++; }
    }
    res.json({ ok: true, saved, skipped });
  });

// ─── Done ───────────────────────────────────────────────────────────────────

router.post('/finish', requireSignedIn, async (req, res) => {
  const userId = req.session.userId;
  const settings = await pgDb.getSettings(userId);
  if (!settings?.store_name || !settings?.slug) {
    return res.status(400).json({ error: 'The shop name and address are still needed.' });
  }
  const hasAdmin = (await pgDb.getEmployees(userId)).some((e) => e.role === 'admin' && e.active);
  if (!hasAdmin) {
    return res.status(400).json({ error: 'Set up the administrator before finishing.' });
  }
  res.json({ ok: true, url: companyUrl(settings.slug, '/pos.html'), slug: settings.slug });
});

module.exports = router;
module.exports.slugProblem = slugProblem;
module.exports.RESERVED_SLUGS = RESERVED_SLUGS;
