'use strict';
// A shop agrees to the Terms of Service & EULA before its account exists, and
// again whenever the terms change — and each agreement is recorded.
//
// New shop: a box on the first setup step, unticked, that Continue waits for;
// the server refuses to create the shop without it and records who agreed
// (the verified email creating the account), which version, when and from
// where.
//
// Shop already trading: a screen on the register, with no way past it but a
// manager or admin accepting with their name and PIN — or signing out. The
// demonstration shop is never asked.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const settle = () => new Promise(r => setTimeout(r, 30));
const stub = (mod, exportsObj) => {
  const p = require.resolve(mod);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
};

// ── Fakes ──
process.env.DEMO_EMAIL = 'test@demo.com';
const USERS = { u1: { id: 'u1', email: 'owner@glowsf.com' }, demo: { id: 'demo', email: 'test@demo.com' } };
stub('../src/db', { getUser: (id) => USERS[id] || null, findOrCreateUserByEmail: () => ({ user: USERS.u1 }) });
const pgDb = require('../src/db/postgres');
let acceptances = [];
let saved = null;
pgDb.recordTermsAcceptance = async (r) => { acceptances.push({ ...r, accepted_at: new Date() }); };
pgDb.latestTermsAcceptance = async (u) => [...acceptances].reverse().find(a => a.userId === u) || null;
pgDb.getCompanyBySlug = async () => null;
pgDb.updateSettings = async (u, s) => { saved = s; };
pgDb.getSettings = async () => ({});
pgDb.getEmployees = async () => [];
pgDb.getCustomProducts = async () => [];
pgDb.countTransactions = async () => 0;
const EMPLOYEES = { '9999': { id: 1, name: 'Mia', role: 'manager' }, '1111': { id: 2, name: 'Bo', role: 'sales' }, '7777': { id: 3, name: 'Ana', role: 'admin' } };
pgDb.verifyEmployeePin = async (pin) => EMPLOYEES[pin] || null;

const terms = require('../src/lib/terms');
const signupRoutes = require('../src/routes/signup');
const loginRoutes = require('../src/routes/login');

const route = (router, method, p) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]).route;
const call = async (router, p, body = {}, { method = 'post', userId = 'u1', headers = {} } = {}) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  const req = { session: { userId }, body, headers: { 'user-agent': 'TestBrowser/1', ...headers }, ip: '10.0.0.1', socket: {} };
  const stack = route(router, method, p).stack;
  for (let i = 0; i < stack.length; i++) {
    let went = false;
    await stack[i].handle(req, res, () => { went = true; });
    if (!went && i < stack.length - 1) break;
  }
  return res;
};
const SHOP = { store_name: 'Glow SF', slug: 'glowsf', tax_rate: 0.08, timezone: 'America/New_York' };

