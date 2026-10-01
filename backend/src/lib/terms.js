'use strict';

// Which Terms of Service & EULA and Privacy Policy are in force, and whether a
// shop has agreed to them.
//
// A shop agrees once when it is created — a box ticked on the first setup
// step, refused by the server without it — and again whenever TERMS_VERSION
// moves on, through a screen on the register that a manager accepts with
// their name and PIN. Each acceptance is kept: which shop, the account's
// email, who accepted, which version, when, and from where. That record is
// the point — a notice beside a button is evidence of nothing.
//
// Bump TERMS_VERSION, to the date at the top of the published pages, only for
// a change that matters; the terms promise 30 days' email notice before such a
// change takes effect, and every shop will be asked to accept it again.

const pgDb = require('../db/postgres');

const TERMS_VERSION = '2026-09-30';
const TERMS_URL = 'https://sky-sale.com/terms.html';
const PRIVACY_URL = 'https://sky-sale.com/privacy.html';

// Shops that are never asked: the owner's own, which are not customers of
// the service they run on. Named by address in TERMS_EXEMPT_SLUGS, so it holds
// across every future version without a fake acceptance on record.
const exemptSlugs = () => String(process.env.TERMS_EXEMPT_SLUGS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function isExempt(userId) {
  const list = exemptSlugs();
  if (!userId || !list.length) return false;
  const settings = await pgDb.getSettings(userId).catch(() => null);
  return list.includes(String(settings?.slug || '').toLowerCase());
}

async function hasAccepted(userId) {
  if (!userId) return false;
  const last = await pgDb.latestTermsAcceptance(userId);
  return last?.version === TERMS_VERSION;
}

// Where the request came from, for the record. The first X-Forwarded-For
// entry is the client; the app trusts its proxy for this already.
function clientIp(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || '';
}

async function recordAcceptance(req, userId, acceptedBy) {
  let email = '';
  try { email = require('../db').getUser(userId)?.email || ''; } catch (_) {}
  await pgDb.recordTermsAcceptance({
    userId,
    email,
    version: TERMS_VERSION,
    acceptedBy: String(acceptedBy || '').slice(0, 120),
    ip: clientIp(req).slice(0, 64),
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300),
  });
}

const describeTerms = (accepted) => ({
  version: TERMS_VERSION, accepted: !!accepted, terms_url: TERMS_URL, privacy_url: PRIVACY_URL,
});

module.exports = { TERMS_VERSION, TERMS_URL, PRIVACY_URL, hasAccepted, isExempt, recordAcceptance, describeTerms, clientIp };
