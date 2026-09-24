'use strict';

// Treatment calendar: turning a store's weekly hours into bookable slots, and
// telling the customer about the booking.
//
// Everything here works in the STORE's timezone and stores UTC. The server runs
// UTC in production, so a slot worked out with `new Date()` arithmetic lands
// six or seven hours off — the same trap that once emptied the leaderboard
// every evening.

const pgDb = require('../db/postgres');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How far the store's clock is behind UTC at this instant, DST included.
function tzOffset(instant, tz) {
  return new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }))
    - new Date(instant.toLocaleString('en-US', { timeZone: tz }));
}

// "2026-10-03" + "14:30" on the store's clock → the UTC instant it happens at.
function localToUtc(dateStr, timeStr, tz) {
  const asUtc = Date.parse(`${dateStr}T${String(timeStr).padStart(5, '0')}:00Z`);
  if (!isFinite(asUtc)) return null;
  return new Date(asUtc + tzOffset(new Date(asUtc), tz));
}

// The store-local calendar date of an instant, as YYYY-MM-DD.
function localDate(instant, tz) {
  return new Date(instant).toLocaleDateString('en-CA', { timeZone: tz });
}

// Which weekday a store-local date falls on. Read at noon UTC, which is the
// same calendar day everywhere from UTC-11 to UTC+11, so the answer doesn't
// flip for a store that is hours behind.
function weekdayOf(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const minutes = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// "2:30 PM" on the store's clock.
function localTimeLabel(instant, tz) {
  return new Date(instant).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit',
  });
}

// "Friday, October 3, 2026 at 2:30 PM"
function localDateTimeLabel(instant, tz) {
  const d = new Date(instant);
  const date = d.toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return `${date} at ${localTimeLabel(d, tz)}`;
}

// A date and time from the booking form — "2026-10-03T14:30" — carries no
// timezone, so `new Date()` would read it as the SERVER's clock: UTC in
// production, which books the customer six or seven hours out. Anything that
// already states a zone is taken at its word.
function parseStoreInstant(value, tz) {
  const str = String(value || '').trim();
  if (!str) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(str)) {
    const d = new Date(str);
    return isFinite(d) ? d : null;
  }
  const m = str.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/);
  if (!m) {
    const d = new Date(str);
    return isFinite(d) ? d : null;
  }
  return localToUtc(m[1], m[2], tz);
}

// ─── Slots ──────────────────────────────────────────────────────────────────

/**
 * Every start time a treatment of `durationMin` could be booked into.
 *
 * A slot is offered when all of these hold:
 *   • the weekday is open and the whole treatment fits inside that day's hours
 *   • the date isn't a one-off closure
 *   • it starts far enough ahead (the lead time)
 *   • the store has a free pair of hands — fewer overlapping bookings than
 *     people on the roster
 *   • and, when the booking is for a named specialist, that specialist isn't
 *     already with someone else
 *
 * @returns {Array<{start: string, end: string, label: string, date: string}>}
 */
