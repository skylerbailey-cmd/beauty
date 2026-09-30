'use strict';

// A cancelled shop's books are kept for 30 days after its subscription stops,
// then deleted — the shop and everything in it, and its subscription record.
//
// "Stops" is when the subscription actually ended, not when Cancel was
// pressed: a shop cancelled mid-month keeps selling to the end of the month it
// paid for, and its 30 days start then. A shop that wants to keep its books
// without trading has sleep, at $15 a month (lib/billing.js).
//
// Seven days before, the account's owner is emailed: what is going, when, and
// how to keep it — start the subscription again, or put the shop to sleep.
// Nothing is deleted until a week after that email, whatever the dates say: a
// shop that stopped long ago (before any of this existed, say) is warned
// first and deleted a week later, never on the run that first notices it.
//
// Deleting is the one thing here that cannot be taken back, so Stripe is asked
// first, every time. The copy in Postgres says "cancelled"; if Stripe says the
// shop is paying again — a webhook that never arrived — it is not deleted, the
// copy is corrected, and nothing else happens. If Stripe cannot be asked,
// nothing is deleted that run.

const pgDb = require('../db/postgres');
const billing = require('../lib/billing');
const mailer = require('./mailer');

const KEEP_DAYS = 30;
const WARN_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

// The later of 30 days after it stopped, and a week after the warning (or,
// before one has gone, a week from now).
function deletesOn(stoppedAt, warnedAt = null, now = new Date()) {
  const keep = new Date(stoppedAt).getTime() + KEEP_DAYS * DAY;
  const notice = new Date(warnedAt || now).getTime() + WARN_DAYS * DAY;
  return new Date(Math.max(keep, notice));
}

// Anything Stripe still counts as a subscription someone is paying for, or
// trying to: past_due and unpaid are a card being retried, not a shop that left.
const STILL_SUBSCRIBED = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);

async function stillSubscribed(row) {
  if (!row.stripe_customer_id) return false;
  const subs = await billing.stripe().subscriptions.list({
    customer: row.stripe_customer_id, status: 'all', limit: 10,
  });
  const live = subs.data.find((s) => STILL_SUBSCRIBED.has(s.status));
  if (live) await pgDb.saveSubscription(row.user_id, billing.summarise(live));
  return !!live;
}

function accountEmail(userId) {
  try { return require('../db').getUser(userId)?.email || ''; } catch (_) { return ''; }
}

async function warn(row, when) {
  const to = accountEmail(row.user_id);
  const settings = await pgDb.getSettings(row.user_id).catch(() => ({}));
  const shop = (settings?.store_name || '').trim() || 'your shop';
  const day = when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const { appDomain } = require('../lib/tenancy');
  const domain = appDomain();
  const link = settings?.slug && domain ? `https://${settings.slug}.${domain}/pos.html#settings` : '';
  if (to) {
    const text = `${shop}'s SkySale subscription has ended, and everything recorded in it will be deleted on ${day}:\n\n`
      + '- every sale, receipt, return and chargeback\n'
      + '- your customer list, their purchases and the emails sent to them\n'
      + '- staff, commission and payroll history\n'
      + '- products, prices, treatments and bookings\n\n'
      + 'This cannot be undone. To keep it, sign in before then and, in Settings → Account, either start the '
      + 'subscription again or put the shop to sleep — $15 a month keeps everything, with no sales taken.\n\n'
      + 'To keep a copy of your own, export your transactions and customers from the Transactions tab.\n'
      + (link ? `\n${link}\n` : '');
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#16242E">`
      + text.split('\n\n').map((p) => p.startsWith('- ')
        ? `<ul>${p.split('\n').map((li) => `<li>${esc(li.slice(2))}</li>`).join('')}</ul>`
        : `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') + '</div>';
    await mailer.send({ to, subject: `${shop}: your SkySale data will be deleted on ${day}`, text, html });
  }
  // Recorded even with no address to send to, so it is not retried hourly.
  await pgDb.saveSubscription(row.user_id, { deletion_warned_at: new Date() });
  return !!to;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function runRetention({ now = new Date() } = {}) {
  const done = { deleted: [], warned: [], kept: [] };
  if (!billing.configured()) return done;

  for (const row of await pgDb.endedSubscriptions()) {
    const when = deletesOn(row.stopped_at, row.deletion_warned_at, now);
    const warnFrom = new Date(when.getTime() - WARN_DAYS * DAY);
    if (now < warnFrom) continue;
    if (now < when && row.deletion_warned_at) continue;
    // Not warned yet means not deleted yet, however long ago it stopped.

    try {
      if (await stillSubscribed(row)) { done.kept.push(row.user_id); continue; }
      if (now < when) {
        await warn(row, when);
        done.warned.push(row.user_id);
        continue;
      }
      const result = await pgDb.deleteCompany(row.user_id);
      await pgDb.deleteSubscriptionRow(row.user_id);
      const rows = Object.values(result.deleted).reduce((a, b) => a + b, 0);
      console.warn(`[retention] Deleted ${result.storeName || row.user_id} (${result.slug || 'no address'}): `
        + `subscription ended ${new Date(row.stopped_at).toISOString().slice(0, 10)}, ${rows} rows`);
      done.deleted.push(row.user_id);
    } catch (err) {
      // Stripe unreachable, a mail that would not send, a delete that rolled
      // back: nothing is lost by trying again next hour.
      console.error(`[retention] ${row.user_id} skipped this run:`, err.message);
    }
  }
  return done;
}

module.exports = { runRetention, deletesOn, KEEP_DAYS, WARN_DAYS };
