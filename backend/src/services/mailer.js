'use strict';

// Email the product itself sends, as SkySale — not as any shop.
//
// This is deliberately separate from services/gmail.js, which sends *as a
// shop* using that shop's own connected mailbox. A sign-in link cannot go
// that way: it is sent before anyone has signed in, to someone who may not
// have an account yet, and certainly before any mailbox has been connected.
//
// One rule matters more than the rest: a send that fails must say so. A
// sign-in link that is quietly dropped looks to the person like an inbox that
// is being slow, and they will wait for a message that is never coming.

const nodemailer = require('nodemailer');

// The address shops receive sign-in links from. Gmail refuses to send as an
// address the account does not own, so this is the account the app password
// belongs to.
const from = () => (process.env.PLATFORM_EMAIL || '').trim();
const appPassword = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

function configured() {
  return Boolean(from() && appPassword());
}

let cached = null;
function transport() {
  if (cached) return cached;
  if (!configured()) {
    const e = new Error('Email is not configured on this server.');
    e.status = 503;
    throw e;
  }
  cached = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: from(), pass: appPassword() },
  });
  return cached;
}

/** Does the configured mailbox actually accept us? Used by the health check. */
async function verifyMailer() {
  if (!configured()) {
    return { ok: false, reason: 'PLATFORM_EMAIL or GMAIL_APP_PASSWORD is not set.' };
  }
  try {
    await transport().verify();
    return { ok: true, from: from() };
  } catch (e) {
    // An app password that has been revoked fails here rather than on the
    // first person trying to sign in.
    cached = null;
    return { ok: false, reason: e.message };
  }
}

async function send({ to, subject, text, html }) {
  const info = await transport().sendMail({
    from: `SkySale <${from()}>`,
    to,
    subject,
    text,
    html,
    // Replies to an automated sign-in message are almost always someone asking
    // for help, and they should reach a person rather than bounce.
    replyTo: process.env.SUPPORT_EMAIL || from(),
  });
  return info;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * The sign-in link itself.
 *
 * Written so the plain-text part carries the whole message: plenty of shop
 * inboxes strip HTML, and a mail whose only useful content is inside a styled
 * button is a mail that arrives empty.
 */
async function sendLoginLink({ to, url, isNew, minutes = 60 }) {
  const subject = isNew ? 'Finish setting up SkySale' : 'Your SkySale sign-in link';
  const lead = isNew
    ? 'Here is the link that opens your new SkySale account.'
    : 'Here is the link to sign in to SkySale.';

  const text = [
    lead,
    '',
    url,
    '',
    `It works once, and expires in ${minutes} minutes.`,
    '',
    'If you did not ask for this, you can ignore it — nobody can use the link but you.',
  ].join('\n');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1b1f24;max-width:520px">
  <p style="margin:0 0 18px">${escapeHtml(lead)}</p>
  <p style="margin:0 0 22px">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#2f7fd1;color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600">${isNew ? 'Open my account' : 'Sign in'}</a>
  </p>
  <p style="margin:0 0 18px;color:#5b6570">It works once, and expires in ${minutes} minutes.</p>
  <p style="margin:0 0 6px;color:#5b6570">If the button does nothing, paste this into your browser:</p>
  <p style="margin:0 0 22px;word-break:break-all"><a href="${escapeHtml(url)}" style="color:#2f7fd1">${escapeHtml(url)}</a></p>
  <p style="margin:0;color:#8a929b;font-size:13px">If you did not ask for this, you can ignore it — nobody can use the link but you.</p>
</div>`;

  return send({ to, subject, text, html });
}

module.exports = { send, sendLoginLink, verifyMailer, configured };
