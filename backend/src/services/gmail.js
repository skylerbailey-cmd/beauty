'use strict';

// Google OAuth for connecting a shop's Gmail. SkySale only sends from that
// mailbox (receipts, welcome emails, mass email, alerts — routes/pos.js and
// routes/welcome.js send with the stored refresh token). It used to read it
// too, for the Smart Inbox; that feature and everything here that served it
// were removed.

const { google } = require('googleapis');

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

module.exports = { createOAuthClient };
