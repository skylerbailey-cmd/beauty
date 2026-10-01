'use strict';
// Who did the return.
//
// The register is open to anyone at the counter, so a refund used to have no
// person against it: the employees on a return are the ones its commission
// comes off, and the manager whose code let it through (past the window, or
// to a card the sale was not on) was checked and then forgotten.
//
// Now every return asks for the name and PIN of whoever is putting it through,
// and keeps it — with the approving manager when there was one — on the
// receipt, in the transaction list, in Reports → Returns and in the export.
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
delete process.env.STRIPE_SECRET_KEY;
const pgDb = require('../src/db/postgres');
const EMPLOYEES = [
  { id: 1, name: 'Mia', role: 'manager', active: 1 },
  { id: 2, name: 'Bo', role: 'sales', active: 1 },
  { id: 3, name: 'Cy', role: 'sales', active: 1 },
];
const PINS = { '9999': EMPLOYEES[0], '1111': EMPLOYEES[1], '3333': EMPLOYEES[2] };
pgDb.verifyEmployeePin = async (pin) => PINS[pin] || null;
pgDb.getEmployees = async () => EMPLOYEES;
pgDb.getEmployee = async (id) => EMPLOYEES.find(e => e.id === id);
let returnWindow = 30;
pgDb.getSettings = async () => ({ store_name: 'Glow SF', return_window_days: returnWindow, tax_rate: 0.08 });
pgDb.getCustomProducts = async () => [];
pgDb.getProductPrices = async () => [];
pgDb.findRecentDuplicate = async () => null;
let saleAgeDays = 3;
pgDb.getTransactionByReceipt = async () => ({
  id: 10, type: 'sale', receipt_number: '1042', created_at: new Date(Date.now() - saleAgeDays * 86400000),
  card_last4: '4242', payments: [{ method: 'card', card_last4: '4242', amount: 50 }],
  employees: [{ employee_id: 2, employee_name: 'Bo' }],
});
let created = null;
pgDb.createTransaction = async (tx) => { created = tx; return { id: 99, receipt_number: 'R1042' }; };
pgDb.addTransactionItems = async () => {};
pgDb.addTransactionEmployees = async () => {};
pgDb.findOrCreateCustomer = async () => ({ id: 1 });
pgDb.addCustomerProducts = async () => {};
pgDb.getTransaction = async () => ({ id: 99, ...created });
pgDb.getSubscription = async () => null;

const router = require('../src/routes/pos');
const handler = router.stack.find(l => l.route && l.route.path === '/transactions' && l.route.methods.post).route.stack.slice(-1)[0].handle;
const post = async (body) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ session: { userId: 'u1' }, body }, res);
  return res;
};
const RETURN = {
  type: 'return', original_receipt: '1042',
  employees: [{ employee_id: 2, commission_type: 'percent', commission_value: 100 }],
  items: [{ product_id: 'p1', product_name: 'Hydra Serum', quantity: 1, unit_price: 46.3 }],
  payments: [{ method: 'card', amount: 50, card_last4: '4242' }], payment_method: 'card', card_last4: '4242',
};