(async () => {
  console.log('\n── A new shop agrees before it exists ──');
  let r = await call(signupRoutes, '/shop', { ...SHOP });
  check('without the box ticked, the shop is not created', r.code === 400 && r.body.field === 'terms' && saved === null);
  r = await call(signupRoutes, '/shop', { ...SHOP, accept_terms: '2020-01-01' });
  check('agreeing to some other version does not count', r.code === 400 && saved === null && !acceptances.length);
  r = await call(signupRoutes, '/shop', { ...SHOP, accept_terms: terms.TERMS_VERSION },
    { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' } });
  check('ticked, it is created', r.code === 200 && saved && saved.store_name === 'Glow SF');
  const a = acceptances[0];
  check('and the agreement is recorded: shop, email and version',
    a && a.userId === 'u1' && a.email === 'owner@glowsf.com' && a.version === terms.TERMS_VERSION);
  check('who, and from where', a.acceptedBy === 'account owner, at signup' && a.ip === '203.0.113.7' && a.userAgent === 'TestBrowser/1');
  saved = null;
  r = await call(signupRoutes, '/shop', { ...SHOP, store_name: 'Glow South Florida' });
  check('coming back to edit the shop does not ask again', r.code === 200 && saved.store_name === 'Glow South Florida' && acceptances.length === 1);
  r = await call(signupRoutes, '/state', {}, { method: 'get' });
  check('the setup page is told it has been agreed', r.body.terms.accepted === true && r.body.terms.version === terms.TERMS_VERSION);

  console.log('\n── A shop already trading ──');
  acceptances = [{ userId: 'u1', version: '2026-01-01' }];
  r = await call(loginRoutes, '/terms', {}, { method: 'get' });
  check('an older agreement is not the current one', r.body.accepted === false && r.body.version === terms.TERMS_VERSION);
  check('and the screen is told where the documents are', r.body.terms_url === 'https://sky-sale.com/terms.html' && r.body.privacy_url === 'https://sky-sale.com/privacy.html');
  check('a stale page cannot accept a version it never showed',
    (await call(loginRoutes, '/terms/accept', { version: '2026-01-01', name: 'Mia', pin: '9999' })).code === 409);
  check('no PIN — refused', (await call(loginRoutes, '/terms/accept', { version: terms.TERMS_VERSION, name: 'Mia' })).code === 403);
  check('a sales employee — refused', (await call(loginRoutes, '/terms/accept', { version: terms.TERMS_VERSION, name: 'Bo', pin: '1111' })).code === 403);
  check('a manager’s PIN under someone else’s name — refused', (await call(loginRoutes, '/terms/accept', { version: terms.TERMS_VERSION, name: 'Bo', pin: '9999' })).code === 403);
  check('and none of that was recorded', acceptances.length === 1);
  r = await call(loginRoutes, '/terms/accept', { version: terms.TERMS_VERSION, name: 'mia', pin: '9999' });
  check('a manager accepts for the shop', r.code === 200 && r.body.accepted === true);
  check('recorded with who it was', acceptances[1].acceptedBy === 'Mia (manager)' && acceptances[1].version === terms.TERMS_VERSION);
  check('and from then on it is accepted', (await call(loginRoutes, '/terms', {}, { method: 'get' })).body.accepted === true);
  r = await call(loginRoutes, '/terms', {}, { method: 'get', userId: 'demo' });
  check('the demonstration shop is never asked', r.body.exempt === true && r.body.accepted === true);
  process.env.TERMS_EXEMPT_SLUGS = 'glowsf, DesertWellness';
  acceptances = [];
  pgDb.getSettings = async (u) => ({ u1: { slug: 'desertwellness' }, u3: { slug: 'someshop' } })[u] || {};
  r = await call(loginRoutes, '/terms', {}, { method: 'get' });
  check('a shop named in TERMS_EXEMPT_SLUGS is not asked', r.body.exempt === true && r.body.accepted === true);
  check('and nothing is recorded as if it had agreed', acceptances.length === 0);
  r = await call(loginRoutes, '/terms', {}, { method: 'get', userId: 'u3' });
  check('any other shop still is', r.body.exempt === false && r.body.accepted === false);
  delete process.env.TERMS_EXEMPT_SLUGS;
  pgDb.getSettings = async () => ({});
  check('when a shop is deleted, its agreements go with it',
    /'pos_terms_acceptances'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'postgres.js'), 'utf8').split('const OWNED_BY_USER')[1].split('];')[0]));

  // ── The setup page ──
  console.log('\n── On the setup page ──');
  const signupHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'signup.html'), 'utf8');
  const posted = [];
  let termsAccepted = false;
  const sdom = new JSDOM(signupHtml, { url: 'https://app.sky-sale.com/signup.html', runScripts: 'dangerously',
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        if (opts.body) posted.push({ url: String(url), body: JSON.parse(opts.body) });
        const state = { email: 'owner@glowsf.com', shop: {}, done: {}, counts: {},
          terms: { version: terms.TERMS_VERSION, accepted: termsAccepted, terms_url: terms.TERMS_URL, privacy_url: terms.PRIVACY_URL } };
        return Promise.resolve({ ok: true, status: 200, json: async () => (/\/state/.test(url) ? state : { ok: true, available: true }) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {};
      for (const k of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(w, k, { value: { store: {}, getItem(x) { return this.store[x] ?? null; }, setItem(x, v) { this.store[x] = v; }, removeItem(x) { delete this.store[x]; } } });
      }
    } });
  const sw = sdom.window;
  await new Promise(res => setTimeout(res, 300));
  const sid = (x) => sw.document.getElementById(x);
  check('the first step shows the box, unticked', !!sid('agreeTerms') && !sid('agreeTerms').checked);
  check('linking both documents', !!sid('card').querySelector('a[href="https://sky-sale.com/terms.html"]') && !!sid('card').querySelector('a[href="https://sky-sale.com/privacy.html"]'));
  check('and Continue waits for it', sid('go').disabled === true);
  sid('agreeTerms').checked = true;
  sid('agreeTerms').dispatchEvent(new sw.Event('change'));
  check('ticking it lets Continue go', sid('go').disabled === false);
  sid('storeName').value = 'Glow SF'; sid('slug').value = 'glowsf'; sid('tax').value = '8';
  sid('go').click();
  await settle();
  const shopPost = posted.find(p => /\/shop/.test(p.url));
  check('and the agreement goes with the shop', shopPost && shopPost.body.accept_terms === terms.TERMS_VERSION);
  termsAccepted = true;
  sw.eval('state.terms.accepted = true; step = 1; render();');
  check('once agreed, the box is not shown again', !sid('agreeTerms') && sid('go').disabled === false);

  // ── The register ──
  console.log('\n── On the register ──');
  const posHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  let termsReply = { ok: true, body: { version: terms.TERMS_VERSION, accepted: false, exempt: false, terms_url: terms.TERMS_URL, privacy_url: terms.PRIVACY_URL } };
  let acceptReply = { ok: false, body: { error: 'A manager or admin needs to accept for the shop. Enter their name and PIN.' } };
  const accepts = [];
  const pdom = new JSDOM(posHtml, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        if (/auth\/terms\/accept/.test(url)) { accepts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: acceptReply.ok, json: async () => acceptReply.body }); }
        if (/auth\/terms/.test(url)) return termsReply === 'down' ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: termsReply.ok, json: async () => termsReply.body });
        return Promise.resolve({ ok: true, json: async () => ({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
    } });
  const pw = pdom.window;
  await new Promise(res => setTimeout(res, 300));
  const pid = (x) => pw.document.getElementById(x);
  pw.eval('currentUser = { email: "owner@glowsf.com" }');
  pw.localStorage.clear();
  let ok = await pw.checkTerms();
  check('a shop that has not accepted is shown the updated terms', ok === false && pid('termsModal').classList.contains('show'));
  check('over everything, with no way past but accepting or signing out',
    !/closeModal|Cancel/.test(pid('termsModal').querySelector('.modal-actions').textContent) && /Sign out/.test(pid('termsModal').textContent));
  pw.offerTourOnce();
  check('and the tour is not offered on top of it', pid('tourOffer').hidden);
  check('Accept waits for the box', pid('termsAccept').disabled === true);
  pid('termsAgree').checked = true;
  pid('termsAgree').dispatchEvent(new pw.Event('change'));
  check('ticked, it can be pressed', pid('termsAccept').disabled === false);
  pid('termsName').value = 'Bo'; pid('termsPin').value = '1111';
  await pw.acceptTerms(); await settle();
  check('a refusal says so and keeps the screen up', /manager or admin/.test(pid('termsError').textContent) && pid('termsModal').classList.contains('show'));
  acceptReply = { ok: true, body: { version: terms.TERMS_VERSION, accepted: true } };
  pid('termsName').value = 'Mia'; pid('termsPin').value = '9999';
  await pw.acceptTerms(); await settle();
  check('a manager accepting sends the version they read', accepts.pop().version === terms.TERMS_VERSION);
  check('and the screen goes', !pid('termsModal').classList.contains('show') && pid('termsPin').value === '');
  termsReply = { ok: true, body: { version: terms.TERMS_VERSION, accepted: true, exempt: true } };
  pid('termsModal').classList.remove('show');
  check('the demonstration shop is not asked', (await pw.checkTerms()) === true && !pid('termsModal').classList.contains('show'));
  termsReply = 'down';
  check('if the check cannot be made, the till is not locked over it', (await pw.checkTerms()) === true && !pid('termsModal').classList.contains('show'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
