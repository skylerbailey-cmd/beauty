'use strict';
// The Gmail account a shop sends from must not depend on SQLite.
//
// Glow SF's audit found 30 September off by $1,081.46 and logged "mismatch,
// but no Gmail is connected to send from" — with the shop's Gmail connected
// and its token sitting in Postgres. SQLite is wiped by every redeploy, and
// the lookup gave up when SQLite had no user row at all, instead of reading
// the copy kept in Postgres for exactly that reason. The same lookup sends
// sale texts, receipts, welcome emails and mass email.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

let sqliteUsers = {};
const updated = [];
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  getUser: (id) => (sqliteUsers[id] ? { ...sqliteUsers[id] } : null),
  updateUserTokens: (id, access, refresh) => updated.push([id, refresh]),
} };
const pgDb = require('../src/db/postgres');
let accounts = {};
const saved = [];
pgDb.getGmailAccount = async (id) => accounts[id] || null;
pgDb.saveGmailToken = async (id, rt, email) => saved.push([id, rt, email]);
pgDb.getSettings = async () => ({ store_name: 'Glow SF' });

const { sendingUser } = require('../src/lib/sending-user');

(async () => {
  console.log('\n── After a redeploy wiped SQLite ──');
  accounts = { glow: { refresh_token: 'rt-pg', email: 'hello@glowsf.com' } };
  let u = await sendingUser('glow');
  check('the shop still has a sender, from Postgres', u && u.refresh_token === 'rt-pg' && u.email === 'hello@glowsf.com');
  check('named as the shop', u.company_name === 'Glow SF' && u.id === 'glow');

  console.log('\n── SQLite has the user ──');
  sqliteUsers = { glow: { id: 'glow', email: 'hello@glowsf.com', refresh_token: '', company_name: 'Glow SF' } };
  u = await sendingUser('glow');
  check('a missing token is filled from Postgres', u.refresh_token === 'rt-pg' && updated.some(x => x[1] === 'rt-pg'));
  sqliteUsers.glow.refresh_token = 'rt-old';
  u = await sendingUser('glow');
  check('an old token in SQLite gives way to Postgres’s', u.refresh_token === 'rt-pg');
  accounts = {};
  sqliteUsers.glow.refresh_token = 'rt-only-here';
  u = await sendingUser('glow');
  check('a token only SQLite has is used', u.refresh_token === 'rt-only-here');
  check('and copied to Postgres so the next redeploy cannot lose it', saved.some(x => x[0] === 'glow' && x[1] === 'rt-only-here'));

  console.log('\n── Nothing connected ──');
  sqliteUsers = {};
  check('no Gmail anywhere is still no sender', (await sendingUser('glow')) === null);
  check('and no shop at all is nothing', (await sendingUser('')) === null);

  console.log('\n── Every sender uses it ──');
  const pos = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pos.js'), 'utf8');
  check('the register’s sends (alerts, receipts, welcome and mass email)', /const getSendingUser = \(userId\) => require\('\.\.\/lib\/sending-user'\)\.sendingUser\(userId\)/.test(pos));
  const welcome = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'welcome.js'), 'utf8');
  check('the email suite’s sends and campaigns', (welcome.match(/require\('\.\.\/lib\/sending-user'\)\.sendingUser\(userId\)/g) || []).length === 2
    && !/User not found\. Please sign in again\./.test(welcome));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