(async () => {
  console.log('\n── A return needs a person ──');
  created = null;
  let r = await post({ ...RETURN });
  check('without a name and PIN it is refused', r.code === 403 && r.body.needsProcessor === true && created === null);
  r = await post({ ...RETURN, processor_name: 'Bo', processor_pin: '0000' });
  check('a wrong PIN is refused', r.code === 403 && r.body.needsProcessor && /do not match/.test(r.body.error) && created === null);
  r = await post({ ...RETURN, processor_name: 'Cy', processor_pin: '1111' });
  check('someone else’s PIN under your name is refused', r.code === 403 && created === null);

  r = await post({ ...RETURN, processor_name: 'cy', processor_pin: '3333' });
  check('with their own, it goes through', r.code === 200, JSON.stringify(r.body));
  check('and records who put it through', created.processed_by_id === 3 && created.processed_by_name === 'Cy');
  check('with no approver when none was needed', created.approved_by_id === null && created.approved_by_name === '');
  check('commission still comes off the sale’s employees, separately', created.type === 'return');

  console.log('\n── When a manager has to approve it ──');
  saleAgeDays = 45;
  created = null;
  r = await post({ ...RETURN, processor_name: 'Cy', processor_pin: '3333' });
  check('past the window it waits for a manager', r.code === 403 && r.body.needsManagerOverride && created === null);
  r = await post({ ...RETURN, processor_name: 'Cy', processor_pin: '3333', manager_name: 'Mia', manager_pin: '9999' });
  check('approved, both people are kept', r.code === 200 && created.processed_by_name === 'Cy' && created.approved_by_name === 'Mia' && created.approved_by_id === 1);
  saleAgeDays = 3;
  created = null;
  r = await post({ ...RETURN, payments: [{ method: 'card', amount: 50, card_last4: '1111' }], card_last4: '1111',
    processor_name: 'Bo', processor_pin: '1111', manager_name: 'Mia', manager_pin: '9999' });
  check('a refund to a different card keeps its approver too', r.code === 200 && created.approved_by_name === 'Mia' && created.processed_by_name === 'Bo');

  console.log('\n── A sale is unchanged ──');
  created = null;
  r = await post({ type: 'sale', customer_name: 'Dana', customer_email: 'dana@example.com',
    employees: [{ employee_id: 2, commission_type: 'percent', commission_value: 100 }],
    items: [{ product_id: 'p1', product_name: 'Hydra Serum', quantity: 1, unit_price: 46.3 }],
    payments: [{ method: 'cash', amount: 50 }], payment_method: 'cash' });
  check('no PIN is asked for a sale', r.code === 200 && created.processed_by_name === '', JSON.stringify(r.body));

  console.log('\n── It is stored, and read back ──');
  const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'postgres.js'), 'utf8');
  check('the columns exist', ['processed_by_id', 'processed_by_name', 'approved_by_id', 'approved_by_name']
    .every(c => db.includes(`ADD COLUMN IF NOT EXISTS ${c}`)));
  check('they are written', /processed_by_id, processed_by_name, approved_by_id, approved_by_name\)/.test(db));
  check('Reports → Returns reads them', /t\.processed_by_name, t\.approved_by_name,/.test(db));

  // ── The register ──
  console.log('\n── At the till ──');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
  const sent = [];
  let replies = [];
  const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts = {}) => {
        if (/api\/pos\/transactions$/.test(String(url)) && opts.method === 'POST') {
          sent.push(JSON.parse(opts.body));
          const [status, body] = replies.shift() || [200, { transaction: { type: 'return', receipt_number: 'R1042', items: [], employees: [], payments: [], processed_by_name: 'Cy' } }];
          return Promise.resolve({ ok: status < 400, status, json: async () => body });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
      w.HTMLElement.prototype.scrollIntoView = function () {};
    } });
  const w = dom.window;
  const id = (x) => w.document.getElementById(x);
  await new Promise(res => setTimeout(res, 300));
  w.eval(`setMode('return');
    returnOriginalTx = { receipt_number: '1042' };
    cart = [{ product_id: 'p1', product_name: 'Hydra Serum', quantity: 1, unit_price: 46.3 }];
    saleEmployees = [{ employee_id: 2, commission_value: 100 }];
    storeSettings.return_policy_points = '';
    storeSettings.tax_rate = 0.08;
    tenders = [{ method: 'cash', amount: saleTotal(), last4: '' }];`);
  w.processTransaction();
  check('Process Return asks who is doing it', id('processorModal').classList.contains('show') && !sent.length);
  w.submitProcessor();
  check('both are needed', /name and PIN/.test(id('processorError').textContent) && !sent.length);
  replies = [[403, { needsProcessor: true, error: 'That name and PIN do not match anyone here.' }]];
  id('processorName').value = 'Cy'; id('processorPin').value = '0000';
  w.submitProcessor(); await settle();
  check('a refused PIN asks again, keeping the name', id('processorModal').classList.contains('show')
    && /do not match/.test(id('processorError').textContent) && id('processorName').value === 'Cy' && id('processorPin').value === '');
  id('processorPin').value = '3333';
  w.submitProcessor(); await settle();
  const last = sent[sent.length - 1];
  check('the return goes with their name and PIN', last.type === 'return' && last.processor_name === 'Cy' && last.processor_pin === '3333');
  check('and the receipt says who processed it', /Processed by:\s*Cy/.test(id('receiptContent').textContent));

  w.eval(`setMode('return'); returnOriginalTx = { receipt_number: '1042' };
    cart = [{ product_id: 'p1', product_name: 'Hydra Serum', quantity: 1, unit_price: 46.3 }];
    saleEmployees = [{ employee_id: 2, commission_value: 100 }];
    tenders = [{ method: 'cash', amount: saleTotal(), last4: '' }];`);
  w.processTransaction();
  w.closeProcessor();
  check('cancelling puts nothing through', sent.length === 2 && w.eval('processorBody') === null);

  console.log('\n── Where it shows ──');
  const cell = w.eval(`returnPeople({ type: 'return', processed_by_name: 'Cy', approved_by_name: 'Mia' })`);
  check('the transaction list shows who did it and who approved it', /by Cy/.test(cell) && /approved by Mia/.test(cell));
  check('not on a sale', w.eval(`returnPeople({ type: 'sale', processed_by_name: 'Cy' })`) === '');
  check('a name cannot inject markup', !/<img/.test(w.eval(`returnPeople({ type: 'return', processed_by_name: '<img src=x>' })`)));
  w.eval(`renderReportReturns([{ receipt_number: 'R1042', counts_on: '2026-09-28', rung_up: '2026-09-30', customer_name: 'Dana',
    employee_name: 'Bo', processed_by_name: 'Cy', approved_by_name: 'Mia', share: -46.3 }])`);
  check('Reports → Returns has a Processed By column', /Processed By/.test(w.document.querySelector('#rptReturnsCard thead').textContent)
    && /Cy.*approved by Mia/.test(id('rptReturnsBody').textContent));
  let csv = null;
  w.eval('downloadCSV = (name, rows) => { window.__csv = rows; }');
  w.eval(`filteredTransactions = [{ receipt_number: 'R1042', created_at: '2026-09-30T15:00:00Z', type: 'return', total: 50, subtotal: 46.3, tax_amount: 3.7, items: [], employees: [], processed_by_name: 'Cy', approved_by_name: 'Mia' }];
    writeTransactionsCSV();`);
  csv = w.__csv;
  check('the export has Processed By and Approved By', csv && csv[0].slice(-2).join() === 'Processed By,Approved By' && csv[1].slice(-2).join() === 'Cy,Mia');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
