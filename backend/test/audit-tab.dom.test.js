'use strict';
// The Audit tab: every saved audit, the result of whichever one is open, and
// the nightly reconciliation switch at the top.
//
// Audits used to live on the Sales tab, below the day's transactions. Running
// one scrolled a result in underneath a list nobody was reading, and the
// saved ones sat in the same place.
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
      if (/audit-auto/.test(String(url))) {
        return Promise.resolve({ ok: true, json: async () => ({
          enabled: true, alert_enabled: true, alerts_possible: false,
          timezone: 'America/Denver', at: '07:30',
          runs: [
            { audited_day: '2026-09-27', days_off: 2, difference: -6000.04, alerted: 1, note: '' },
            { audited_day: '2026-09-26', days_off: 0, difference: 0, alerted: 0, note: 'reconciled' },
            { audited_day: '2026-09-25', days_off: 0, difference: 0, alerted: 0, note: 'no processor connected' },
          ],
        }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const id = (x) => w.document.getElementById(x);
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};

setTimeout(() => {
  console.log('\n── Where things live ──');
  check('the Audit tab sits between Sales and Customers',
    [...w.document.querySelectorAll('.tx-view-btn')].map((b) => b.dataset.view).join(',') === 'sales,audit,customers');
  check('saved audits moved off the Sales tab',
    id('txViewAudit').contains(id('savedAuditsCard')) && !id('txViewSales').contains(id('savedAuditsCard')));
  check('so did the audit result', id('txViewAudit').contains(id('batchResult')));
  check('the whole result table came with it', id('txViewAudit').contains(id('batchFoot')));
  check('the sales list stayed put', id('txViewSales').contains(id('txHistoryBody')));

  console.log('\n── Switching ──');
  w.eval("switchTxView('audit')");
  check('the audit view is shown', id('txViewAudit').style.display !== 'none');
  check('sales is hidden', id('txViewSales').style.display === 'none');
  check('customers is hidden', id('txViewCustomers').style.display === 'none');
  w.eval("switchTxView('sales')");
  check('and back again', id('txViewSales').style.display !== 'none' && id('txViewAudit').style.display === 'none');

  console.log('\n── Running an audit lands on the Audit tab ──');
  id('histStart').value = '2026-09-01';
  id('histEnd').value = '2026-09-15';
  w.eval('runAudit()');
  check('the view switched', id('txViewAudit').style.display !== 'none');
  check('the tab boxes picked up the range',
    id('auditFrom').value === '2026-09-01' && id('auditTo').value === '2026-09-15',
    `${id('auditFrom').value} .. ${id('auditTo').value}`);
  check('it asked the server for that range',
    calls.some((c) => /reconciliation-audit\?from=2026-09-01&to=2026-09-15/.test(c.url)),
    calls.map((c) => c.url).join(' | '));

  console.log('\n── Running with no dates says so, on the right tab ──');
  id('histStart').value = ''; id('histEnd').value = '';
  w.eval('runAudit()');
  check('the audit view is still the one on screen', id('txViewAudit').style.display !== 'none');
  check('and it explains what is missing', /Pick a From/.test(id('batchStatus').textContent),
    id('batchStatus').textContent);

  console.log('\n── The nightly panel ──');
  setTimeout(() => {
    check('the switches are in Settings, not on the tab',
      !id('txViewAudit').contains(id('autoAuditOn')) && !!id('autoAuditOn'));
    check('they sit with the merchant connections',
      id('autoAuditOn').closest('[data-sgroup]').dataset.sgroup === 'merchant',
      id('autoAuditOn').closest('[data-sgroup]').dataset.sgroup);
    check('the switches reflect the server', id('autoAuditOn').checked && id('autoAuditAlert').checked);
    check('the chosen time is loaded', id('autoAuditAt').value === '07:30', id('autoAuditAt').value);
    check("the store's clock is named", /America\/Denver/.test(id('autoAuditTz').textContent),
      id('autoAuditTz').textContent);
    check('the Audit tab says when it runs, in words',
      /7:30am/.test(id('autoAuditState').textContent), id('autoAuditState').textContent);
    check('and points at where to change it',
      /Merchant connections/.test(id('autoAuditState').textContent));
    check('alerts on with nowhere to send says so',
      /No phone number is saved/.test(id('autoAuditSaveStatus').textContent), id('autoAuditSaveStatus').textContent);
    const runs = id('autoAuditRuns').textContent.replace(/\s+/g, ' ');
    check('a morning that did not reconcile is flagged', /did not reconcile/.test(runs), runs);
    check('with the amount', /6,000\.04/.test(runs), runs);
    check('and that it was texted', /texted/.test(runs));
    check('a clean morning reads as reconciled', /✓ reconciled/.test(runs));
    check('a morning with no processor says why', /no processor connected/.test(runs), runs);

    console.log('\n── Turning it on and off ──');
    calls.length = 0;
    id('autoAuditOn').checked = false;
    id('autoAuditAlert').checked = false;
    id('autoAuditAt').value = '06:15';
    w.eval('saveAutoAudit()');
    setTimeout(() => {
      const posted = calls.find((c) => c.method === 'POST' && /audit-auto/.test(c.url));
      check('it saves both switches and the time',
        posted && posted.body.enabled === false && posted.body.alert_enabled === false && posted.body.at === '06:15',
        JSON.stringify(posted && posted.body));

      console.log('\n── One control, one place ──');
      check('the sale-alert checkbox is still there', !!id('settingsAlertEnabled'));
      check('the mismatch switch is NOT duplicated under Sale Text Alerts',
        !id('settingsAuditAlertEnabled'));
      check('Sale Text Alerts points at where it lives',
        /Merchant connections/.test(id('settingsAlertEnabled').closest('.report-card').textContent));

      console.log(`\n${pass} passed, ${fail} failed\n`);
      process.exit(fail ? 1 : 0);
    }, 150);
  }, 200);
}, 700);
