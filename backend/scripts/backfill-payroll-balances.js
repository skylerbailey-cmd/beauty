// Record what every already-closed cheque came to, so the ones that ran
// negative start carrying forward. Chronological, because each payday's figure
// may include a carry from the one before it. Dry run unless --apply.
const B = '/Users/skyler/repos/beauty/backend/';
require.cache[require.resolve(B + 'src/db/index')] = {
  id: 'x', filename: 'x', loaded: true,
  exports: { getUserByEmail: () => null, getUser: () => ({}) },
};
const pg = require(B + 'src/db/postgres');
const APPLY = process.argv.includes('--apply');
const m = (n) => (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const q = async (s, p) => (await pg.pool.query(s, p)).rows;
  await pg.initSchema();
  const ids = (await pg.getAllCompanyIds()).map(c => c.user_id);
  const settings = await pg.getSettings(ids[0]);

  const paydays = (await q(`SELECT DISTINCT payday::text AS p FROM pos_payroll_runs
                            UNION SELECT DISTINCT payday::text FROM pos_payroll_employee_runs
                            ORDER BY 1`)).map(r => r.p);
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${paydays.length} closed paydays\n`);

  const owed = [];
  for (const p of paydays) {
    const run = await pg.payrollForPayday(ids, p, settings);
    // Only cheques that actually went out have a figure worth freezing.
    const closed = run.employees.filter(e => e.paid);
    const neg = closed.filter(e => Number(e.total) < -0.005);
    if (APPLY) await pg.recordPayrollBalances(ids, p, closed);
    console.log(`  ${p}  ${String(closed.length).padStart(2)} cheques recorded` +
      (neg.length ? `   ${neg.length} negative` : ''));
    for (const e of neg) {
      owed.push({ payday: p, ...e });
      console.log(`       ${String(e.employee_name).padEnd(9)} ${String(e.store_name).padEnd(16)} cheque ${m(e.total).padStart(12)}`);
    }
  }

  console.log(`\n  ${owed.length} shortfall(s), ${m(owed.reduce((s, e) => s + Number(e.total), 0))} in total`);
  console.log('  each lands on the payday straight after the one that ran short:');
  const land = {};
  for (const o of owed) {
    const next = pg.nextPaydayFor ? null : null;   // computed below from the run itself
    land[o.payday] = land[o.payday] || [];
    land[o.payday].push(o);
  }
  for (const p of Object.keys(land)) {
    const after = (await pg.payrollForPayday(ids, p, settings)).schedule;
    console.log(`    from ${p}: ${land[p].map(o => o.employee_name + ' ' + m(o.total)).join(', ')}`);
  }

  if (!APPLY) { console.log('\n  nothing written — pass --apply to write it'); await pg.pool.end(); return; }

  console.log('\n  after applying, the next open payday reads:');
  for (const p of ['2026-10-01', '2026-10-15']) {
    const run = await pg.payrollForPayday(ids, p, settings);
    const carries = run.employees.flatMap(e => (e.adjustments || [])
      .filter(a => a.kind === 'carry').map(a => ({ who: e.employee_name, amount: a.amount, total: e.total })));
    console.log(`    ${p}: total ${m(run.total)}, ${carries.length} carried line(s)`);
    for (const c of carries) console.log(`       ${String(c.who).padEnd(9)} carried ${m(c.amount).padStart(12)}  -> their cheque ${m(c.total)}`);
  }
  await pg.pool.end();
})().catch(e => { console.error('ERR', e.stack); pg.pool.end(); process.exit(1); });
