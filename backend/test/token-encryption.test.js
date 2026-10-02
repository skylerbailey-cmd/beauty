'use strict';
// Gmail refresh tokens are encrypted at rest. A copy of the database alone
// can't be used to get into a shop's mailbox; the key lives only in the
// environment (TOKEN_ENCRYPTION_KEY). Without a key, nothing changes.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const KEY = crypto.randomBytes(32).toString('base64');
const TOKEN = '1//0gFakeRefreshToken-abcdefghijklmnopqrstuvwxyz0123456789';

(async () => {
  console.log('\n── Without a key ──');
  delete process.env.TOKEN_ENCRYPTION_KEY;
  const secrets = require('../src/lib/secrets');
  check('nothing is encrypted', secrets.seal(TOKEN) === TOKEN && !secrets.enabled());
  check('plain values read back as they are', secrets.open(TOKEN) === TOKEN);

  console.log('\n── With a key ──');
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  const sealed = secrets.seal(TOKEN);
  check('the stored form is marked and unreadable', sealed.startsWith('enc:v1:') && !sealed.includes(TOKEN.slice(5, 20)), sealed);
  check('it opens back to the token', secrets.open(sealed) === TOKEN);
  check('the same token seals differently each time', secrets.seal(TOKEN) !== sealed);
  check('sealing twice leaves it alone', secrets.seal(sealed) === sealed);
  check('empty stays empty', secrets.seal(null) === null && secrets.seal('') === '');
  check('a token from before encryption still reads', secrets.open(TOKEN) === TOKEN);
  const tampered = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  check('an altered value is refused, not misread', secrets.open(tampered) === null);
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  check('the wrong key opens nothing', secrets.open(sealed) === null);
  delete process.env.TOKEN_ENCRYPTION_KEY;
  check('nor does no key', secrets.open(sealed) === null);
  process.env.TOKEN_ENCRYPTION_KEY = 'too-short';
  check('a malformed key is not used', !secrets.enabled() && secrets.seal(TOKEN) === TOKEN);
  process.env.TOKEN_ENCRYPTION_KEY = KEY;

  console.log('\n── The SQLite account record ──');
  let sqliteOk = true;
  // Loading the module isn't enough — it binds lazily — so open one.
  try { new (require('better-sqlite3'))(':memory:').close(); } catch (_) { sqliteOk = false; }
  if (!sqliteOk) {
    console.log('  skipped: better-sqlite3 does not load on this Node');
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skysale-tok-'));
    process.env.DATABASE_PATH = path.join(tmp, 'test.db');
    const db = require('../src/db');
    db.saveUser({ id: 'u-tok', email: 'shop@example.com', access_token: 'ya29.access', refresh_token: TOKEN });
    const raw = db.db.prepare('SELECT access_token, refresh_token FROM users WHERE id = ?').get('u-tok');
    check('both tokens are stored encrypted', secrets.isSealed(raw.refresh_token) && secrets.isSealed(raw.access_token), JSON.stringify(raw));
    check('and read back plain', db.getUser('u-tok').refresh_token === TOKEN && db.getUserByEmail('shop@example.com').access_token === 'ya29.access');
    db.updateUserTokens('u-tok', 'ya29.new', null);
    const after = db.getUser('u-tok');
    check('a new access token alone keeps the refresh token', after.access_token === 'ya29.new' && after.refresh_token === TOKEN);
  }

  console.log('\n── Postgres ──');
  const DB = process.env.DATABASE_URL;
  if (!DB) {
    console.log('  skipped: set DATABASE_URL for the database half');
  } else {
    const pg = require('../src/db/postgres');
    await pg.initSchema();
    const q = (s, p) => pg.pool.query(s, p).then(r => r.rows);
    const SHOP = 'zz-token-shop', OLD = 'zz-token-old';
    await q('DELETE FROM pos_gmail_tokens WHERE user_id = ANY($1::text[])', [[SHOP, OLD]]);
    await pg.saveGmailToken(SHOP, TOKEN, 'shop@example.com');
    const [row] = await q('SELECT refresh_token FROM pos_gmail_tokens WHERE user_id = $1', [SHOP]);
    check('saved encrypted', secrets.isSealed(row.refresh_token) && !row.refresh_token.includes(TOKEN.slice(5, 20)));
    check('read back plain', await pg.getGmailToken(SHOP) === TOKEN);
    check('the sending account reads plain too', (await pg.getGmailAccount(SHOP)).refresh_token === TOKEN);
    // One stored in plain text before encryption existed.
    await q(`INSERT INTO pos_gmail_tokens (user_id, refresh_token, email) VALUES ($1, $2, 'old@example.com')`, [OLD, TOKEN]);
    check('an old plain token still works before it is converted', await pg.getGmailToken(OLD) === TOKEN);
    const n = await pg.sealGmailTokens();
    const [old] = await q('SELECT refresh_token FROM pos_gmail_tokens WHERE user_id = $1', [OLD]);
    check('the start-up pass encrypts it in place', n >= 1 && secrets.isSealed(old.refresh_token));
    check('and it still works', await pg.getGmailToken(OLD) === TOKEN);
    check('running it again changes nothing', await pg.sealGmailTokens() === 0);
    await q('DELETE FROM pos_gmail_tokens WHERE user_id = ANY($1::text[])', [[SHOP, OLD]]);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
