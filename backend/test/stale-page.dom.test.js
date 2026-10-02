'use strict';
// A tab opened before a deploy keeps running the old page. The server tells
// such a page to refresh (instead of "sign in again"), and a current page
// notices a newer deploy and offers a Refresh — without doing it on its own.
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
const pgDb = require('../src/db/postgres');
const staff = [{ id: 4, name: 'Sal', pin: '1234', role: 'manager', active: 1, user_id: 'shop-1' },
  { id: 3, name: 'Sky', pin: '3333', role: 'admin', active: 1, user_id: 'shop-1' }];
pgDb.getEmployee = async (id) => staff.find(e => e.id === id);
pgDb.verifyEmployeePin = async (pin, u, name) => staff.find(e => e.pin === pin && e.name.toLowerCase() === String(name || '').toLowerCase());
pgDb.updateEmployee = async () => {};
pgDb.setCommissionPlan = async () => {};
const router = require('../src/routes/pos');
const handle = (p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, body, params) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handle(p, m)({ session: { userId: 'shop-1' }, body, params, query: {} }, res);
  return res;
};

(async () => {
  console.log('\n── The server ──');
  // Exactly what the old page sent for Sal: no manager name or PIN at all.
  let r = await call('/employees/:id', 'put', { name: 'Sal', pin: 'undefined', role: 'manager', commission_rate: 45 }, { id: '4' });
  check('an old page is told to refresh', r.code === 409 && r.body.stale_page && /out of date.*Refresh/.test(r.body.error), JSON.stringify(r.body));
  r = await call('/employees/:id/commission-plan', 'put', { plan_type: 'flat', base_rate: 45, store_rate: 4 }, { id: '4' });
  check('the same for its commission plan', r.code === 409 && r.body.stale_page);
  r = await call('/employees/:id', 'put', { name: 'Sal', role: 'manager', manager_name: 'Sky', manager_pin: '0000' }, { id: '4' });
  check('a wrong PIN is still just refused', r.code === 403 && !r.body.stale_page);
  r = await call('/employees/:id/commission-plan', 'put', { plan_type: 'flat', base_rate: 45, store_rate: 4, manager_name: 'Sky', manager_pin: '3333' }, { id: '4' });
  check('an admin sets the manager\'s store commission', r.code === 200, JSON.stringify(r.body));

  console.log('\n── The page ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  let tag = 'W/"v1"', heads = 0;
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts) => {
        if (opts?.method === 'HEAD') { heads++; return Promise.resolve({ ok: true, headers: { get: (h) => (h === 'etag' ? tag : null) } }); }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {};
    } });
  const w = dom.window;
  const bar = () => w.document.getElementById('updateBar');
  await new Promise(r => setTimeout(r, 300));
  check('it notes which version it is on load', heads >= 1);
  await w.checkForNewVersion();
  check('no bar while nothing has changed', !bar().classList.contains('show'));
  tag = 'W/"v2"';
  await w.checkForNewVersion();
  check('a new deploy shows the Refresh bar', bar().classList.contains('show') && /SkySale has been updated/.test(bar().textContent));
  check('and doesn\'t refresh by itself — the page is still here', !!w.document.getElementById('posSubtabs'));
  bar().querySelector('.ub-later').click();
  check('Later puts it away', !bar().classList.contains('show'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
