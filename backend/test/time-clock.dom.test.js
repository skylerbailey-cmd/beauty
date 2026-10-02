'use strict';
// The time clock: clock in and out on the register with your own name and
// PIN; shifts in Reports → Time clock, everyone's (and editable) for a manager
// or admin, your own for anyone else. Also: managers see everything an admin
// does in Reports, and Build your own can be switched off in Settings.
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

// ── The server, with Postgres faked ──
const pgDb = require('../src/db/postgres');
const SHOP = 'shop-1', OTHER = 'shop-2';
const staff = [
  { id: 1, name: 'Ana', pin: '1111', role: 'sales', active: 1, user_id: SHOP },
  { id: 2, name: 'Mo', pin: '2222', role: 'manager', active: 1, user_id: SHOP },
  { id: 3, name: 'Sky', pin: '3333', role: 'admin', active: 1, user_id: SHOP },
  { id: 9, name: 'Elsewhere', pin: '9999', role: 'sales', active: 1, user_id: OTHER },
];
let settings = { time_clock_enabled: 1, build_your_own_enabled: 1, timezone: 'America/Denver' };
let open = new Map();          // employee_id -> clock_in
let entries = [];              // what timeEntries returns
let lastTimeQuery = null, saved = [], deleted = [];
pgDb.getSettings = async () => settings;
pgDb.verifyEmployeePin = async (pin, userId, name) =>
  staff.find(e => e.pin === pin && e.user_id === userId && e.name.toLowerCase() === String(name || '').trim().toLowerCase());
pgDb.openShift = async (id) => (open.has(id) ? { id: 50, clock_in: open.get(id) } : null);
pgDb.clockIn = async (u, id) => { open.set(id, '2026-10-01T09:00'); return { clock_in: '2026-10-01T09:00' }; };
pgDb.clockOut = async (id) => { const t = open.get(id); open.delete(id); return { id: 50, clock_in: t, clock_out: '2026-10-01T17:30', hours: 8.5 }; };
pgDb.onTheClock = async () => [...open].map(([id, t]) => ({ employee_name: staff.find(s => s.id === id).name, clock_in: t }));
pgDb.timeEntries = async (scope, start, end, name) => { lastTimeQuery = { scope, start, end, name }; return name ? entries.filter(e => e.employee_name === name) : entries; };
pgDb.getEmployees = async (id) => staff.filter(e => e.user_id === id);
pgDb.getEmployee = async (id) => staff.find(e => e.id === id);
pgDb.getAllCompanyIds = async () => [{ user_id: SHOP, store_name: 'Glow SF' }, { user_id: OTHER, store_name: 'Desert Wellness' }];
pgDb.getTimeEntry = async (id) => ({ 70: { id: 70, user_id: SHOP, employee_id: 1 }, 71: { id: 71, user_id: OTHER, employee_id: 9 } })[id] || null;
pgDb.saveTimeEntry = async (f) => { saved.push(f); return f.id || 99; };
pgDb.deleteTimeEntry = async (id) => { deleted.push(id); };
pgDb.payrollForPayday = async () => ({ period: { start: '2026-09-16', end: '2026-09-30' }, employees: [] });
pgDb.getCompanyLinks = async () => [];
pgDb.linkedCompanyIds = async () => [SHOP];

const router = require('../src/routes/pos');
const route = (p, method = 'post') => router.stack.find(l => l.route && l.route.path === p && l.route.methods[method]).route.stack.slice(-1)[0].handle;
const call = async (p, body, method = 'post') => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await route(p, method)({ session: { userId: SHOP }, body, query: {} }, res);
  return res;
};

