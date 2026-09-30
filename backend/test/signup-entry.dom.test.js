'use strict';
// The first screen of signing up: how somebody gets in at all.
//
// "Continue with Google" sat beside the emailed link, but the OAuth app
// behind it does not exist — so the button went to a Google error page and no
// account was ever created. Half the ways in on that screen were dead ends,
// and the dead one looked like the faster option.
//
// One way in now: an address, and a link sent to it.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const file = path.join(__dirname, '..', 'web', 'signup.html');
const html = fs.readFileSync(file, 'utf8');

const calls = [];
const dom = new JSDOM(html, { url: 'https://app.sky-sale.com/signup.html', runScripts: 'dangerously',
  beforeParse(w) {
    // Not signed in: the state call fails, which is what puts the sign-in
    // screen on the page in the first place.
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET' });
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'not signed in' }) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
    Object.defineProperty(w, 'sessionStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

setTimeout(() => {
  const card = id('card');
  const text = card.textContent.replace(/\s+/g, ' ');

  console.log('\n── One way in ──');
  check('the email form is there', !!id('linkForm') && !!id('loginEmail'));
  check('with the button that sends the link', !!id('linkGo')
    && /Email me a link/.test(id('linkGo').textContent), id('linkGo') && id('linkGo').textContent);

  console.log('\n── And no dead end beside it ──');
  check('no Continue with Google button', !/Continue with Google/i.test(text), text.slice(0, 300));
  check('and nothing linking to the OAuth route',
    !card.querySelector('a[href*="/auth/google"]'),
    [...card.querySelectorAll('a')].map((a) => a.getAttribute('href')).join(' | '));
  check('no stray "or" left hanging where it used to be',
    !/>\s*or\s*</.test(card.innerHTML), 'an orphaned separator is left over');

  console.log('\n── The demo way round is untouched ──');
  check('looking around is still offered', /test@demo\.com/.test(text));
  check('and it fills the box rather than signing anyone in',
    typeof w.useDemo === 'function');
  w.useDemo();
  check('putting the demo address in the field', id('loginEmail').value === 'test@demo.com',
    id('loginEmail').value);

  console.log('\n── Nothing on the server points at a button that is gone ──');
  const srcOf = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', f), 'utf8');
  const signup = srcOf('signup.js');
  const login = srcOf('login.js');
  const auth = srcOf('auth.js');
  check('signup does not tell people to sign in with Google',
    !/Sign in with Google to continue/.test(signup), 'signup.js still names Google');
  check('it names the emailed link instead',
    /Open the link we emailed you/.test(signup));
  check('a failed send does not suggest Google either',
    !/or sign in with Google/.test(login), 'login.js still offers Google as the fallback');
  check('and the dead useGoogle flag is gone from all of them',
    !/useGoogle/.test(signup + login + auth));

  console.log('\n── The route itself is left alone ──');
  // Deleting it would mean rebuilding it later; the button is what was wrong,
  // not the endpoint.
  const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  check('/auth is still mounted', /app\.use\('\/auth'/.test(idx));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
