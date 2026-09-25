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

// Two ways to send, tried in that order.
//
// OAuth first, because it is the credential this server already holds and
// keeps working: a refresh token is tied to an account that can tell us its
// own address, so nothing has to be configured twice and nothing can drift
// out of agreement with itself. An app password, by contrast, is a bare
// secret with no way to ask who it belongs to — name the wrong sender beside
// it and Gmail simply answers "username and password not accepted", which is
// indistinguishable from a revoked password.
//
// SMTP stays as the fallback for a deployment that has an app password and no
// OAuth client.

const refreshToken = () => (process.env.PLATFORM_GMAIL_REFRESH_TOKEN
  || process.env.GLOW_GMAIL_REFRESH_TOKEN || '').trim();
const hasOAuth = () => Boolean(
  refreshToken() && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

// The address shops receive sign-in links from. Under OAuth this is
// discovered from the account itself; PLATFORM_EMAIL only overrides it.
let discovered = null;
const from = () => (process.env.PLATFORM_EMAIL || '').trim() || discovered || '';
const appPassword = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

function configured() {
  return hasOAuth() || Boolean(from() && appPassword());
}

function gmailClient() {
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials({ refresh_token: refreshToken() });
  return google.gmail({ version: 'v1', auth });
}

/** Ask the account who it is, so the From line cannot disagree with it. */
async function senderAddress() {
  if (process.env.PLATFORM_EMAIL) return process.env.PLATFORM_EMAIL.trim();
  if (discovered) return discovered;
  const res = await gmailClient().users.getProfile({ userId: 'me' });
  discovered = res.data.emailAddress;
  return discovered;
}

const b64url = (s) => Buffer.from(s).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sendViaOAuth({ to, subject, text, html }) {
  const address = await senderAddress();
  // multipart/alternative: plenty of shop inboxes strip HTML, and a sign-in
  // mail whose only content is a styled button arrives empty.
  const boundary = 'skysale-' + Math.random().toString(36).slice(2);
  const raw = [
    `From: "SkySale" <${address}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Reply-To: ${process.env.SUPPORT_EMAIL || address}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  await gmailClient().users.messages.send({
    userId: 'me',
    requestBody: { raw: b64url(raw) },
  });
  return { messageId: 'gmail' };
}

let cached = null;
function transport() {
  if (cached) return cached;
  // Specifically the SMTP credentials — configured() is also true when only
  // OAuth is set up, and building a transport with an empty password would
  // fail far away from here with a confusing message.
  if (!(from() && appPassword())) {
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
    return {
      ok: false,
      reason: 'Neither a Gmail refresh token nor PLATFORM_EMAIL + GMAIL_APP_PASSWORD is set.',
    };
  }
  if (hasOAuth()) {
    try {
      return { ok: true, via: 'oauth', from: await senderAddress() };
    } catch (e) {
      // A refresh token that has been revoked fails here rather than on the
      // first shop trying to sign in. Fall through to SMTP if there is one.
      if (!(from() && appPassword())) return { ok: false, reason: 'OAuth: ' + e.message };
    }
  }
  try {
    await transport().verify();
    return { ok: true, via: 'smtp', from: from() };
  } catch (e) {
    cached = null;
    return { ok: false, reason: 'SMTP: ' + e.message };
  }
}

async function send({ to, subject, text, html }) {
  if (hasOAuth()) {
    try {
      return await sendViaOAuth({ to, subject, text, html });
    } catch (e) {
      console.warn('[mail] OAuth send failed, trying SMTP:', e.message);
      if (!(from() && appPassword())) throw e;
    }
  }
  return transport().sendMail({
    from: `SkySale <${from()}>`,
    to,
    subject,
    text,
    html,
    // Replies to an automated sign-in message are almost always someone asking
    // for help, and they should reach a person rather than bounce.
    replyTo: process.env.SUPPORT_EMAIL || from(),
  });
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
