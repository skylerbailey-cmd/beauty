'use strict';
// Setting a wage or salary: a manager's job, never in the register's roster,
// and on the Edit Employee dialog with what it comes to per paycheck.
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
const SHOP = 'shop-1';
const staff = [
  { id: 1, name: 'Ana', pin: '1111', role: 'sales', active: 1, user_id: SHOP, commission_rate: 35 },
  { id: 2, name: 'Mo', pin: '2222', role: 'manager', active: 1, user_id: SHOP, commission_rate: 0 },
  { id: 3, name: 'Sky', pin: '3333', role: 'admin', active: 1, user_id: SHOP, commission_rate: 0 },
  { id: 9, name: 'Zed', pin: '9999', role: 'sales', active: 1, user_id: 'shop-2' },
];
const pgDb = require('../src/db/postgres');
const setCalls = [];
pgDb.getEmployees = async (u) => staff.filter(e => e.user_id === u);
pgDb.getEmployee = async (id) => staff.find(e => e.id === id);
pgDb.getAllCommissionPlans = async () => [];
pgDb.getCommissionPlan = async () => null;
pgDb.verifyEmployeePin = async (pin, u, name) => staff.find(e => e.pin === pin && e.user_id === u && e.name.toLowerCase() === String(name || '').toLowerCase());
pgDb.currentPay = async () => ({ today: '2026-10-02', pay: { 1: { current: { pay_type: 'hourly', hourly_rate: 18, annual_salary: 0, effective_from: '2026-09-01' }, upcoming: null } } });
pgDb.setPay = async (f) => { setCalls.push(f); };
const router = require('../src/routes/pos');
const handle = (p, m) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.slice(-1)[0].handle;
const call = async (p, m, body = {}, params = {}) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handle(p, m)({ session: { userId: SHOP }, body, params, query: {} }, res);
  return res;
};
const MO = { manager_name: 'Mo', manager_pin: '2222' };

(async () => {
  console.log('\n── On the server ──');
  const roster = await call('/employees', 'get');
  check('the register\'s roster carries no pay', !/hourly_rate|annual_salary|pay_type/.test(JSON.stringify(roster.body)));
  check('reading pay needs a manager', (await call('/employees/pay', 'post', {})).code === 403);
  check('a sales PIN won\'t do', (await call('/employees/pay', 'post', { manager_name: 'Ana', manager_pin: '1111' })).code === 403);
  check('a manager reads it', (await call('/employees/pay', 'post', MO)).body.pay[1].current.hourly_rate === 18);
  check('setting pay needs a manager', (await call('/employees/:id/pay', 'put', { pay_type: 'hourly', hourly_rate: 20 }, { id: '1' })).code === 403);
  check('only for this shop\'s staff', (await call('/employees/:id/pay', 'put', { pay_type: 'hourly', hourly_rate: 20, ...MO }, { id: '9' })).code === 404);
  check('a manager can\'t set the admin\'s pay', (await call('/employees/:id/pay', 'put', { pay_type: 'salary', annual_salary: 90000, ...MO }, { id: '3' })).code === 403);
  check('nonsense types are refused', (await call('/employees/:id/pay', 'put', { pay_type: 'weekly', ...MO }, { id: '1' })).code === 400);
  check('hourly needs a rate', (await call('/employees/:id/pay', 'put', { pay_type: 'hourly', hourly_rate: 0, ...MO }, { id: '1' })).code === 400);
  check('salary needs an amount', (await call('/employees/:id/pay', 'put', { pay_type: 'salary', ...MO }, { id: '1' })).code === 400);
  let r = await call('/employees/:id/pay', 'put', { pay_type: 'hourly', hourly_rate: 20.5, ...MO }, { id: '1' });
  check('a manager sets a wage, from today by default', r.code === 200 && setCalls.at(-1).effectiveFrom === '2026-10-02' && setCalls.at(-1).hourlyRate === 20.5 && setCalls.at(-1).createdBy === 'Mo');
  r = await call('/employees/:id/pay', 'put', { pay_type: 'salary', annual_salary: 52000, effective_from: '2026-09-16', ...MO }, { id: '1' });
  check('or a salary from a chosen day', r.code === 200 && setCalls.at(-1).payType === 'salary' && setCalls.at(-1).effectiveFrom === '2026-09-16');
  check('back to commission only', (await call('/employees/:id/pay', 'put', { pay_type: 'none', ...MO }, { id: '1' })).code === 200);

  console.log('\n── On the page ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const posted = [];
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts) => {
        const body = opts?.body ? JSON.parse(opts.body) : null;
        posted.push({ url: String(url), method: opts?.method || 'GET', body });
        const reply = /employees\/pay$/.test(url) ? { today: '2026-10-02', pay: { 1: { current: { pay_type: 'hourly', hourly_rate: 18, annual_salary: 0, effective_from: '2026-09-01' } } } }
          : /\/employees$/.test(url) ? { employees: roster.body.employees } : { ok: true };
        return Promise.resolve({ ok: true, json: async () => reply });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(r => setTimeout(r, 300));
  w.eval(`settingsCreds = { name: 'Mo', pin: '2222' }; settingsAccess = { id: 2, name: 'Mo', role: 'manager' }; storeSettings.payroll_paydays = '1,15'; storeSettings.time_clock_enabled = 1;`);
  await w.loadEmployees();
  check('the Settings roster shows the wage', /\$18\.00\/h/.test(id('empList').textContent), id('empList').textContent.slice(0, 200));
  await w.editEmployee(1);
  check('the dialog opens on their current pay', id('empEditPayType').value === 'hourly' && id('empEditHourly').value === '18');
  check('starting today by default', id('empEditPayFrom').value === '2026-10-02');
  check('and says what 40 hours comes to', /40 hours would be \$720\.00/.test(id('empEditPayNote').textContent), id('empEditPayNote').textContent);
  id('empEditPayType').value = 'salary'; w.updateEmpPayUI();
  id('empEditSalary').value = '48000'; w.updateEmpPayUI();
  check('salary shows what each paycheck gets', /\$2,000\.00/.test(id('empEditPayNote').textContent) && /24 paychecks/.test(id('empEditPayNote').textContent), id('empEditPayNote').textContent);
  check('only the salary field shows', id('empEditSalaryField').style.display === '' && id('empEditHourlyField').style.display === 'none');
  posted.length = 0;
  await w.saveEmpEdit();
  const put = posted.find(p => /employees\/1\/pay$/.test(p.url));
  check('saving sends the salary, the day it starts, and the manager', put && put.body.pay_type === 'salary' && put.body.annual_salary === 48000
    && put.body.effective_from === '2026-10-02' && put.body.manager_pin === '2222', JSON.stringify(put && put.body));
  await w.editEmployee(1);
  posted.length = 0;
  await w.saveEmpEdit();
  check('saving without touching pay sends no pay change', !posted.some(p => /\/pay$/.test(p.url) && p.method === 'PUT'));
  w.eval('storeSettings.time_clock_enabled = 0');
  id('empEditPayType').value = 'hourly'; w.updateEmpPayUI();
  check('hourly with the time clock off warns', /time clock is off/.test(id('empEditPayNote').textContent));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
