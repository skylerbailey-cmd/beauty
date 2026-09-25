'use strict';

// A small in-memory rate limiter for the public, unauthenticated endpoints.
//
// The signup flow is the first thing on this server anyone on the internet can
// reach without a session. Without a limit, one script can claim every decent
// subdomain on the domain overnight, and the product-import endpoint — which
// makes a paid API call and fetches a URL — becomes a way to spend somebody
// else's money.
//
// In memory on purpose: the counters reset when the server restarts, which on
// Railway is every deploy. That is the right trade for stopping a script,
// which works in minutes, and the wrong tool for a determined attacker, who
// needs the account limits and the review queue instead.

const buckets = new Map();

// Keep the map from growing forever on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 10 * 60 * 1000).unref?.();

function clientKey(req) {
  // Railway sits behind a proxy, so the socket address is the proxy's. Take
  // the first hop of the forwarded chain, which is the one the proxy itself
  // wrote and the only one a client can't forge past.
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {object} opts
 * @param {number} opts.limit   requests allowed per window
 * @param {number} opts.windowMs
 * @param {string} opts.name    so separate endpoints don't share a bucket
 * @param {string} [opts.message]
 */
function rateLimit({ limit, windowMs, name, message }) {
  return (req, res, next) => {
    const key = `${name}:${clientKey(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;

    const remaining = Math.max(0, limit - b.count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (b.count > limit) {
      const seconds = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(seconds));
      return res.status(429).json({
        error: message || `Too many attempts. Try again in ${seconds > 60 ? Math.ceil(seconds / 60) + ' minutes' : seconds + ' seconds'}.`,
        retry_after_seconds: seconds,
      });
    }
    next();
  };
}

/**
 * Take one from a bucket named by something other than the caller's address.
 *
 * Limiting sign-in links by IP alone protects the server and not the person:
 * anyone with a handful of addresses can still march one inbox full of login
 * mail. Limiting by the address being written to closes that, and costs a
 * would-be flooder nothing they can rotate.
 *
 * @returns {{ok: boolean, retryAfterSeconds: number}}
 */
function consume({ name, key, limit, windowMs }) {
  const id = `${name}:${key}`;
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(id, b);
  }
  b.count++;
  return {
    ok: b.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

// Exposed for tests.
function _reset() { buckets.clear(); }

module.exports = { rateLimit, clientKey, consume, _reset };
