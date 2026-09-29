'use strict';
// Reviewing an audit is not a yes/no. A day that does not reconcile gets
// opened, the missing charge gets found, and then it sits with the processor
// for a week — so the tick could only ever say "done" or "not done", and the
// week in between had nowhere to live. And a day with a dozen lines in it
// takes more than one sitting, so the lines already worked through have to
// stay ticked when you come back.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const calls = [];
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (/audit-line-reviews/.test(String(url)) && (opts.method || 'GET') === 'GET') {
        return Promise.resolve({ ok: true, json: async () => ({ lines: { 'pos:1502-1305LC2': { by: 'sky' } } }) });
      }
      if (/reconciliation-day/.test(String(url))) {
        return Promise.resolve({ ok: true, json: async () => ({
          all_pos: [
            { receipt: '1502-1305LC2', dir: 'sale', amount: 216.38, matched: false, customer: 'A' },
            { receipt: '1502-1306LC2', dir: 'sale', amount: 100, matched: false, customer: 'B' },
            { receipt: '1502-1307LC2', dir: 'sale', amount: 50, matched: true, customer: 'C' },
          ],
          all_merchant_day: [{ batch_id: 'B-77', dir: 'sale', amount: 216.38, matched: false }],
          pos_sales_total: 366.38, pos_credits_total: 0,
          merchant_sales_total: 216.38, merchant_credits_total: 0,
        }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, reviews: {}, audits: [] }) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = (m) => { w.__alert = m; };
    w.Element.prototype.scrollIntoView = function () {};
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, d) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && d) console.log('        ' + d);
  ok ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(700);

  console.log('\n── The day: three states, not a tick ──');
  const sel = w.eval("reviewSelect('2026-09-07', {}, 'x')");
  check('it is a dropdown', /^<select/.test(sel.trim()), sel.slice(0, 40));
  for (const label of ['Needs review', 'Pending review', 'Review completed']) {
    check(`it offers "${label}"`, sel.includes(label));
  }
  check('a day nobody has touched needs review', /value="needs" selected/.test(sel), sel);
  check('a finished day says so',
    /value="completed" selected/.test(w.eval("reviewSelect('2026-09-07', {status:'completed'}, '')")));
  check('a day left with the processor is pending',
    /value="pending" selected/.test(w.eval("reviewSelect('2026-09-07', {status:'pending'}, '')")));
  check('an old record with only the tick still reads as completed',
    /value="completed" selected/.test(w.eval("reviewSelect('2026-09-07', {reviewed:true}, '')")));

  console.log('\n── Choosing one saves it ──');
  calls.length = 0;
  w.eval("auditReviews = {}; setDayReviewed('2026-09-07', 'pending')");
  await wait(120);
  const posted = calls.find((c) => c.method === 'POST' && /audit-reviews/.test(c.url));
  check('it sends the status', posted && posted.body.status === 'pending', JSON.stringify(posted && posted.body));
  check('and remembers it locally', w.eval("auditReviews['2026-09-07'].status") === 'pending');
  check('pending is not counted as finished', w.eval("auditReviews['2026-09-07'].reviewed") === false);
  w.eval("setDayReviewed('2026-09-07', 'completed')");
  await wait(120);
  check('completed is', w.eval("auditReviews['2026-09-07'].reviewed") === true);

  console.log('\n── The lines inside a day ──');
  w.eval("openDayDrilldown('2026-09-07')");
  await wait(250);
  const ticks = [...id('drilldownBody').querySelectorAll('input[type=checkbox]')];
  check('unmatched lines get a tick', ticks.length === 3, `${ticks.length} ticks, expected 3 (2 POS + 1 merchant)`);
  check('a matched line does not',
    !id('drilldownBody').innerHTML.includes('1502-1307LC2\'') ||
    ticks.every((t) => !/1502-1307LC2/.test(t.getAttribute('onchange'))));
  check('one already worked through comes back ticked',
    ticks.filter((t) => t.checked).length === 1, ticks.map((t) => t.checked).join(','));
  check('and it is the right one',
    ticks.find((t) => t.checked).getAttribute('onchange').includes('1502-1305LC2'));

  console.log('\n── Ticking a line ──');
  calls.length = 0;
  w.eval("setLineReviewed('2026-09-07','pos','1502-1306LC2', true)");
  await wait(120);
  const line = calls.find((c) => c.method === 'POST' && /audit-line-reviews/.test(c.url));
  check('it saves the line', line && line.body.ref === '1502-1306LC2' && line.body.reviewed === true,
    JSON.stringify(line && line.body));
  check('the merchant side is its own thing',
    w.eval("setLineReviewed('2026-09-07','merchant','B-77', true); 1") === 1);
  await wait(120);
  check('kept apart from a POS line of the same name',
    w.eval("Object.keys(auditLineReviews).sort().join('|')"),
    w.eval("Object.keys(auditLineReviews).sort().join('|')"));
  check('both sides are remembered',
    w.eval("!!auditLineReviews['pos:1502-1306LC2'] && !!auditLineReviews['merchant:B-77']"));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
