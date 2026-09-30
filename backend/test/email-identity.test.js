'use strict';
// Which address opens which shop.
//
// A company id is a hash of the sign-in address. That makes it stable across
// redeploys — which is the whole point, since SQLite is rebuilt empty on
// every one — but it also makes it literal. To Gmail, glow.sf.santafe@ and
// glowsf.santafe@ are the same inbox; to a hash they are two different
// companies.
//
// So the sign-in link arrives either way, and an owner who types their own
// address with one dot out of place lands in a brand new empty shop with a
// setup wizard, while six months of their sales sit under an id they can no
// longer reach. That happened.
//
// Built on throwaway shops; it reads and writes nothing belonging to anyone.
const DB = process.argv[2] || process.env.DATABASE_URL;
if (!DB) {
  console.log('\n  skipped: pass a connection string, or set DATABASE_URL\n');
  process.exit(0);
}
process.env.DATABASE_URL = DB;
process.env.PGSSLMODE = 'no-verify';

const pgDb = require('../src/db/postgres');
const { Client } = require('pg');

const REAL = 'zz.identity.shop@gmail.com';       // the address a shop was made with
const TYPO = 'zzidentityshop@gmail.com';         // same inbox, dots dropped
const PLUS = 'zz.identity.shop+till@gmail.com';  // same inbox, tagged
const OTHER = 'zz.identity.other@outlook.com';   // a dot that MEANS something
const IDS = [pgDb.companyIdForEmail(REAL), pgDb.companyIdForEmail(TYPO),
  pgDb.companyIdForEmail(PLUS), pgDb.companyIdForEmail(OTHER),
  pgDb.companyIdForEmail('zzidentityother@outlook.com')];

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

