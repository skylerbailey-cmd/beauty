'use strict';
// The reminder staff get before taking a return used to be three sentences
// written into the page — a shop with a different policy, or none, had no way
// to change it, and the confirmation dialog said something different again.
// Both now come from one thing the shop writes in Settings.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

let confirmText = null;
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('offline'));
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    w.confirm = (msg) => { confirmText = msg; return false; };
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

setTimeout(() => {
  console.log('\n── Before a shop has written anything ──');
  w.eval('storeSettings = {}; renderReturnPolicyNote();');
  let note = id('returnPolicyNote').textContent;
  check('the sensible default is shown', /opened or used/.test(note), note.slice(0, 80));
  check('with the default heading', /Before processing a return/.test(note));
  check('and the note is not suppressed', id('returnPolicyNote').dataset.empty !== '1');

  console.log('\n── The shop writes its own ──');
  w.eval(`storeSettings = {
    return_policy_title: 'Check this first',
    return_policy_points: 'Look for **damage**.\\n\\nNo refunds after **30 days**.\\n'
  }; renderReturnPolicyNote();`);
  note = id('returnPolicyNote');
  check('the heading is theirs', /Check this first/.test(note.textContent), note.textContent.slice(0, 60));
  check('their points are shown', /Look for damage/.test(note.textContent) && /30 days/.test(note.textContent));
  check('stars come out as bold', note.innerHTML.includes('<strong>damage</strong>'), note.innerHTML.slice(0, 200));
  check('blank lines are ignored', note.querySelectorAll('li').length === 2,
    `${note.querySelectorAll('li').length} bullets, expected 2`);

  console.log('\n── The same words in the confirmation ──');
  const points = w.eval('returnPolicyPoints()');
  check('the confirmation uses the same list', points.length === 2, JSON.stringify(points));
  check('and drops the stars, being a plain dialog',
    points.every((p) => !p.includes('**')), JSON.stringify(points));

  console.log('\n── A shop that clears it is not nagged ──');
  w.eval("storeSettings = { return_policy_points: '' }; renderReturnPolicyNote();");
  check('the note marks itself empty', id('returnPolicyNote').dataset.empty === '1');
  check('and the confirmation has nothing to ask', w.eval('returnPolicyPoints()').length === 0);

  console.log('\n── Typed text cannot inject markup ──');
  w.eval(`storeSettings = { return_policy_points: '<img src=x onerror=alert(1)>' }; renderReturnPolicyNote();`);
  check('it is escaped', !id('returnPolicyList').innerHTML.includes('<img'),
    id('returnPolicyList').innerHTML.slice(0, 120));

  console.log('\n── The Settings editor ──');
  w.eval("storeSettings = { return_policy_title: 'Check this first', return_policy_points: 'One **two**' }; fillReturnPolicySettings();");
  check('the fields load what is saved', id('setReturnPolicyTitle').value === 'Check this first'
    && id('setReturnPolicyPoints').value === 'One **two**');
  check('the preview shows it in bold', id('setReturnPolicyPreview').innerHTML.includes('<strong>two</strong>'),
    id('setReturnPolicyPreview').innerHTML.slice(0, 160));
  id('setReturnPolicyPoints').value = '';
  w.eval('previewReturnPolicy()');
  check('an empty list previews as "no reminder"',
    /not be reminded/.test(id('setReturnPolicyPreview').textContent),
    id('setReturnPolicyPreview').textContent);

  console.log('\n── Nothing saved yet: the editor offers the default to edit ──');
  w.eval('storeSettings = {}; fillReturnPolicySettings();');
  check('the textarea is pre-filled', /opened or used/.test(id('setReturnPolicyPoints').value),
    id('setReturnPolicyPoints').value.slice(0, 60));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 600);
