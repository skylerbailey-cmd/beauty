'use strict';

// The customer's side of the treatment calendar: the page the Reschedule and
// Cancel buttons in the confirmation email open.
//
// Every route here is PUBLIC — no login, no PIN. The token in the link is the
// only credential, which is why it is 24 random bytes and why these handlers
// answer with the one booking it names and nothing else. In particular: no
// customer list, no other appointments, no staff detail beyond the first name
// already printed in the email.

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const appts = require('../services/appointments');
const { formatAddress } = appts;

// What the customer is allowed to see about their own booking.
function publicView(appt, settings, tz) {
  return {
    token: appt.token,
    status: appt.status,
    customer_name: appt.customer_name,
    treatment_name: appt.treatment_name,
    employee_name: appt.employee_name,
    duration_min: appt.duration_min,
    starts_at: appt.starts_at,
    when: appts.localDateTimeLabel(appt.starts_at, tz),
    past: new Date(appt.starts_at) < new Date(),
    timezone: tz,
    store: {
      name: settings?.store_name || settings?.company_name || '',
      address: formatAddress(settings),
      phone: settings?.store_phone || '',
      email: settings?.store_email || '',
    },
  };
}

// Resolve the token once, for every route below.
async function load(req, res, next) {
  const appt = await pgDb.getAppointmentByToken(req.params.token);
  if (!appt) return res.status(404).json({ error: 'We couldn\'t find that booking. The link may have expired.' });
  req.appt = appt;
  req.settings = await pgDb.getSettings(appt.user_id);
  req.tz = req.settings?.timezone || 'America/Denver';
  next();
}

// ─── GET /api/booking/:token ─────────────────────────────────────────────────

router.get('/:token', load, async (req, res) => {
  res.json({ appointment: publicView(req.appt, req.settings, req.tz) });
});

// ─── GET /api/booking/:token/slots ───────────────────────────────────────────
// The times this customer could move to: their own treatment's length, their
// own specialist, and their current slot excluded so it isn't shown as taken
// by themselves.

router.get('/:token/slots', load, async (req, res) => {
  if (req.appt.status !== 'booked') {
    return res.status(409).json({ error: 'This appointment is already cancelled.' });
  }
  try {
    const result = await appts.availableSlots(req.appt.user_id, {
      durationMin: req.appt.duration_min,
      employeeId: req.appt.employee_id,
      excludeAppointmentId: req.appt.id,
      days: Math.min(60, parseInt(req.query.days, 10) || 30),
    });
    res.json(result);
  } catch (err) {
    console.error('[booking] slots error:', err.message);
    res.status(500).json({ error: 'Could not load available times.' });
  }
});

// ─── POST /api/booking/:token/reschedule ─────────────────────────────────────

router.post('/:token/reschedule', load, async (req, res) => {
  const { start } = req.body || {};
  if (!start || !isFinite(Date.parse(start))) {
    return res.status(400).json({ error: 'Pick a time first.' });
  }
  if (req.appt.status !== 'booked') {
    return res.status(409).json({ error: 'This appointment is already cancelled.' });
  }
  if (new Date(req.appt.starts_at) < new Date()) {
    return res.status(409).json({ error: 'This appointment has already passed. Please call us to book another.' });
  }
  if (new Date(start) < new Date()) {
    return res.status(400).json({ error: 'That time is in the past.' });
  }

  try {
    // Checked again here, not just when the list was drawn: the page may have
    // been open for an hour and somebody else may have taken the slot.
    const hours = await appts.withinOpenHours(req.appt.user_id, start, req.appt.duration_min);
    if (!hours.ok) return res.status(409).json({ error: hours.reason });

    const free = await appts.slotIsFree(req.appt.user_id, start, req.appt.duration_min, req.appt.employee_id, req.appt.id);
    if (!free.free) return res.status(409).json({ error: free.reason });

    const updated = await pgDb.updateAppointment(req.appt.id, { starts_at: new Date(start).toISOString() });
    const mail = await appts.sendAppointmentEmail(req.appt.user_id, updated, 'rescheduled');

    res.json({
      success: true,
      emailed: mail.emailed,
      appointment: publicView(updated, req.settings, req.tz),
    });
  } catch (err) {
    console.error('[booking] reschedule error:', err.message);
    res.status(500).json({ error: 'Could not move the appointment. Please call the store.' });
  }
});

// ─── POST /api/booking/:token/cancel ─────────────────────────────────────────

router.post('/:token/cancel', load, async (req, res) => {
  if (req.appt.status === 'cancelled') {
    // Already done — the second click of a double-click, or a stale tab.
    return res.json({ success: true, alreadyCancelled: true, appointment: publicView(req.appt, req.settings, req.tz) });
  }
  try {
    const updated = await pgDb.cancelAppointment(req.appt.id, 'customer');
    const mail = await appts.sendAppointmentEmail(req.appt.user_id, updated, 'cancelled');
    res.json({
      success: true,
      emailed: mail.emailed,
      appointment: publicView(updated, req.settings, req.tz),
    });
  } catch (err) {
    console.error('[booking] cancel error:', err.message);
    res.status(500).json({ error: 'Could not cancel. Please call the store.' });
  }
});

module.exports = router;
