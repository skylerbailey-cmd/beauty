'use strict';
// Settings → Alerts & connections: only connected processors show their
// card. Others are added from a list, which opens that processor's card.
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
    w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    w.Element.prototype.scrollIntoView = () => {};
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
const shown = (el) => w.getComputedStyle(el).display !== 'none';
const options = () => [...id('processorPicker').options].map(o => o.textContent);
const setConn = (mav, pay) => { w.eval(`storeSettings.maverick_connected = ${mav}; storeSettings.payarc_connected = ${pay};
  refreshMaverickConnState(); refreshPayarcConnState(); settingsGroup('merchant');`); };

setTimeout(() => {
  console.log('\n── A shop with no processor ──');
  setConn(false, false);
  check('the picker card is there', shown(id('processorPickerCard')));
  check('neither processor\'s form is on the page', !shown(id('maverickConfigCard')) && !shown(id('payarcConfigCard')));
  check('the list offers both, and someone else', JSON.stringify(options()) === JSON.stringify(['Choose your processor…', 'Maverick Payments', 'Payarc', 'Someone else…']), JSON.stringify(options()));
  check('with a line saying what it is for', shown(id('processorPickerIntro')));
  check('the "don\'t see yours" note waits until asked for', id('processorOther').hidden);

  w.chooseProcessor('maverick');
  check('picking Maverick opens its card', shown(id('maverickConfigCard')) && !shown(id('payarcConfigCard')));
  check('and it leaves the list', !options().includes('Maverick Payments') && options().includes('Payarc'));
  check('the list resets for another pick', id('processorPicker').value === '');
  w.eval("settingsGroup('store'); settingsGroup('merchant');");
  check('it stays open moving between Settings groups', shown(id('maverickConfigCard')));
  w.chooseProcessor('other');
  check('Someone else shows who to ask', !id('processorOther').hidden && /support@sky-sale\.com/.test(id('processorOther').textContent));
  w.chooseProcessor('payarc');
  check('picking Payarc opens its card too, and puts the note away', shown(id('payarcConfigCard')) && id('processorOther').hidden);
  w.switchTab('register');
  setConn(false, false);
  check('leaving Settings forgets what was picked but not connected', !shown(id('maverickConfigCard')) && !shown(id('payarcConfigCard')));

  console.log('\n── A shop on Maverick (like Glow SF) ──');
  setConn(true, false);
  check('its Maverick card shows, connected', shown(id('maverickConfigCard')) && /Connected/.test(id('maverickConnStatus').textContent));
  check('Payarc\'s doesn\'t', !shown(id('payarcConfigCard')));
  check('the list offers to add another', JSON.stringify(options()) === JSON.stringify(['Add another…', 'Payarc', 'Someone else…']), JSON.stringify(options()));
  check('without the first-time explanation', !shown(id('processorPickerIntro')));

  console.log('\n── A shop on both (like Desert Wellness) ──');
  setConn(true, true);
  check('both cards show', shown(id('maverickConfigCard')) && shown(id('payarcConfigCard')));
  check('the list has only someone else', JSON.stringify(options()) === JSON.stringify(['Add another…', 'Someone else…']), JSON.stringify(options()));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 400);