(async () => {
  console.log('\n── Clocking in and out ──');
  settings = { ...settings, time_clock_enabled: 0 };
  check('switched off, the register refuses', (await call('/time-clock/punch', { name: 'Ana', pin: '1111', action: 'in' })).code === 403);
  check('and says nobody is on the clock', (await call('/time-clock/now', {}, 'get')).body.enabled === false);
  settings = { ...settings, time_clock_enabled: 1 };
  check('a wrong PIN is refused', (await call('/time-clock/punch', { name: 'Ana', pin: '0000', action: 'in' })).code === 401);
  check('someone else\'s PIN with your name is refused', (await call('/time-clock/punch', { name: 'Ana', pin: '2222', action: 'in' })).code === 401);
  let r = await call('/time-clock/punch', { name: 'Ana', pin: '1111', action: 'in' });
  check('Ana clocks in', r.code === 200 && r.body.action === 'in' && r.body.clock_in === '2026-10-01T09:00', JSON.stringify(r.body));
  r = await call('/time-clock/punch', { name: 'Ana', pin: '1111', action: 'in' });
  check('clocking in twice is refused, saying since when', r.code === 409 && /already clocked in, since 2026-10-01 09:00/.test(r.body.error), r.body.error);
  check('she shows as on the clock', (await call('/time-clock/now', {}, 'get')).body.on.some(o => o.employee_name === 'Ana'));
  r = await call('/time-clock/punch', { name: 'Ana', pin: '1111', action: 'out' });
  check('Ana clocks out, with the length of the shift', r.code === 200 && r.body.action === 'out' && r.body.hours === 8.5);
  r = await call('/time-clock/punch', { name: 'Ana', pin: '1111', action: 'out' });
  check('clocking out when not clocked in is refused', r.code === 409);

  console.log('\n── Reports → Time clock ──');
  entries = [
    { id: 70, company_id: SHOP, store_name: 'Glow SF', employee_id: 1, employee_name: 'Ana', clock_in: '2026-09-30T09:00', clock_out: '2026-09-30T17:30', hours: 8.5, note: '', edited_by: '' },
    { id: 72, company_id: SHOP, store_name: 'Glow SF', employee_id: 2, employee_name: 'Mo', clock_in: '2026-09-30T10:00', clock_out: null, hours: 3, note: 'Forgot', edited_by: 'Sky' },
  ];
  r = await call('/reports/time', { name: 'Ana', pin: '1111', start: '2026-09-16', end: '2026-09-30' });
  check('an employee gets only their own shifts', r.code === 200 && lastTimeQuery.name === 'Ana' && r.body.entries.length === 1);
  check('and cannot edit', r.body.can_edit === false && r.body.people.length === 0);
  r = await call('/reports/time', { name: 'Mo', pin: '2222', start: '2026-09-16', end: '2026-09-30' });
  check('a manager gets everyone\'s', lastTimeQuery.name === null && r.body.entries.length === 2);
  check('and can edit, with the people to add a shift for', r.body.can_edit === true && r.body.people.some(p => p.name === 'Ana'));
  check('bad dates are refused', (await call('/reports/time', { name: 'Mo', pin: '2222', start: 'x', end: '2026-09-30' })).code === 400);

  check('an employee cannot change a shift',
    (await call('/reports/time/save', { name: 'Ana', pin: '1111', id: 70, clock_in: '2026-09-30T08:00' })).code === 403);
  check('clock out before clock in is refused',
    (await call('/reports/time/save', { name: 'Mo', pin: '2222', id: 70, clock_in: '2026-09-30T18:00', clock_out: '2026-09-30T17:00' })).code === 400);
  check('a shift at a shop they cannot see is refused',
    (await call('/reports/time/save', { name: 'Mo', pin: '2222', id: 71, clock_in: '2026-09-30T08:00' })).code === 404);
  r = await call('/reports/time/save', { name: 'Mo', pin: '2222', id: 70, clock_in: '2026-09-30T08:00', clock_out: '2026-09-30T17:00', note: 'Started early' });
  check('a manager corrects a shift, signed with their name', r.code === 200 && saved.at(-1).editedBy === 'Mo' && saved.at(-1).clockIn === '2026-09-30T08:00');
  r = await call('/reports/time/save', { name: 'Sky', pin: '3333', employee_id: 1, clock_in: '2026-09-29T09:00', clock_out: '2026-09-29T15:00' });
  check('an admin adds a forgotten shift for someone', r.code === 200 && saved.at(-1).employeeId === 1 && !saved.at(-1).id);
  check('but not for someone at a shop out of view',
    (await call('/reports/time/save', { name: 'Sky', pin: '3333', employee_id: 9, clock_in: '2026-09-29T09:00' })).code === 404);
  check('an employee cannot delete a shift', (await call('/reports/time/delete', { name: 'Ana', pin: '1111', id: 70 })).code === 403);
  check('a manager can', (await call('/reports/time/delete', { name: 'Mo', pin: '2222', id: 70 })).code === 200 && deleted.includes(70));

  console.log('\n── Managers see what an admin sees in Reports ──');
  r = await call('/reports/payroll', { name: 'Mo', pin: '2222', payday: '2026-10-15' });
  check('a manager opens payroll', r.code === 200, JSON.stringify(r.body));
  check('an employee still cannot', (await call('/reports/payroll', { name: 'Ana', pin: '1111', payday: '2026-10-15' })).code === 403);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pos.js'), 'utf8');
  const routeSrc = (p) => { const a = src.indexOf(`router.post('${p}'`); return src.slice(a, src.indexOf('\n});', a)); };
  check('linking stores stays admin-only', /!isAdmin\(mine\)/.test(routeSrc('/company-links')));
  check('so does closing the account', /!isAdmin\(employee\)/.test(routeSrc('/close-account')));
  for (const p of ['/reports/payroll/paid', '/reports/payroll/adjustment', '/reports/payroll/hold', '/reports/payroll/paid-employee', '/reports/chargebacks']) {
    check(`${p} lets a manager in`, /seesBooks\(/.test(routeSrc(p)) && !/isAdmin\(/.test(routeSrc(p)));
  }

  console.log('\n── Build your own, switched off ──');
  settings = { ...settings, build_your_own_enabled: 0 };
  r = await call('/transactions', { type: 'sale', items: [{ product_id: 'one-off:abc', quantity: 1, unit_price: 10 }] });
  check('the server refuses a one-off line', r.code === 400 && /Build your own is switched off/.test(r.body.error), JSON.stringify(r.body));
  settings = { ...settings, build_your_own_enabled: 1 };

  console.log('\n── On the page ──');
  const TODAY = new Date().toLocaleDateString('en-CA');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  let SETTINGS = { store_name: 'Glow SF', time_clock_enabled: 0, build_your_own_enabled: 1 };
  const posted = [];
  const reply = (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (body) posted.push({ url, body });
    if (/\/settings$/.test(url)) {
      if (body) SETTINGS = { ...SETTINGS, ...body };
      return { settings: SETTINGS };
    }
    if (/employees$/.test(url)) return { employees: staff.filter(s => s.user_id === SHOP).map(({ pin, ...e }) => e) };
    if (/time-clock\/now/.test(url)) return { enabled: true, on: [{ employee_name: 'Mo', clock_in: '2026-10-01T08:00' }] };
    // Today, on this machine's clock — the box leaves the date off a time
    // from today and adds it to one from any other day.
    if (/time-clock\/punch/.test(url)) return body.action === 'in'
      ? { action: 'in', employee: body.name, clock_in: `${TODAY}T09:00` }
      : { action: 'out', employee: body.name, clock_in: `${TODAY}T09:00`, clock_out: `${TODAY}T17:30`, hours: 8.5 };
    if (/reports\/time$/.test(url)) return body.name === 'Mo'
      ? { can_edit: true, enabled: true, entries, people: [{ id: 1, name: 'Ana', company_id: SHOP }], stores: { [SHOP]: 'Glow SF' } }
      : { can_edit: false, enabled: true, entries: entries.filter(e => e.employee_name === body.name), people: [], stores: {} };
    if (/reports\/time\/save/.test(url)) return { ok: true, id: 99 };
    if (/employee-personal/.test(url)) return body.name === 'Mo'
      ? { employee: { id: 2, name: 'Mo' }, role: 'manager', report: [], returns: [] }
      : { employee: { id: 1, name: 'Ana' }, role: 'sales', report: [], returns: [] };
    return {};
  };
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts) => Promise.resolve({ ok: true, json: async () => reply(String(url), opts) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  const shown = (el) => !!el && w.getComputedStyle(el).display !== 'none';
  const settle = () => new Promise(r => setTimeout(r, 40));
  await new Promise(r => setTimeout(r, 300));

  await w.loadStoreSettings(); await settle();
  check('an existing shop (time clock 0) has no Clock In / Out button', !shown(id('timeClockBtn')));
  check('Settings shows it unticked', id('setTimeClock').checked === false);
  check('and Build your own ticked', id('setBuildYourOwn').checked === true);
  w.eval('products = []; renderProducts()');
  check('the Build your own tile is on the register', !!w.document.querySelector('#productGrid .one-off'));

  id('setTimeClock').checked = true;
  id('setBuildYourOwn').checked = false;
  await w.saveRegisterOptions(); await settle();
  const save = posted.filter(p => /\/settings$/.test(p.url)).at(-1);
  check('saving sends both switches', save && save.body.time_clock_enabled === 1 && save.body.build_your_own_enabled === 0);
  check('the button appears on the register', shown(id('timeClockBtn')));
  check('and the Build your own tile goes', !w.document.querySelector('#productGrid .one-off'));

  // A new shop: no settings saying otherwise means the clock is on.
  SETTINGS = { store_name: 'New', time_clock_enabled: 1 };
  await w.loadStoreSettings(); await settle();
  check('a new shop has the time clock on', shown(id('timeClockBtn')) && id('setTimeClock').checked);
  check('and Build your own on', !!w.document.querySelector('#productGrid .one-off'));

  await w.loadEmployees().catch(() => {}); await settle();
  w.openTimeClock(); await settle();
  check('the clock box lists the staff to choose from', [...id('tcName').options].some(o => o.value === 'Ana'));
  check('and who is on the clock now', /On the clock now:.*Mo/.test(id('tcOnClock').textContent));
  await w.punchClock('in');
  check('no name chosen says so', /Choose your name/.test(id('tcResult').textContent));
  id('tcName').value = 'Ana'; id('tcPin').value = '1111';
  await w.punchClock('in'); await settle();
  check('clocking in confirms the time', /Ana clocked in at 9:00am/.test(id('tcResult').textContent), id('tcResult').textContent);
  check('and clears the PIN for the next person', id('tcPin').value === '' && id('tcName').value === '');
  id('tcName').value = 'Ana'; id('tcPin').value = '1111';
  await w.punchClock('out'); await settle();
  check('clocking out says how long the shift was', /clocked out at 5:30pm — 8h 30m on this shift/.test(id('tcResult').textContent), id('tcResult').textContent);
  w.closeTimeClock();

  // Reports, as an employee
  id('rptStart').value = '2026-09-16'; id('rptEnd').value = '2026-09-30';
  w.eval('rptDatesChosen = true');
  id('empPersonalName2').value = 'Ana'; id('empPersonalPin').value = '1111';
  await w.unlockPersonalReport(); await settle();
  const navText = () => id('rptNav').textContent.replace(/\s+/g, ' ');
  check('an employee sees a Time clock section', /Time clock/.test(navText()) && !/Payroll/.test(navText()), navText());
  w.showReportSection('time'); await settle();
  check('with only their own shifts', /Ana/.test(id('timeBody').textContent) && !/Mo/.test(id('timeBody').textContent));
  check('and no way to edit', !shown(id('timeAddBtn')) && !id('timeBody').querySelector('tr[onclick]'));
  w.lockPersonalReport();

  // Reports, as a manager
  id('empPersonalName2').value = 'Mo'; id('empPersonalPin').value = '2222';
  await w.unlockPersonalReport(); await settle();
  check('a manager gets Payroll and Products, like an admin', /Payroll/.test(navText()) && /Products/.test(navText()), navText());
  check('and everyone\'s commissions', shown(id('rptEveryoneCard')));
  check('signed in as manager', /Mo — manager/.test(id('empPersonalName').textContent));
  w.showReportSection('time'); await settle();
  check('everyone\'s shifts', /Ana/.test(id('timeBody').textContent) && /Mo/.test(id('timeBody').textContent));
  check('hours per person', /Ana · 8h 30m/.test(id('timeBody').textContent), id('timeBody').textContent.slice(0, 200));
  check('a shift still open says so', /on the clock/.test(id('timeBody').textContent));
  check('edits are signed', /edited by Sky/.test(id('timeBody').textContent));
  check('+ Add a shift is there', shown(id('timeAddBtn')));
  id('timeBody').querySelector('tr[data-id="70"]').click();
  check('clicking a shift opens it with its times', id('shiftModal').classList.contains('show') && id('shiftIn').value === '2026-09-30T09:00' && id('shiftOut').value === '2026-09-30T17:30');
  id('shiftIn').value = '2026-09-30T08:30'; id('shiftNote').value = 'Opened early';
  await w.saveShift(); await settle();
  const sv = posted.filter(p => /time\/save/.test(p.url)).at(-1);
  check('saving sends the corrected time and note', sv && sv.body.id === 70 && sv.body.clock_in === '2026-09-30T08:30' && sv.body.note === 'Opened early' && sv.body.name === 'Mo');
  check('and closes the editor', !id('shiftModal').classList.contains('show'));
  w.openShiftEditor(null);
  check('adding a shift asks who for', shown(id('shiftWhoField')) && [...id('shiftWho').options].some(o => o.textContent === 'Ana'));
  await w.saveShift();
  check('and won\'t save without someone chosen', /Choose who/.test(id('shiftError').textContent));

  // The time clock switched off hides the section again.
  SETTINGS = { ...SETTINGS, time_clock_enabled: 0 };
  await w.loadStoreSettings(); await settle();
  check('switched off, the Time clock section goes from Reports', !/Time clock/.test(navText()));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
