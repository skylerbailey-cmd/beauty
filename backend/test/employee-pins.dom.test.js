'use strict';
// PINs never leave the server, and changing the roster or anyone's pay needs
// a manager's (or admin's) name and PIN — the shop being signed in on this
// browser is not enough. Only an admin makes or changes an admin.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
let pass = 0, fail = 0;
// Refused either way: 403 for a wrong PIN, 409 for no PIN at all (an
// out-of-date page, told to refresh).
const refused = (c) => c === 403 || c === 409;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

const SHOP = 'shop-1', OTHER = 'shop-2';
const staff = [
  { id: 1, name: 'Ana', pin: '1111', role: 'sales', active: 1, user_id: SHOP },
  { id: 2, name: 'Mo', pin: '2222', role: 'manager', active: 1, user_id: SHOP },
  { id: 3, name: 'Sky', pin: '3333', role: 'admin', active: 1, user_id: SHOP },
  { id: 9, name: 'Zed', pin: '9999', role: 'sales', active: 1, user_id: OTHER },
  { id: 10, name: 'Mo', pin: '2222', role: 'manager', active: 1, user_id: OTHER },
];
const pgDb = require('../src/db/postgres');
const updates = [], created = [], plans = [];
pgDb.getEmployees = async (u) => staff.filter(e => e.user_id === u);
pgDb.getEmployee = async (id) => staff.find(e => e.id === id);
pgDb.verifyEmployeePin = async (pin, u, name) => staff.find(e => e.pin === pin && e.user_id === u && e.name.toLowerCase() === String(name || '').toLowerCase());
pgDb.updateEmployee = async (id, f) => { updates.push({ id, f }); };
pgDb.createEmployee = async (name, pin, role, rate, u) => { created.push({ name, pin, role, u }); return { id: 50, name, pin, role, user_id: u }; };
pgDb.getAllCommissionPlans = async () => [];
pgDb.getCommissionPlan = async () => null;
pgDb.setCommissionPlan = async (id, plan) => { plans.push({ id, plan }); };
pgDb.deleteCommissionPlan = async (id) => { plans.push({ id, deleted: true }); };
// The SQLite module, faked: only the email lookup the import uses.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { findOrCreateUserByEmail: (email) => ({ user: { id: email === 'other@x.com' ? OTHER : 'shop-3' } }) } };

const router = require('../src/routes/pos');
const handle = (p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, body = {}, params = {}) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handle(p, m)({ session: { userId: SHOP }, body, params, query: {} }, res);
  return res;
};
const MO = { manager_name: 'Mo', manager_pin: '2222' };
const SKY = { manager_name: 'Sky', manager_pin: '3333' };
const ANA = { manager_name: 'Ana', manager_pin: '1111' };