(async () => {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cleanup = async () => {
    await c.query('DELETE FROM pos_company_emails WHERE user_id = ANY($1::text[])', [IDS]);
    await c.query('DELETE FROM pos_settings WHERE user_id = ANY($1::text[])', [IDS]);
  };
  await cleanup();

  console.log('\n── The same inbox is the same shop ──');
  const canon = pgDb.canonicalEmail;
  check('dots in a Gmail address mean nothing',
    canon(REAL) === canon(TYPO), `${canon(REAL)} vs ${canon(TYPO)}`);
  check('and neither does a +tag', canon(PLUS) === canon(REAL), canon(PLUS));
  check('capitals mean nothing either',
    canon('ZZ.Identity.Shop@GMail.COM') === canon(REAL));
  check('googlemail is gmail', canon('zzidentityshop@googlemail.com') === canon(REAL));

  console.log('\n── But a dot elsewhere is a real difference ──');
  // Folding these would merge two genuinely different customers into one shop.
  check('an Outlook address keeps its dots',
    canon(OTHER) !== canon('zzidentityother@outlook.com'), canon(OTHER));
  check('though a +tag is still dropped',
    canon('zz.identity.other+x@outlook.com') === canon(OTHER));
  check('and a malformed address is left alone rather than mangled',
    canon('not-an-address') === 'not-an-address');

  console.log('\n── An empty shell is not a shop ──');
  // A mistyped address makes one of these. It must not be mistaken for the
  // real thing, or the typo would win.
  const shellId = pgDb.companyIdForEmail(TYPO);
  await c.query(`INSERT INTO pos_settings (user_id, store_name, slug) VALUES ($1,'','')
    ON CONFLICT (user_id) DO UPDATE SET store_name = '', slug = ''`, [shellId]);
  check('a settings row with no name and no address does not count',
    (await pgDb.companyIsReal(shellId)) === false);

  console.log('\n── Signing in with the address as typed ──');
  const realId = pgDb.companyIdForEmail(REAL);
  await c.query(`INSERT INTO pos_settings (user_id, store_name, slug) VALUES ($1,'ZZ Identity Shop','zzidentity')
    ON CONFLICT (user_id) DO UPDATE SET store_name = 'ZZ Identity Shop', slug = 'zzidentity'`, [realId]);
  await pgDb.rememberCompanyEmail(realId, REAL);
  check('the real shop is real', (await pgDb.companyIsReal(realId)) === true);
  check('the exact address still opens it',
    pgDb.companyIdForEmail(await pgDb.resolveCompanyEmail(REAL)) === realId);

  console.log('\n── And with a dot out of place ──');
  check('the typo finds its way to the same shop',
    pgDb.companyIdForEmail(await pgDb.resolveCompanyEmail(TYPO)) === realId,
    'the typo still lands on an empty shop');
  check('so does a tagged address',
    pgDb.companyIdForEmail(await pgDb.resolveCompanyEmail(PLUS)) === realId);
  check('and it is not fooled by the empty shell sitting at the typo\'s own id',
    (await pgDb.resolveCompanyEmail(TYPO)) === REAL,
    await pgDb.resolveCompanyEmail(TYPO));

  console.log('\n── A genuinely new shop is still new ──');
  const fresh = 'zz.identity.never.seen@gmail.com';
  check('an unknown address resolves to itself',
    (await pgDb.resolveCompanyEmail(fresh)) === fresh);

  console.log('\n── A shop that IS at the typed address keeps it ──');
  // Never move somebody off a shop that is really theirs, even if some other
  // shop recorded a colliding canonical form first.
  const shellReal = pgDb.companyIdForEmail(TYPO);
  await c.query(`UPDATE pos_settings SET store_name = 'ZZ Shell Grown Up', slug = 'zzshell' WHERE user_id = $1`, [shellReal]);
  check('now that it is a real shop, the typed address opens it',
    (await pgDb.resolveCompanyEmail(TYPO)) === TYPO,
    await pgDb.resolveCompanyEmail(TYPO));

  console.log('\n── The first address to claim a shop keeps it ──');
  await pgDb.rememberCompanyEmail(shellReal, TYPO);
  const owner = await c.query('SELECT user_id FROM pos_company_emails WHERE canonical_email = $1',
    [canon(REAL)]);
  check('a second shop cannot take over an address already pointing somewhere',
    owner.rows[0].user_id === realId, owner.rows[0].user_id);

  console.log('\n── Sign-in actually uses it ──');
  const fs = require('fs');
  const path = require('path');
  const loginSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'login.js'), 'utf8');
  // Within the link handler specifically — the demo path above it uses a
  // fixed address and needs no resolving, so a whole-file index comparison
  // says nothing.
  const linkHandler = loginSrc.slice(loginSrc.indexOf("router.get('/link/:token'"));
  check('the address is resolved before the id is derived',
    linkHandler.indexOf('resolveCompanyEmail') > -1
    && linkHandler.indexOf('resolveCompanyEmail') < linkHandler.indexOf('findOrCreateUserByEmail'),
    'resolution must happen first or the wrong id is already in hand');
  // Every place that turns an address into a company has to agree, or one of
  // them sends somebody to a different shop than the others.
  const switchHandler = loginSrc.slice(loginSrc.indexOf("router.post('/switch'"));
  check('switching companies resolves it too',
    switchHandler.indexOf('resolveCompanyEmail') > -1
    && switchHandler.indexOf('resolveCompanyEmail') < switchHandler.indexOf('idForEmail(email)'),
    'a switcher entry holding a variant would be refused for a company already signed in to');
  check('and every sign-in records the address', /rememberCompanyEmail/.test(loginSrc));
  check('a failure there cannot block signing in',
    /try \{ email = await pgDb\.resolveCompanyEmail\(email\); \} catch/.test(loginSrc));

  await cleanup();
  const left = await c.query('SELECT COUNT(*) n FROM pos_settings WHERE user_id = ANY($1::text[])', [IDS]);
  check('nothing left behind', Number(left.rows[0].n) === 0);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
