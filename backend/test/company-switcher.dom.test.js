'use strict';
// The company switcher in the top right — the thing that lets an owner with
// two locations move between them.
//
// Adding a second location and still seeing one in the list had two separate
// causes, and both had to go:
//
//   The session knows which companies this browser has proved it can open,
//   but it knows them as IDS. Switching acts on an ADDRESS. So the browser
//   used to recover the address by matching the company name against
//   localStorage — and localStorage is per origin, while every shop lives on
//   its own subdomain. A second location proved on this session was dropped
//   from the menu entirely unless this exact subdomain happened to be the one
//   that had written it down.
//
//   And on a phone the menu was 260px wide, hanging off a button near the
//   right edge of a 390px screen, on a page with overflow-x: hidden. What ran
//   past the edge was not scrollable to. It was gone.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const file = path.join(__dirname, '..', 'web', 'pos.html');
const html = fs.readFileSync(file, 'utf8');

// Two locations, as the session reports them: ids and names — and now
// addresses, which is the fix.
const COMPANIES = [
  { id: 'c68e3ce2', companyName: 'Glow SF', slug: 'glowsf',
    email: 'glow.sf.santafe@gmail.com', current: true },
  { id: '003a24d0', companyName: 'Desert Wellness', slug: 'desertwellness',
    email: 'desertwellness.santafe@gmail.com', current: false },
];

const calls = [];
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET',
        body: opts.body ? JSON.parse(opts.body) : null });
      if (/auth\/companies/.test(String(url))) {
        return Promise.resolve({ ok: true, json: async () => ({ companies: COMPANIES }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    // Deliberately EMPTY. This is a phone that has never been used to sign
    // into either shop from this subdomain — the case that was broken.
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

setTimeout(async () => {
  w.eval("currentUser = { email: 'glow.sf.santafe@gmail.com' };");
  await w.eval('renderCompanySwitcherMenu()');
  const menu = id('companySwitcherMenu');
  const text = menu.textContent.replace(/\s+/g, ' ');

  console.log('\n── Both locations are listed, on a browser that remembers nothing ──');
  const rows = [...menu.querySelectorAll('.cs-account')];
  check('two shops in the menu', rows.length === 2, `${rows.length} listed: ${text.slice(0, 120)}`);
  check('the one being looked at', /Glow SF/.test(text), text.slice(0, 160));
  check('and the other one', /Desert Wellness/.test(text),
    'the second location was dropped — the browser could not work out its address');
  check('the current shop is marked', menu.querySelectorAll('.cs-account.active').length === 1);

  console.log('\n── Switching acts on the address the server gave ──');
  calls.length = 0;
  const other = rows.find((r) => /Desert Wellness/.test(r.textContent));
  other.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const sw = calls.find((c) => /auth\/switch/.test(c.url));
  check('it asks to switch', !!sw, calls.map((c) => c.url).join(' | '));
  check('naming the other shop\'s address',
    sw && sw.body && sw.body.email === 'desertwellness.santafe@gmail.com',
    sw && JSON.stringify(sw.body));

  console.log('\n── The server sends the address at all ──');
  const loginSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'login.js'), 'utf8');
  const handler = loginSrc.slice(loginSrc.indexOf("router.get('/companies'"));
  check('/auth/companies includes it', /email,/.test(handler) && /emailForCompany/.test(handler),
    'without it the browser is back to guessing from localStorage');
  check('and the browser prefers it over anything remembered locally',
    /const email = c\.email \|\|/.test(html),
    'localStorage must be the fallback, not the source');

  console.log('\n── On a phone the menu stays on the screen ──');
  // 260px of menu hanging off a button near the right edge of a 390px screen,
  // on a page with overflow-x: hidden, is not a menu you can scroll to.
  const phoneCss = html.slice(html.indexOf('@media (max-width: 760px)'));
  const block = phoneCss.slice(phoneCss.indexOf('.company-switcher-menu'),
    phoneCss.indexOf('.company-switcher-menu') + 400);
  check('its width is capped to the viewport', /max-width: calc\(100vw - 28px\)/.test(block), block.slice(0, 200));
  check('and the desktop min-width is lifted', /min-width: 0/.test(block));
  check('a long list scrolls itself rather than the page',
    /max-height: calc\(100vh - 120px\)/.test(block) && /overflow-y: auto/.test(block));
  check('rows are finger-sized', /\.cs-account, \.cs-action \{ padding-top: 13px/.test(phoneCss));
  check('and shop names are not clipped at a desktop width',
    /\.cs-account-info \.cs-name, \.cs-account-info \.cs-addr \{ max-width: none/.test(phoneCss));

  console.log('\n── The page itself still cannot be dragged sideways ──');
  check('overflow-x is still pinned', /html, body \{ overflow-x: hidden/.test(html));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
