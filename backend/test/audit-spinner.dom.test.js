'use strict';
// Opening a saved audit reads a range of batches from the processor and can
// take several seconds. Nothing on screen said so: the "Fetching batches…"
// line lives in the Sales filter row, and running an audit moves you to the
// Audit tab — so the only progress message was on a page you had just left.
// With nothing moving, the natural thing to do is press the button again.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

function page(fetchImpl) {
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
    beforeParse(w) {
      w.fetch = fetchImpl;
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
    } });
  return dom.window;
}

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && d) console.log('        ' + d);
  ok ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── while it is running ──
  let release;
  const held = new Promise((r) => { release = r; });
  const w1 = page((url) => /reconciliation-audit/.test(String(url))
    ? held
    : Promise.resolve({ ok: true, json: async () => ({ reviews: [], audits: [], runs: [] }) }));
  await wait(700);
  const id1 = (x) => w1.document.getElementById(x);
  const buttons = () => [...w1.document.querySelectorAll('[onclick^="runAudit"], [onclick^="openSavedAudit"]')];

  console.log('\n── Opening a saved audit ──');
  check('nothing is spinning to begin with', !id1('auditBusy').classList.contains('on'));
  w1.eval("openSavedAudit('2026-09-01','2026-09-15')");
  await wait(80);
  check('the spinner shows', id1('auditBusy').classList.contains('on'));
  check('it names the range being opened',
    /2026-09-01 to 2026-09-15/.test(id1('auditBusyText').textContent), id1('auditBusyText').textContent);
  check('it is on the Audit tab, where the reader now is',
    id1('txViewAudit').contains(id1('auditBusy')) && id1('txViewAudit').style.display !== 'none');
  check('the buttons are locked, so it cannot be asked twice',
    buttons().length > 0 && buttons().every((b) => b.disabled));

  console.log('\n── When the answer arrives ──');
  release({ ok: true, json: async () => ({ configured: true, from: '2026-09-01', to: '2026-09-15', days: [], totals: {} }) });
  await wait(150);
  check('the spinner stops', !id1('auditBusy').classList.contains('on'),
    'text was: ' + id1('auditBusyText').textContent);
  check('and the buttons work again', buttons().every((b) => !b.disabled));

  // ── when it fails ──
  const w2 = page((url) => /reconciliation-audit/.test(String(url))
    ? Promise.reject(new Error('the processor timed out'))
    : Promise.resolve({ ok: true, json: async () => ({ reviews: [], audits: [], runs: [] }) }));
  await wait(700);
  const id2 = (x) => w2.document.getElementById(x);

  console.log('\n── When the processor does not answer ──');
  w2.eval("openSavedAudit('2026-09-01','2026-09-15')");
  await wait(150);
  check('the failure is said on the Audit tab', id2('auditBusy').classList.contains('on'));
  check('it names what went wrong', /timed out/.test(id2('auditBusyText').textContent), id2('auditBusyText').textContent);
  check('the ring stops pretending to work', id2('auditBusy').querySelector('.spin').style.display === 'none');
  check('the buttons are usable again',
    [...w2.document.querySelectorAll('[onclick^="runAudit"]')].every((b) => !b.disabled));

  console.log('\n── A fresh run clears the failure ──');
  w2.fetch = () => new Promise(() => {});   // hang, so the state is observable
  id2('auditFrom').value = '2026-09-01'; id2('auditTo').value = '2026-09-15';
  w2.eval("runAudit('tab')");
  await wait(100);
  check('the ring is back', id2('auditBusy').querySelector('.spin').style.display === '');
  check('and the message is a working one',
    !/Could not run/.test(id2('auditBusyText').textContent), id2('auditBusyText').textContent);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