async function availableSlots(userId, opts = {}) {
  const settings = await pgDb.getSettings(userId);
  const tz = settings?.timezone || 'America/Denver';
  const step = Math.max(5, parseInt(opts.stepMin ?? settings?.booking_slot_step, 10) || 30);
  const leadHours = opts.leadHours ?? (parseInt(settings?.booking_lead_hours, 10) || 0);
  const duration = Math.max(5, parseInt(opts.durationMin, 10) || 60);
  const days = Math.min(120, Math.max(1, parseInt(opts.days, 10) || 30));
  const employeeId = opts.employeeId ? Number(opts.employeeId) : null;
  const excludeId = opts.excludeAppointmentId ? Number(opts.excludeAppointmentId) : null;

  const now = new Date();
  const fromDate = opts.fromDate || localDate(now, tz);
  const earliest = new Date(now.getTime() + leadHours * 3600 * 1000);

  const [availability, closed, capacity] = await Promise.all([
    pgDb.getAvailability(userId),
    pgDb.getClosedDates(userId),
    pgDb.bookingCapacity(userId),
  ]);
  const byWeekday = new Map(availability.map(a => [a.weekday, a]));
  const closedSet = new Set(closed.map(c => c.closed_on));

  // One window covering the whole search, so this is a single query however
  // many days are asked for.
  const windowStart = localToUtc(fromDate, '00:00', tz);
  const windowEnd = localToUtc(addDays(fromDate, days + 1), '00:00', tz);
  const booked = (await pgDb.getBookedAppointments(userId, windowStart.toISOString(), windowEnd.toISOString()))
    .filter(b => b.id !== excludeId)
    .map(b => ({
      employee_id: b.employee_id,
      from: new Date(b.starts_at).getTime(),
      to: new Date(b.starts_at).getTime() + (b.duration_min || 60) * 60000,
    }));

  const slots = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    if (closedSet.has(date)) continue;
    const day = byWeekday.get(weekdayOf(date));
    if (!day || !day.open) continue;

    const openMin = minutes(day.start_time);
    const closeMin = minutes(day.end_time);
    if (closeMin <= openMin) continue;

    for (let m = openMin; m + duration <= closeMin; m += step) {
      const start = localToUtc(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, tz);
      if (!start || start < earliest) continue;
      const from = start.getTime();
      const to = from + duration * 60000;

      const overlapping = booked.filter(b => b.from < to && b.to > from);
      if (overlapping.length >= capacity) continue;
      if (employeeId && overlapping.some(b => b.employee_id === employeeId)) continue;

      slots.push({
        start: start.toISOString(),
        end: new Date(to).toISOString(),
        date,
        time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        label: localTimeLabel(start, tz),
      });
    }
  }
  return { slots, timezone: tz, capacity, duration_min: duration };
}

// Would this exact booking collide with something? Asked again at the moment a
// booking is saved, because the slot list the customer is looking at may be
// minutes old and somebody else may have taken it in between.
async function slotIsFree(userId, startIso, durationMin, employeeId, excludeAppointmentId) {
  const from = new Date(startIso).getTime();
  const to = from + (durationMin || 60) * 60000;
  const pad = 12 * 3600 * 1000;
  const [booked, capacity] = await Promise.all([
    pgDb.getBookedAppointments(userId, new Date(from - pad).toISOString(), new Date(to + pad).toISOString()),
    pgDb.bookingCapacity(userId),
  ]);
  const overlapping = booked
    .filter(b => b.id !== Number(excludeAppointmentId))
    .map(b => ({
      employee_id: b.employee_id,
      from: new Date(b.starts_at).getTime(),
      to: new Date(b.starts_at).getTime() + (b.duration_min || 60) * 60000,
    }))
    .filter(b => b.from < to && b.to > from);

  if (employeeId && overlapping.some(b => b.employee_id === Number(employeeId))) {
    return { free: false, reason: 'That specialist is already booked at that time.' };
  }
  if (overlapping.length >= capacity) {
    return { free: false, reason: 'That time has just been taken.' };
  }
  return { free: true };
}

// Is this start time inside the store's opening hours at all? Staff booking
// from the register are allowed to sit outside the offered grid — someone asks
// for 3:15 and you say yes — but not on a day the store is shut.
async function withinOpenHours(userId, startIso, durationMin) {
  const settings = await pgDb.getSettings(userId);
  const tz = settings?.timezone || 'America/Denver';
  const date = localDate(startIso, tz);
  const closed = await pgDb.getClosedDates(userId);
  if (closed.some(c => c.closed_on === date)) return { ok: false, reason: 'The store is closed that day.' };

  const availability = await pgDb.getAvailability(userId);
  const day = availability.find(a => a.weekday === weekdayOf(date));
  if (!day || !day.open) return { ok: false, reason: `The store is closed on ${DAY_NAMES[weekdayOf(date)]}s.` };

  const open = localToUtc(date, day.start_time, tz).getTime();
  const close = localToUtc(date, day.end_time, tz).getTime();
  const from = new Date(startIso).getTime();
  const to = from + (durationMin || 60) * 60000;
  if (from < open || to > close) {
    return { ok: false, reason: `That runs outside ${day.start_time}–${day.end_time}.` };
  }
  return { ok: true };
}

