'use strict';
// The Emails tab opens on Welcome emails — in the list and in the screen.
//
// The list beside the email suite marked Welcome emails as selected, but the
// suite inside opened itself on Sent Emails when embedded, and opening the
// tab never told it otherwise: Welcome highlighted over a page of sent mail.
// Now opening the tab tells the suite which view the list has selected, the
// suite's own default is Welcome too, and the list reads Welcome, Mass email,
// then Sent emails at the bottom.
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
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = () => Promise.resolve({ ok: true, json: async () => ({ accepted: true }) });
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);

setTimeout(() => {
  const order = [...id('emailsNav').querySelectorAll('[data-emailview]')].map(b => b.dataset.emailview);
  check('the list reads Welcome, Mass email, then Sent at the bottom', order.join() === 'welcome,mass,sent', order.join());
  check('with Welcome selected', id('emailsNav').querySelector('.active').dataset.emailview === 'welcome');

  w.switchTab('emails');
  const f = id('emailsFrame');
  check('opening the tab loads the suite', !!f.getAttribute('src'));
  check('and tells it to show Welcome emails', f.dataset.pendingTab === 'welcome');
  check('with the Welcome screen showing, not mass email', id('emailViewWelcome').style.display !== 'none' && id('emailViewMass').style.display === 'none');

  w.switchEmailView('mass');
  w.switchTab('register');
  w.switchTab('emails');
  check('coming back opens on what was last picked', id('emailViewMass').style.display !== 'none'
    && id('emailsNav').querySelector('.active').dataset.emailview === 'mass');

  const suite = fs.readFileSync(path.join(__dirname, '..', 'web', 'emails.html'), 'utf8');
  check('the suite no longer jumps to Sent when embedded', !/IS_EMBEDDED && !hasPrefill\(\)\) \{\s*switchTab\('sent'\)/.test(suite));
  check('its own list has Welcome above Sent', suite.indexOf('data-tab="welcome"') < suite.indexOf('data-tab="sent"'));

  const tourOrder = w.eval("TOUR_STEPS.filter(s => s.tab === 'emails').map(s => s.title)").join(' | ');
  check('the tour follows the list', /Welcome emails.*Mass email.*Sent emails/.test(tourOrder), tourOrder);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 300);