(async () => {
  console.log('\n── PINs stay on the server ──');
  const list = await call('/employees', 'get');
  check('the roster has everyone', list.body.employees.length === 3);
  check('and nobody\'s PIN', list.body.employees.every(e => !('pin' in e)) && !JSON.stringify(list.body).includes('2222'));
  const added = await call('/employees', 'post', { name: 'Lu', pin: '4444', role: 'sales', ...MO });
  check('adding someone doesn\'t send their PIN back', added.code === 200 && !('pin' in added.body.employee));

  console.log('\n── Adding and changing staff needs a manager ──');
  check('no PIN: adding someone is refused', refused((await call('/employees', 'post', { name: 'X', pin: '5555' })).code));
  check('a sales PIN: refused', (await call('/employees', 'post', { name: 'X', pin: '5555', ...ANA })).code === 403);
  check('a manager can add a manager', (await call('/employees', 'post', { name: 'Y', pin: '5555', role: 'manager', ...MO })).code === 200);
  check('but not an admin', (await call('/employees', 'post', { name: 'Z', pin: '5555', role: 'admin', ...MO })).code === 403);
  check('an admin can', (await call('/employees', 'post', { name: 'Z', pin: '5555', role: 'admin', ...SKY })).code === 200);

  let r = await call('/employees/:id', 'put', { pin: '0000' }, { id: '2' });
  check('no PIN: changing the manager\'s PIN is refused', refused(r.code) && !updates.length);
  check('a sales PIN cannot either', (await call('/employees/:id', 'put', { role: 'manager', ...ANA }, { id: '1' })).code === 403);
  check('nor can anyone deactivate someone without one', refused((await call('/employees/:id', 'put', { active: 0 }, { id: '1' })).code));
  check('another shop\'s employee is out of reach', (await call('/employees/:id', 'put', { name: 'X', ...MO }, { id: '9' })).code === 404);
  r = await call('/employees/:id', 'put', { name: 'Ana', pin: '', role: 'sales', ...MO }, { id: '1' });
  check('a blank PIN keeps theirs', r.code === 200 && !('pin' in updates.at(-1).f), JSON.stringify(updates.at(-1)));
  check('and the manager\'s own name and PIN are not saved onto them', !('manager_pin' in updates.at(-1).f));
  check('a short new PIN is refused', (await call('/employees/:id', 'put', { pin: '12', ...MO }, { id: '1' })).code === 400);
  check('a manager can\'t make themselves an admin', (await call('/employees/:id', 'put', { role: 'admin', ...MO }, { id: '2' })).code === 403);
  check('or change the admin', (await call('/employees/:id', 'put', { pin: '7777', ...MO }, { id: '3' })).code === 403);
  check('an admin can', (await call('/employees/:id', 'put', { role: 'admin', ...SKY }, { id: '2' })).code === 200);
  r = await call('/employees/:id', 'put', { title: 'Skin Specialist', phone: '555' }, { id: '1' });
  check('the business card\'s title and phone need no PIN', r.code === 200 && updates.at(-1).f.title === 'Skin Specialist');

  console.log('\n── Pay needs a manager ──');
  check('no PIN: a commission plan can\'t be set', refused((await call('/employees/:id/commission-plan', 'put', { plan_type: 'flat', base_rate: 90 }, { id: '1' })).code));
  check('nor removed', refused((await call('/employees/:id/commission-plan', 'delete', {}, { id: '1' })).code));
  check('a manager can set one', (await call('/employees/:id/commission-plan', 'put', { plan_type: 'flat', base_rate: 35, ...MO }, { id: '1' })).code === 200);
  check('but not the admin\'s', (await call('/employees/:id/commission-plan', 'put', { plan_type: 'flat', base_rate: 35, ...MO }, { id: '3' })).code === 403);
  check('another shop\'s employee\'s plan is out of reach', (await call('/employees/:id/commission-plan', 'get', {}, { id: '9' })).code === 404);

  console.log('\n── Copying another shop\'s roster ──');
  check('with no PIN, refused', (await call('/employees/import-from', 'post', { source_email: 'other@x.com' })).code === 403);
  check('a manager here who isn\'t one there is refused', (await call('/employees/import-from', 'post', { source_email: 'third@x.com', ...MO })).code === 403);
  r = await call('/employees/import-from', 'post', { source_email: 'other@x.com', ...MO });
  check('a manager at both shops can', r.code === 200 && r.body.imported === 1, JSON.stringify(r.body));

  console.log('\n── On the page ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const posted = [];
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts) => { posted.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
        return Promise.resolve({ ok: true, json: async () => (/employees$/.test(url) ? { employees: list.body.employees } : { ok: true }) }); };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(r => setTimeout(r, 300));
  w.eval(`settingsCreds = { name: 'Mo', pin: '2222' }; settingsAccess = { id: 2, name: 'Mo', role: 'manager' };`);
  await w.loadEmployees().catch(() => {});
  await w.editEmployee(1);
  check('the edit form doesn\'t show their PIN', id('empEditPin').value === '' && id('empEditPin').type === 'password');
  check('and says blank keeps it', /leave blank to keep/.test(id('empEditPin').closest('.field').textContent));
  posted.length = 0;
  await w.saveEmpEdit();
  const put = posted.find(p => p.method === 'PUT' && /employees\/1$/.test(p.url));
  check('saving without a new PIN sends none', put && !('pin' in put.body), JSON.stringify(put && put.body));
  check('and sends the manager who unlocked Settings', put && put.body.manager_name === 'Mo' && put.body.manager_pin === '2222');
  const plan = posted.find(p => /commission-plan/.test(p.url) && p.method !== 'GET');
  check('so does the commission plan', plan && plan.body && plan.body.manager_pin === '2222');
  posted.length = 0;
  id('newEmpName').value = 'Lu'; id('newEmpPin').value = '4444';
  await w.addEmployee();
  const post = posted.find(p => p.method === 'POST' && /employees$/.test(p.url));
  check('adding someone sends it too', post && post.body.manager_pin === '2222');
  posted.length = 0;
  await w.toggleEmployee(1, true);
  check('and so does deactivating someone', posted.some(p => p.method === 'PUT' && p.body.active === 0 && p.body.manager_pin === '2222'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