// ─── The customer's email ───────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Where the reschedule/cancel links point. Railway hands the deployed host in
// an env var; APP_URL overrides it for anywhere else.
function appBaseUrl() {
  const explicit = process.env.APP_URL || process.env.PUBLIC_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

function manageUrl(token, action) {
  return `${appBaseUrl()}/appointment.html?t=${encodeURIComponent(token)}${action ? `&action=${action}` : ''}`;
}

// "208 B West San Francisco Street, Santa Fe, NM 87501" — the same shape the
// receipts print, so the two don't disagree about the same shop.
function formatAddress(settings) {
  const street = (settings?.store_address || '').trim();
  const cityState = [settings?.store_city, settings?.store_state].filter(Boolean).join(', ');
  const cityStateZip = (cityState + (settings?.store_zip ? ' ' + settings.store_zip : '')).trim();
  return [street, cityStateZip].filter(Boolean).join(', ');
}

const ACCENT = '#1F6FB2';
const ACCENT_DEEP = '#0F4C81';
const CREAM = '#F5F8FB';
const BORDER = '#CBDCE9';
const DARK = '#16242E';
const MID = '#4A6478';

// Buttons are table cells with a background colour rather than styled <a>s:
// Outlook ignores padding on an anchor and the button collapses to bare text.
function button(href, label, fill, textColor) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;margin:0 6px">
    <tr><td align="center" bgcolor="${fill}" style="border-radius:8px;border:1.5px solid ${fill === '#FFFFFF' ? BORDER : fill}">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:${textColor};text-decoration:none">${esc(label)}</a>
    </td></tr></table>`;
}

/**
 * @param {'confirmed'|'rescheduled'|'cancelled'} kind
 */
function appointmentEmailHtml(kind, appt, settings, tz) {
  const store = settings?.store_name || settings?.company_name || 'Our studio';
  const address = formatAddress(settings);
  const contact = [settings?.store_phone, settings?.store_email].filter(Boolean).join('  ·  ');
  const when = localDateTimeLabel(appt.starts_at, tz);
  const cancelled = kind === 'cancelled';

  const heading = cancelled ? 'Your appointment is cancelled'
    : kind === 'rescheduled' ? 'Your appointment has moved'
    : 'Your appointment is confirmed';
  const intro = cancelled
    ? `We've cancelled the session below. Nothing further is needed — if you'd like to come in another time, just give us a call and we'll find you a slot.`
    : kind === 'rescheduled'
    ? `Your session has been moved. Here are the new details:`
    : `Thank you for booking with ${esc(store)}. We're looking forward to seeing you.`;

  const rows = [
    ['When', when],
    appt.treatment_name ? ['Treatment', appt.treatment_name] : null,
    appt.employee_name ? ['With', appt.employee_name] : null,
    appt.duration_min ? ['Length', `${appt.duration_min} minutes`] : null,
    address ? ['Where', address] : null,
  ].filter(Boolean).map(([k, v]) => `
    <tr>
      <td style="padding:9px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;color:${MID};width:110px;vertical-align:top">${esc(k)}</td>
      <td style="padding:9px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;color:${DARK};font-weight:600">${esc(v)}</td>
    </tr>`).join('');

  const actions = cancelled ? '' : `
    <tr><td align="center" style="padding:26px 30px 6px">
      ${button(manageUrl(appt.token, 'reschedule'), 'Reschedule', ACCENT, '#FFFFFF')}
      ${button(manageUrl(appt.token, 'cancel'), 'Cancel', '#FFFFFF', ACCENT_DEEP)}
    </td></tr>
    <tr><td align="center" style="padding:0 30px 4px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;color:${MID}">
      Both buttons open your booking — nothing changes until you confirm it there.
    </td></tr>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${CREAM}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid ${BORDER};border-radius:14px;overflow:hidden">
      <tr><td style="padding:30px 30px 0">
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:${ACCENT_DEEP}">${esc(store)}</div>
        <div style="height:3px;width:46px;background:${ACCENT};margin:12px 0 0;border-radius:2px"></div>
      </td></tr>
      <tr><td style="padding:22px 30px 0">
        <div style="font-family:Georgia,serif;font-size:19px;color:${DARK};margin-bottom:10px">${esc(heading)}</div>
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:${MID}">${intro}</div>
      </td></tr>
      <tr><td style="padding:18px 30px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};border:1px solid ${BORDER};border-radius:10px;padding:6px 18px${cancelled ? ';opacity:.75' : ''}">
          ${rows}
        </table>
      </td></tr>
      ${actions}
      <tr><td style="padding:26px 30px 30px">
        <div style="border-top:1px solid ${BORDER};padding-top:16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.7;color:${MID}">
          ${esc(store)}${address ? `<br>${esc(address)}` : ''}${contact ? `<br>${esc(contact)}` : ''}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Send the customer their confirmation.
 *
 * Deliberately does NOT go through services/gmail.js: that reads the account
 * from SQLite, which Railway wipes on every deploy, and the public reschedule
 * page has no session to fall back on. The refresh token and the sending
 * address both come from Postgres instead.
 *
 * Never throws. A booking that saved but couldn't be emailed is still a real
 * booking — the caller reports `emailed: false` and staff can resend.
 */
async function sendAppointmentEmail(userId, appt, kind) {
  const to = String(appt.customer_email || '').trim();
  if (!to) return { emailed: false, reason: 'No email address on the booking' };

  try {
    const [account, settings] = await Promise.all([
      pgDb.getGmailAccount(userId),
      pgDb.getSettings(userId),
    ]);
    if (!account?.refresh_token) {
      return { emailed: false, reason: 'Gmail is not connected for this store' };
    }

    const tz = settings?.timezone || 'America/Denver';
    const store = settings?.store_name || settings?.company_name || 'Appointments';
    const subject = kind === 'cancelled'
      ? `Cancelled: your appointment at ${store}`
      : kind === 'rescheduled'
      ? `Updated: your appointment at ${store}`
      : `Your appointment at ${store} — ${localDateTimeLabel(appt.starts_at, tz)}`;

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: account.refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const from = account.email || settings?.store_email || '';
    const body = appointmentEmailHtml(kind, appt, settings, tz);
    const raw = [
      `From: "${store}" <${from}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ].join('\r\n');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: Buffer.from(raw).toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      },
    });

    // Same log the welcome emails land in, so the Sent tab shows the whole
    // picture of what a customer has been sent.
    try {
      await pgDb.logSentEmail({
        user_id: userId, to_email: to, to_name: appt.customer_name || '',
        subject, body, kind: `appointment-${kind}`,
      });
    } catch (_) { /* logging must never sink a sent email */ }

    return { emailed: true };
  } catch (err) {
    console.error('[appointments] Email failed:', err.message);
    return { emailed: false, reason: err.message };
  }
}

module.exports = {
  availableSlots,
  slotIsFree,
  withinOpenHours,
  sendAppointmentEmail,
  appointmentEmailHtml,
  localDate,
  localDateTimeLabel,
  localTimeLabel,
  localToUtc,
  parseStoreInstant,
  weekdayOf,
  appBaseUrl,
  manageUrl,
  formatAddress,
  DAY_NAMES,
};
