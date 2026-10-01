'use strict';
// The Smart Inbox is not part of SkySale.
//
// It read each shop's Gmail, drafted replies with Claude and pushed them to a
// mobile app. All of it is gone: the routes, the Gmail watch, the drafting, the
// push notifications, the mobile app and the inbox screen in the email suite —
// and with it the restricted Gmail permissions (read and manage the mailbox)
// it was the only reason to ask for. SkySale now asks Google only to send.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

console.log('\n── The server ──');
check('no inbox routes', !exists('src/routes/emails.js') && !/\/api\/emails/.test(read('src/index.js')));
check('no Gmail push webhook', !exists('src/routes/webhook.js') && !/app\.use\('\/webhook'/.test(read('src/index.js')));
check('no Gmail watch at startup or sign-in', !/GmailWatch/.test(read('src/index.js')) && !/setupGmailWatch/.test(read('src/routes/auth.js')));
check('no reply drafting, no push notifications', !exists('src/services/claude.js') && !exists('src/services/notifications.js'));
check('nothing left in the Gmail service but connecting', Object.keys(require('../src/services/gmail')).join() === 'createOAuthClient');
check('no push-token endpoint', !/push-token/.test(read('src/routes/auth.js')));
check('and no Expo dependency', !JSON.parse(read('package.json')).dependencies['expo-server-sdk']);

console.log('\n── What Google is asked for ──');
const auth = read('src/routes/auth.js');
const scopes = auth.slice(auth.indexOf('const GMAIL_SCOPES'), auth.indexOf('];', auth.indexOf('const GMAIL_SCOPES')));
check('sending only', /gmail\.send/.test(scopes) && !/gmail\.modify|gmail\.compose|gmail\.readonly/.test(scopes), scopes);

console.log('\n── The screens ──');
const emails = read('web/emails.html');
check('the email suite has no inbox tab, screen or code',
  !/data-tab="inbox"|id="tab-inbox"|Smart Inbox|threadOverlay|\/api\/emails/.test(emails));
check('the old standalone page is gone', !exists('web/inbox.html'));
check('and the mobile app with it', !fs.existsSync(path.join(root, '..', 'mobile')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
