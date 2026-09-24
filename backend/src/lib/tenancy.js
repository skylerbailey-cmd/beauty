'use strict';

// Which shop a request is for, read from the address it arrived on.
//
//   glowsf.sky-sale.com        → the company whose slug is "glowsf"
//   app.sky-sale.com           → no company; the central sign-in
//   sky-sale.com / www         → no company; the marketing site lives elsewhere
//   beauty-production….app     → no company; the original Railway address
//
// The subdomain NAMES a company. It never grants access to one: a session
// signed in as one shop that arrives on another's address is sent back to sign
// in, not quietly switched. Anything else would make the address bar an
// authentication bypass.

const pgDb = require('../db/postgres');

// The domain the shops live under. Set APP_DOMAIN in production.
const appDomain = () => (process.env.APP_DOMAIN || '').toLowerCase().replace(/^\.+|\.+$/g, '');

// Subdomains that are the product itself rather than a shop.
const RESERVED = new Set(['app', 'www', 'admin', 'api', 'mail', 'static', 'assets', 'login']);

function hostOf(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim().split(':')[0].toLowerCase();
}

/** The slug in this request's hostname, or null if it names no shop. */
function slugFromHost(req) {
  const domain = appDomain();
  if (!domain) return null;
  const host = hostOf(req);
  if (!host.endsWith('.' + domain)) return null;
  const sub = host.slice(0, -(domain.length + 1));
  if (!sub || sub.includes('.') || RESERVED.has(sub)) return null;
  return sub;
}

function companyUrl(slug, path = '/pos.html') {
  const domain = appDomain();
  return domain ? `https://${slug}.${domain}${path}` : path;
}

function signInUrl(path = '/') {
  const domain = appDomain();
  return domain ? `https://app.${domain}${path}` : path;
}

/**
 * Attaches `req.tenant` (the company named by the hostname, or null) and keeps
 * a signed-in session from being read on another shop's address.
 *
 * Browsers asking for a page are redirected somewhere useful; API calls get a
 * plain 403, because a redirect in a fetch() reads as a baffling success.
 */
function tenantMiddleware() {
  return async (req, res, next) => {
    req.tenant = null;
    const slug = slugFromHost(req);
    if (!slug) return next();

    try {
      req.tenant = await pgDb.getCompanyBySlug(slug);
    } catch (e) {
      console.error('[tenancy] Could not resolve', slug, e.message);
      return next();
    }

    // An address that names no shop is a typo or a stale bookmark.
    if (!req.tenant) {
      if (req.accepts('html') && req.method === 'GET') return res.redirect(signInUrl('/?unknown=1'));
      return res.status(404).json({ error: 'No such company' });
    }

    const sessionUser = req.session?.userId;
    if (sessionUser && sessionUser !== req.tenant.user_id) {
      // Signed in, but as a different shop. Send them to their own address
      // rather than showing them this one.
      if (req.accepts('html') && req.method === 'GET') {
        let own = '';
        try { own = await pgDb.getCompanySlug(sessionUser); } catch (_) {}
        return res.redirect(own ? companyUrl(own) : signInUrl('/?switch=1'));
      }
      return res.status(403).json({ error: 'This address belongs to a different company.' });
    }

    next();
  };
}

/**
 * Lets one session cookie work across app.sky-sale.com and every shop's
 * address. Scoped to the app domain only — on the Railway hostname the cookie
 * stays host-only, exactly as it is today.
 */
function cookieDomainFor(req) {
  const domain = appDomain();
  if (!domain) return undefined;
  const host = hostOf(req);
  return host === domain || host.endsWith('.' + domain) ? '.' + domain : undefined;
}

module.exports = { slugFromHost, tenantMiddleware, cookieDomainFor, companyUrl, signInUrl, hostOf, appDomain };
