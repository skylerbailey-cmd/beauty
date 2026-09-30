'use strict';
// Importing and exporting customers and transactions takes a manager's code.
//
// A spreadsheet of every customer's name, email and phone, or of every sale,
// is the shop's whole book leaving in one file, and an import rewrites it. A
// sales employee could do either: export was open to anyone who had unlocked
// Transactions with their own PIN, and the import endpoints checked nothing at
// all — any signed-in browser could post rows to them.
//
// Now the page asks for a manager's name and code before either (a manager
// already signed in on the tab is not asked twice), and the server refuses an
// import without one.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const MANAGERS = { '9999': 'Mia' };
const calls = [];
let downloads = 0;
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : {};
      calls.push({ url: String(url), body });
      if (/manager\/verify/.test(url)) {
        const ok = MANAGERS[body.pin] && MANAGERS[body.pin] === body.name;
        return Promise.resolve({ ok: !!ok, json: async () => ok ? { ok: true } : { error: 'Manager name and code do not match a manager for this store.' } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ created: (body.rows || []).length }) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
    w.URL.createObjectURL = () => { downloads++; return 'blob:x'; };
    w.URL.revokeObjectURL = () => {};
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const settle = () => new Promise(r => setTimeout(r, 30));
const prompting = () => id('managerAuthModal').classList.contains('show');
const approve = async (name, pin) => {
  id('managerAuthName').value = name; id('managerAuthPin').value = pin;
  await w.submitManagerAuth(); await settle();
};
const signedInAs = (role) => w.eval(`txCreds = { name: 'Bo', pin: '1111' }; txAccess = { id: 2, name: 'Bo', role: '${role}' };`);
const csvFile = (text) => ({ value: 'x', files: [{ name: 'customers.csv', text: async () => text }] });

setTimeout(async () => {
  w.eval(`storeSettings.store_name = 'Glow SF';
          filteredTransactions = [{ receipt_number: 'R-1', created_at: '2026-09-28T15:00:00Z', type: 'sale', total: 10, subtotal: 10, tax: 0, items: [], employees: [] }];
          custFiltered = [{ customer_name: 'Dana Lee', customer_email: 'dana@example.com', purchases: 1, returns: 0, total_spent: 10, employees: [], items: [] }];`);

  console.log('\n── A sales employee exporting ──');
  signedInAs('sales');
  downloads = 0;
  w.exportTransactionsCSV();
  check('asks for a manager before writing anything', prompting() && downloads === 0);
  check('and says what for', id('managerAuthTitle').textContent === 'Export Transactions'
    && /Only a manager can export transactions/.test(id('managerAuthMsg').textContent));
  await approve('Bo', '1111');
  check('their own PIN is not a manager’s code', prompting() && downloads === 0 && /do not match/.test(id('managerAuthError').textContent));
  await approve('Mia', '9999');
  check('a manager’s code writes the file', !prompting() && downloads === 1);
  check('and it is not kept for the next one', w.eval('csvManager') === null && w.eval('managerCreds') === null);

  downloads = 0;
  w.exportCustomersCSV();
  check('customers ask too', prompting() && id('managerAuthTitle').textContent === 'Export Customers' && downloads === 0);
  w.closeManagerAuth();
  check('cancelling writes nothing', !prompting() && downloads === 0 && w.eval('pendingCsvRun') === null);
  await approve('Mia', '9999');
  check('and a code typed after cancelling does not write it either', downloads === 0);

  console.log('\n── A manager already signed in ──');
  signedInAs('manager');
  downloads = 0;
  w.exportTransactionsCSV();
  check('is not asked twice — it just downloads', !prompting() && downloads === 1);
  w.exportCustomersCSV();
  check('customers too', !prompting() && downloads === 2);
  signedInAs('admin');
  w.exportCustomersCSV();
  check('and an admin', !prompting() && downloads === 3);

  console.log('\n── A sales employee importing ──');
  signedInAs('sales');
  calls.length = 0;
  await w.handleImportFile(csvFile('Name,Email\nDana Lee,dana@example.com\n'), 'customers');
  await settle();
  check('asks for a manager before reading the file', prompting() && !id('importMapModal').classList.contains('show'));
  check('titled for the import', id('managerAuthTitle').textContent === 'Import Customers');
  await approve('Mia', '9999');
  check('once approved, the file is read and its columns offered', id('importMapModal').classList.contains('show'));
  await w.confirmImportMapping(); await settle();
  const sent = calls.filter(c => /import-customers/.test(c.url));
  check('the rows went to the server', sent.length === 1 && sent[0].body.rows.length === 1);
  check('carrying the manager’s name and code, for the server to check',
    sent.every(c => c.body.manager_name === 'Mia' && c.body.manager_pin === '9999'));
  check('and the code is dropped once it is done', w.eval('csvManager') === null);

  await w.handleImportFile(csvFile('Name,Email\nSam,sam@example.com\n'), 'customers');
  await settle();
  await approve('Mia', '9999');
  w.eval("closeImportMapping(); csvManager = null;"); // the mapping dialog's Cancel
  check('cancelling at the columns drops the code too', w.eval('csvManager') === null);

  check('the import button is no longer hidden from a sales employee, so they can start one', !/importCsvBtn'\)\.style\.display = canManage/.test(html));

  console.log('\n── The server refuses an import without a manager ──');
  const pgDb = require('../src/db/postgres');
  const router = require('../src/routes/pos');
  const handler = (p) => router.stack.find(l => l.route && l.route.path === p).route.stack.slice(-1)[0].handle;
  pgDb.verifyEmployeePin = async (pin) => ({ '9999': { id: 1, name: 'Mia', role: 'manager' },
                                              '1111': { id: 2, name: 'Bo', role: 'sales' } })[pin] || null;
  pgDb.getSettings = async () => ({ store_name: 'Glow SF', timezone: 'America/Denver' });
  pgDb.getEmployees = async () => [];
  const call = async (p, body) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler(p)({ session: { userId: 1 }, body }, res);
    return res;
  };
  for (const p of ['/import-customers', '/import-transactions']) {
    check(`${p}: no code — refused`, (await call(p, { rows: [] })).code === 403);
    check(`${p}: a sales employee’s PIN — refused`, (await call(p, { rows: [], manager_name: 'Bo', manager_pin: '1111' })).code === 403);
    check(`${p}: the right code under the wrong name — refused`, (await call(p, { rows: [], manager_name: 'Bo', manager_pin: '9999' })).code === 403);
    check(`${p}: a manager — let through`, (await call(p, { rows: [], manager_name: 'Mia', manager_pin: '9999' })).code !== 403);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 300);
