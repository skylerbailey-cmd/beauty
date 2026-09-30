'use strict';
// How long after a sale a return can be taken.
//
// It was fourteen days, written into the code in two places, and past it the
// return screen simply refused — the checkboxes vanished and there was no way
// forward at all. That is the wrong shape for this decision. A customer at
// the counter on day twenty-two with a faulty $15,000 device is a judgement
// call for whoever runs the shop, not something the software settles by
// hiding the buttons.
//
// So: the window is configurable, "no returns" is one of its settings, and
// past the window a manager can still approve — the same override an
// unmatched card already used.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('offline'));
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
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
const set = (days) => w.eval(`storeSettings = { return_window_days: ${JSON.stringify(days)} };`);
const within = (daysSince) => w.eval(`withinReturnWindow(${daysSince}, returnWindowDays())`);

setTimeout(() => {
  console.log('\n── Reading the setting ──');
  set(14);
  check('a fortnight is a fortnight', w.eval('returnWindowDays()') === 14);
  set(30);
  check('thirty days is thirty', w.eval('returnWindowDays()') === 30);
  set(-1);
  check('minus one is no limit', w.eval('returnWindowDays()') === -1);
  set(0);
  check('zero is no returns', w.eval('returnWindowDays()') === 0);

  // A settings fetch that has not landed must not read as "this shop takes no
  // returns" to somebody standing at the counter.
  w.eval('storeSettings = {};');
  check('a missing setting falls back to a fortnight, not to never',
    w.eval('returnWindowDays()') === 14, String(w.eval('returnWindowDays()')));
  set(null);
  check('and so does an empty one', w.eval('returnWindowDays()') === 14);
  set('nonsense');
  check('and so does a nonsensical one', w.eval('returnWindowDays()') === 14);

  console.log('\n── Inside and outside the window ──');
  set(14);
  check('day one is inside', within(1) === true);
  check('day fourteen is still inside', within(14) === true);
  check('day fifteen is outside', within(15) === false);
  check('and twenty-two is well outside', within(22) === false);

  set(30);
  check('a longer window lets day twenty-two through', within(22) === true);

  set(-1);
  check('with no limit, a two-year-old sale is inside', within(730) === true);

  set(0);
  check('with no returns, even today is outside', within(0) === false);
  check('and so is anything else', within(1) === false);

  console.log('\n── The settings control ──');
  set(14);
  w.eval('fillReturnWindowSettings()');
  check('it loads the saved number', id('setReturnWindowMode').value === 'days'
    && id('setReturnWindowDays').value === '14',
    `${id('setReturnWindowMode').value} / ${id('setReturnWindowDays').value}`);
  check('and the day box is shown', id('setReturnWindowDaysWrap').style.display !== 'none');
  check('with an example in plain words',
    /can be returned until/.test(id('returnWindowExample').textContent),
    id('returnWindowExample').textContent);

  set(-1);
  w.eval('fillReturnWindowSettings()');
  check('no limit loads as no limit', id('setReturnWindowMode').value === 'unlimited');
  check('and hides the day box', id('setReturnWindowDaysWrap').style.display === 'none');
  check('and says what that means', /any date at all/.test(id('returnWindowExample').textContent),
    id('returnWindowExample').textContent);

  set(0);
  w.eval('fillReturnWindowSettings()');
  check('no returns loads as no returns', id('setReturnWindowMode').value === 'none');
  check('and says a manager is still the way through',
    /manager/.test(id('returnWindowExample').textContent),
    id('returnWindowExample').textContent);

  console.log('\n── What the form sends ──');
  id('setReturnWindowMode').value = 'days';
  id('setReturnWindowDays').value = '45';
  check('a number goes as that number', w.eval('returnWindowFromForm()') === 45);
  id('setReturnWindowDays').value = '0';
  check('a zero typed into the day box is not "no returns"',
    w.eval('returnWindowFromForm()') === 14, String(w.eval('returnWindowFromForm()')));
  id('setReturnWindowDays').value = '';
  check('and neither is an empty one', w.eval('returnWindowFromForm()') === 14);
  id('setReturnWindowMode').value = 'none';
  check('no returns is the only way to send zero', w.eval('returnWindowFromForm()') === 0);
  id('setReturnWindowMode').value = 'unlimited';
  check('and no limit sends minus one', w.eval('returnWindowFromForm()') === -1);

  console.log('\n── The server side agrees with the browser ──');
  // Two copies of the same rule; they have to answer the same way or the
  // screen offers a return the server then refuses.
  const posSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pos.js'), 'utf8');
  check('the server reads the setting too', /returnWindowDays\(await pgDb\.getSettings/.test(posSrc));
  check('with the same fallback to a fortnight', /: 14;/.test(posSrc));
  check('the same no-limit rule', /if \(windowDays < 0\) return true;/.test(posSrc));
  check('and the same no-returns rule', /if \(windowDays === 0\) return false;/.test(posSrc));
  check('nothing is hardcoded to 14 days any more',
    !/daysSince > 14/.test(posSrc), 'src/routes/pos.js still has a literal 14-day test');

  console.log('\n── Past the window, a manager decides ──');
  check('the server asks for one instead of refusing',
    /needsManagerOverride: true/.test(posSrc.slice(posSrc.indexOf('withinReturnWindow(daysSince'))),
    'expected the 403 + override shape, not a flat 400');
  check('and it is the manager check the rest of returns uses',
    /verifyManager\(userId, manager_name, manager_pin\)/.test(
      posSrc.slice(posSrc.indexOf('withinReturnWindow(daysSince'))));
  const pageSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  check('the browser no longer hides the return controls past the window',
    /const canReturn = tx\.type === 'sale';/.test(pageSrc),
    'canReturn should no longer fold the date test into itself');
  check('it tells staff a manager can approve it',
    /A manager can approve it/.test(pageSrc));
  check('and a return receipt is still the one thing with nothing to return against',
    /returns can only be made against a sale/.test(pageSrc));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
