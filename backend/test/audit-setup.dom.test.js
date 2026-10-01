'use strict';
// The Audit tab says what the nightly audit needs — a merchant connection, the
// nightly batch switched on, and (optionally) someone to text — and ticks each
// off as it is done. The server reports which processor is connected, never
// the token.
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

// ── The server ──
const pgDb = require('../src/db/postgres');
let settings = {};
pgDb.getSettings = async () => settings;
pgDb.recentAutoAudits = async () => [];
const router = require('../src/routes/pos');
const handler = router.stack.find(l => l.route && l.route.path === '/audit-auto' && l.route.methods.get).route.stack.slice(-1)[0].handle;
const get = async () => {
  const res = { json(b) { this.body = b; return this; }, status() { return this; } };
  await handler({ session: { userId: 'u1' } }, res);
  return res.body;
};

(async () => {
  console.log('\n── On the server ──');
  check('nothing connected says so', (await get()).merchant === null);
  settings = { maverick_token: 'secret-tok' };
  check('a Maverick token without its DBA ID is not a connection', (await get()).merchant === null);
  settings = { maverick_token: 'secret-tok', maverick_dba_id: '123' };
  const b = await get();
  check('with both it is', b.merchant === 'Maverick');
  check('and the token never leaves the server', !JSON.stringify(b).includes('secret-tok'));
  settings = { payarc_token: 'p-tok' };
  check('Payarc is recognised too', (await get()).merchant === 'Payarc');

  console.log('\n── On the page ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  let AUTO = { enabled: false, alert_enabled: false, alerts_possible: false, timezone: 'America/Denver', at: '09:00', merchant: null, runs: [] };
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url) => Promise.resolve({ ok: true, json: async () => (/audit-auto/.test(url) ? AUTO : {}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {};
    } });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 300));
  const card = w.document.getElementById('auditSetupCard');
  const steps = () => [...w.document.querySelectorAll('#auditSetupSteps li')];
  const text = () => card.textContent.replace(/\s+/g, ' ');
  const ticked = () => steps().map(li => /— done/.test(li.textContent));

  await w.loadAutoAudit();
  check('the Audit tab has a setup card', !!card);
  check('it explains what the audit does', /each card sale rung up here against the batch your processor actually settled/.test(text()));
  check('three steps, none done', steps().length === 3 && ticked().every(t => !t), JSON.stringify(ticked()));
  check('connecting the merchant says what each processor needs', /Maverick:.*DBA ID and API token.*Payarc:.*API bearer token/.test(text()), text());
  check('the nightly batch says which box to tick and when to run it', /Run the audit automatically every day/.test(text()) && /after your processor has settled/.test(text()));
  check('texting is marked optional', /Get a text when a day is off \(optional\)/.test(text()));
  check('and there is a way straight to the settings', /Open Settings → Alerts & connections/.test(text()));
  check('and it shows while there is something to do', w.getComputedStyle(card).display !== 'none');

  AUTO = { ...AUTO, merchant: 'Maverick' };
  await w.loadAutoAudit();
  check('connected: the first step is ticked and names the processor', ticked()[0] && !ticked()[1] && /Connected to Maverick/.test(text()));
  check('still shown without the nightly batch', w.getComputedStyle(card).display !== 'none');

  AUTO = { ...AUTO, enabled: true, at: '07:30' };
  await w.loadAutoAudit();
  check('switched on: the second step is ticked with its time', ticked()[1] && /Runs every day at 7:30am/.test(text()));
  check('once set up, the card is hidden', card.classList.contains('setup-done') && w.getComputedStyle(card).display === 'none');

  AUTO = { ...AUTO, alert_enabled: true, alerts_possible: false };
  await w.loadAutoAudit();
  check('texts on but nobody to text is not ticked', !ticked()[2]);
  AUTO = { ...AUTO, alerts_possible: true };
  await w.loadAutoAudit();
  check('with a number it is', ticked()[2]);
  AUTO = { ...AUTO, merchant: null };
  await w.loadAutoAudit();
  check('if the connection is removed, it comes back', w.getComputedStyle(card).display !== 'none' && !ticked()[0]);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
