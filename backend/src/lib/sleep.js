'use strict';

// Whether a shop is asleep, and the one refusal every paused thing gives.
//
// A shop asleep (billing.js, the $15 plan) keeps everything and does nothing
// new for its customers: no sales, returns or exchanges, no sessions booked or
// moved, and no email sent to anyone. What it may still do is look, correct,
// export — and call off a session already booked, and tell the customer so: a
// shop going quiet has to be able to cancel the bookings it had.
//
// One check, shared by every route it applies to, so the rule cannot drift
// between the register, the calendar and the several ways a shop sends mail.

const pgDb = require('../db/postgres');
const billing = require('./billing');

async function isAsleep(userId) {
  if (!userId || !billing.configured()) return false;
  const sub = await pgDb.getSubscription(userId).catch(() => null);
  return pgDb.LIVE_SUB_STATUSES.has(sub?.status || '') && sub?.plan === 'sleep';
}

// Express middleware. `what` finishes the sentence "…so ___ are paused".
// `companyOf` finds the shop: the session for the app itself, or something
// the route has already loaded (a customer's booking link).
function refuseWhileAsleep(what, companyOf = (req) => req.session?.userId || req.userId) {
  return async (req, res, next) => {
    try {
      if (await isAsleep(companyOf(req))) {
        return res.status(402).json({
          error: `This shop is asleep, so ${what} are paused. Everything already recorded is still `
            + 'here — a manager can wake it in Settings → Account.',
          asleep: true,
        });
      }
    } catch (_) { /* a failed check never blocks: the till must not stop on a hiccup */ }
    next();
  };
}

module.exports = { isAsleep, refuseWhileAsleep };
