'use strict';
// Rerun, on each row of the nightly reconciliation table.
//
// A morning's result is not always the last word: a processor settles late, a
// connection gets fixed, a refund is rung up after the fact. Rerun checks that
// day against the processor again and puts the new answer in its row — using
// the same one-day check the nightly run uses, so the two cannot disagree.
// Nobody is texted for a rerun, and a row that was texted keeps saying so.
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

// ── The server, with Postgres faked ──
const pgDb = require('../src/db/postgres');
let runs = {};               // day -> row
pgDb.getSettings = async () => ({ timezone: 'America/New_York', store_name: 'Glow SF' }); // no processor connected
pgDb.recentAutoAudits = async () => Object.values(runs).sort((a, b) => b.audited_day.localeCompare(a.audited_day));
pgDb.claimAutoAudit = async (u, day) => {
  if (runs[day]) return false;
  runs[day] = { audited_day: day, days_off: 0, difference: 0, alerted: 0, note: '' };
  return true;
};
pgDb.recordAutoAudit = async (u, day, f) => {
  runs[day] = { ...runs[day], audited_day: day, days_off: f.days_off || 0, difference: f.difference || 0,
    alerted: f.alerted ? 1 : 0, note: String(f.note || ''), ran_at: new Date().toISOString() };
};

const router = require('../src/routes/pos');
const handler = router.stack.find(l => l.route && l.route.path === '/audit-auto/rerun').route.stack.slice(-1)[0].handle;
const rerun = async (body) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ session: { userId: 'u1' }, body }, res);
  return res;
};
const ymd = (offset) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA');
};

(async () => {
  console.log('\n── On the server ──');
  check('a day it cannot read is refused', (await rerun({ day: 'yesterday' })).code === 400);
  check('today is refused — it is not over', (await rerun({ day: ymd(0) })).code === 400);
  check('and so is tomorrow', (await rerun({ day: ymd(1) })).code === 400);

  const day = ymd(-2);
  runs[day] = { audited_day: day, days_off: 1, difference: -42.5, alerted: 1, note: '' };
  const r = await rerun({ day });
  check('a past day is checked again', r.code === 200 && r.body.run && r.body.run.audited_day === day);
  check('and its row takes the new answer', runs[day].note === 'no processor connected' && runs[day].days_off === 0);
  check('a row that was texted still says so', runs[day].alerted === 1);
  const fresh = ymd(-5);
  await rerun({ day: fresh });
  check('a day the nightly run never reached gets a row', !!runs[fresh] && runs[fresh].alerted === 0);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pos.js'), 'utf8');
  const nightly = src.slice(src.indexOf('async function runNightlyAuditFor'), src.indexOf('async function runNightlyAudits'));
  const rerunSrc = src.slice(src.indexOf("router.post('/audit-auto/rerun'"), src.indexOf("router.get('/audit-auto'"));
  check('the nightly run and Rerun use the same one-day check', /auditOneDay\(company\.user_id, day\)/.test(nightly) && /auditOneDay\(userId, day\)/.test(rerunSrc));
  check('Rerun never texts anyone', !/sendAuditAlert/.test(rerunSrc));

  // ── The page ──
  console.log('\n── In the nightly table ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const posts = [];
  let reply = { ok: true, body: { run: { audited_day: '2026-09-29', days_off: 0, difference: 0, note: 'reconciled' } } };
  let table = [{ audited_day: '2026-09-29', days_off: 1, difference: -42.5, alerted: 1, note: '', ran_at: '2026-09-30T13:00:00Z' },
               { audited_day: '2026-09-28', days_off: 0, difference: 0, alerted: 0, note: 'reconciled' }];
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        if (/audit-auto\/rerun/.test(url)) { posts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: reply.ok, json: async () => reply.body }); }
        if (/audit-auto/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ enabled: true, runs: table }) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(res => setTimeout(res, 300));
  let drilled = null;
  w.openDayDrilldown = (d) => { drilled = d; };
  await w.loadAutoAudit();
  const buttons = () => [...id('autoAuditRuns').querySelectorAll('[data-rerun]')];
  check('every row has a Rerun button', buttons().length === 2 && buttons().every(b => b.textContent.trim() === 'Rerun'));
  check('saying when it was last checked', /last checked/.test(buttons()[0].title));
  table = [{ ...table[0], days_off: 0, difference: 0, note: 'reconciled' }, table[1]];
  buttons()[0].click();
  check('pressing it does not open the day’s detail', drilled === null);
  check('it says it is checking, and holds the other buttons', buttons()[0].textContent === 'Checking…' && buttons().every(b => b.disabled));
  await settle(); await settle();
  check('it asks the server about that day', posts.length === 1 && posts[0].day === '2026-09-29');
  check('the table is redrawn with the new answer', /✓ reconciled/.test(id('autoAuditRuns').querySelector('tbody tr').textContent));
  check('and says what changed', /Checked 2026-09-29 again: ✓ reconciles now/.test(id('autoAuditRerunNote').textContent));

  reply = { ok: true, body: { run: { audited_day: '2026-09-28', days_off: 1, difference: 12, note: '' } } };
  table = [table[0], { ...table[1], days_off: 1, difference: 12, note: '' }];
  buttons()[1].click(); await settle(); await settle();
  check('one that still does not reconcile says so, and by how much', /still does not reconcile — off by \$12\.00/.test(id('autoAuditRerunNote').textContent));

  reply = { ok: false, body: { error: 'A day can only be audited once it is over.' } };
  buttons()[0].click(); await settle(); await settle();
  check('a refusal is shown, and the buttons come back', /once it is over/.test(id('autoAuditRerunNote').textContent)
    && buttons().every(b => !b.disabled) && buttons()[0].textContent === 'Rerun');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
