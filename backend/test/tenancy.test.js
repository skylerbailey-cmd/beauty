'use strict';

// One shop must never see another's anything.
//
// This is the property the whole product rests on, and the way it has
// actually broken has never been a missing WHERE clause — it was a payroll
// scope that outlived the session that earned it, and before that a migration
// that would reassign a company's rows to a stranger. Both were found by
// somebody noticing an unfamiliar name on a screen, which is far too thin a
// net for the one thing that must not go wrong.
//
// So this does not test a list of endpoints somebody remembered to add. It
// builds two complete shops, marks every string in the second with a token
// that appears nowhere else in the world, and then goes looking for that
// token in everything the first shop can reach: every read function the data
// layer exports, and every GET the API serves. A new query that forgets to
// scope itself fails here without anyone having to think of it.
//
//   node test/tenancy.test.js            (needs DATABASE_URL)

const express = require('express');
const http = require('http');
const path = require('path');

const pgDb = require('../src/db/postgres');

// Unmistakable, and short enough to read in a failure message. If this string
// turns up in anything the first shop asks for, something is scoped wrongly.
const MARK = 'ZZOTHERSHOPZZ';

const A = 'tenancy-test-shop-a';
const B = 'tenancy-test-shop-b';

let pass = 0;
const failures = [];

function check(label, offendingValue) {
  if (offendingValue) {
    failures.push({ label, sample: String(offendingValue).slice(0, 300) });
    console.log(`  LEAK  ${label}`);
    console.log(`        ${String(offendingValue).slice(0, 200)}`);
  } else {
    pass++;
  }
}

// Anything at all in here that carries the mark is the second shop's.
function leakIn(value) {
  let json;
  try { json = JSON.stringify(value); } catch (_) { return null; }
  if (!json || !json.includes(MARK)) return null;
  const at = json.indexOf(MARK);
  return json.slice(Math.max(0, at - 120), at + 120);
}

// ─── Two shops, side by side ────────────────────────────────────────────────

async function buildShop(userId, marked) {
  const tag = (s) => (marked ? `${s} ${MARK}` : s);

  await pgDb.updateSettings(userId, {
    store_name: tag('Test Shop'),
    slug: marked ? 'tenancy-b' : 'tenancy-a',
    store_city: tag('Townsville'),
    store_email: `${marked ? 'b' : 'a'}@tenancy.example`,
    timezone: 'America/Denver',
    tax_rate: 0.08,
    receipt_footer: tag('Thanks'),
    sale_alert_recipients: '[]',
  });
  await pgDb.rememberUser(userId);

  const emp = await pgDb.createEmployee(tag('Staffer'), '4321', 'admin', 10, userId);
  await pgDb.setCommissionPlan(emp.id, { plan_type: 'flat', base_rate: 10, store_rate: 3 }, userId);

  const product = await pgDb.createCustomProduct({
    name: tag('Product'), brand: tag('Brand'), price: 120, min_price: 100,
    category: tag('Category'), description: tag('Description'),
    usage: tag('Usage'), usage_frequency: 'daily', routine_step: 'serum',
    benefits: tag('Benefits'), image: '', source_url: '',
  }, userId);

  const customerId = await pgDb.createCustomerRecord(userId, {
    name: tag('Customer'), email: `${marked ? 'b' : 'a'}.customer@tenancy.example`,
    phone: '3035550000',
  });

  const txId = await pgDb.importTransaction({
    type: 'sale', employee_id: emp.id,
    customer_name: tag('Customer'), customer_email: `${marked ? 'b' : 'a'}.customer@tenancy.example`,
    subtotal: 120, tax_amount: 9.6, total: 129.6, payment_method: 'card',
    receipt_number: tag('RCPT'), user_id: userId,
    created_at: '2026-06-15 12:00:00', tz: 'America/Denver',
    items: [{ product_id: `custom-${product.id}`, product_name: tag('Product'),
              brand: tag('Brand'), quantity: 1, unit_price: 120, line_total: 120 }],
    employees: [{ employee_id: emp.id, commission_type: 'percent', commission_value: 100, commission_amount: 120 }],
  });

  await pgDb.saveChargeback(txId, userId, {
    amount: 60, status: 'pending', opened_at: new Date('2026-07-01'),
    card_last4: '4242', note: tag('Dispute note'),
  }).catch(() => {});

  await pgDb.setProductEmailOverride(userId, 'hydrasphere-vitamin-c-serum', {
    usage_notes: tag('Our own way'), benefits: tag('Our own claim'),
  }).catch(() => {});

  await pgDb.setAvailability(userId, [{ weekday: 2, open: true, start_time: '09:00', end_time: '17:00' }]).catch(() => {});
  const treatment = await pgDb.createTreatment(userId, tag('Treatment'), 45).catch(() => null);
  if (treatment) {
    await pgDb.createAppointment({
      user_id: userId, treatment_id: treatment.id, treatment_name: tag('Treatment'),
      customer_name: tag('Customer'), customer_email: `${marked ? 'b' : 'a'}.customer@tenancy.example`,
      employee_id: emp.id, employee_name: tag('Staffer'),
      starts_at: new Date(Date.now() + 86400000).toISOString(), duration_min: 45, notes: tag('Note'),
    }).catch(() => {});
  }

  return { userId, empId: emp.id, productId: product.id, customerId, txId, slug: marked ? 'tenancy-b' : 'tenancy-a' };
}

// ─── Every read the data layer offers ───────────────────────────────────────
//
// Introspected rather than listed, so a function added next month is covered
// without anybody remembering to come back here.

const FROM = '2020-01-01 00:00:00';
const TO = '2099-12-31 23:59:59';

// Functions that do not take a company at all, or whose job is explicitly to
// look across companies. Each needs a reason.
const NOT_SCOPED = new Set([
  'initSchema', 'query', 'pool', 'slugify',
  // Asked for by address, by anyone, on purpose: the public booking page.
  'getAppointmentByToken',
  // Answers "does this address exist", used to word an email. Never reaches a
  // browser — see the note on it in the data layer.
  'emailHasAccount',
  // Takes a company id and returns the ids in scope; scope itself is the
  // thing under test elsewhere.
  'getAllCompanyIds',
  // Take an id that already belongs to a company, not a company id.
  'getEmployee', 'getCustomer', 'getSentEmail', 'getTreatment', 'getAppointment',
  'listChargebacks', 'getCommissionPlan', 'consumeLoginLink', 'createLoginLink',
  'purgeLoginLinks', 'rememberUser', 'deleteCompany', 'setChargebackHold',
  'getCompanyBySlug', 'getCompanySlug', 'getCompanyName',
]);

async function sweepDataLayer(shopA) {
  console.log('\n── Every read the data layer offers ──');
  const names = Object.keys(pgDb)
    .filter((k) => typeof pgDb[k] === 'function')
    .filter((k) => /^(get|list|count|calculate|find|payroll|chargebacks|top|employee|booking|available|treatments|appointments)/i.test(k))
    .filter((k) => !NOT_SCOPED.has(k))
    .sort();

  let called = 0, skipped = [];
  for (const name of names) {
    const fn = pgDb[name];
    // Try the shapes these functions actually take, commonest first.
    const attempts = [
      [shopA.userId],
      [shopA.userId, FROM, TO],
      [shopA.userId, '2026-06-15'],
      [shopA.empId, shopA.userId, FROM, TO],
      [shopA.userId, FROM, TO, {}],
      [shopA.userId, {}],
    ];
    let ran = false;
    for (const args of attempts) {
      try {
        const out = await fn(...args);
        if (out === undefined) continue;
        check(`${name}()`, leakIn(out));
        called++; ran = true;
        break;
      } catch (_) { /* wrong shape — try the next */ }
    }
    if (!ran) skipped.push(name);
  }
  console.log(`        ${called} read functions exercised`);
  if (skipped.length) console.log(`        not callable with a company id alone: ${skipped.join(', ')}`);
  return { called, skipped };
}

// ─── Every GET the API serves ───────────────────────────────────────────────

function buildApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; res.cookie = () => res; next(); });
  app.use('/api/pos', require('../src/routes/pos'));
  app.use('/api/welcome', require('../src/routes/welcome').router);
  app.use('/api/signup', require('../src/routes/signup'));
  app.use('/auth', require('../src/routes/login'));
  return app;
}

// Every GET the routers registered, with path parameters filled in from the
// FIRST shop's own rows — asking for its own things, and checking that what
// comes back is only ever its own.
function registeredGets(app, shopA) {
  const out = [];
  const fill = (p) => p
    .replace(':id', shopA.txId)
    .replace(':productId', `custom-${shopA.productId}`)
    .replace(':token', 'nonexistent-token')
    .replace(/:[A-Za-z_]+/g, '1');
  for (const layer of app._router.stack) {
    if (!layer.handle || !layer.handle.stack) continue;
    const mount = layer.regexp.source
      .replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\$$/, '');
    for (const r of layer.handle.stack) {
      if (!r.route || !r.route.methods.get) continue;
      out.push(mount + fill(r.route.path));
    }
  }
  return [...new Set(out)];
}

async function sweepRoutes(shopA) {
  console.log('\n── Every GET the API serves ──');
  const session = { userId: shopA.userId, save: (cb) => cb && cb() };
  const app = buildApp(session);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const get = (p) => new Promise((resolve) => {
    const req = http.request({ port, path: p, method: 'GET',
      headers: { 'x-forwarded-host': 'tenancy-a.sky-sale.com' } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.end();
  });

  const paths = registeredGets(app, shopA);
  let hit = 0;
  for (const p of paths) {
    const res = await get(p);
    if (!res.status) continue;
    hit++;
    check(`GET ${p}`, res.body.includes(MARK)
      ? res.body.slice(Math.max(0, res.body.indexOf(MARK) - 120), res.body.indexOf(MARK) + 120)
      : null);
  }
  console.log(`        ${hit} of ${paths.length} GET routes answered`);
  server.close();
  return hit;
}

// ─── A scope that was never granted ─────────────────────────────────────────

async function sweepForgedScope(shopA, shopB) {
  console.log('\n── A scope nobody authorised ──');
  // The bug that actually happened: a session carrying a combined view into a
  // company it was not granted for. Asserting the session cannot simply name
  // another company and be believed.
  const session = { userId: shopA.userId, companyScope: [shopA.userId, shopB.userId] };
  const app = buildApp(session);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const res = await new Promise((resolve) => {
    const req = http.request({ port, path: '/api/pos/employees', method: 'GET' },
      (r2) => { let b = ''; r2.on('data', (c) => b += c); r2.on('end', () => resolve(b)); });
    req.on('error', () => resolve(''));
    req.end();
  });
  // The roster is deliberately single-company whatever the scope says.
  check('GET /api/pos/employees with a forged scope', res.includes(MARK) ? res.slice(0, 300) : null);
  server.close();
}

// ─── Run ────────────────────────────────────────────────────────────────────

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required — this test needs a real database.');
    process.exit(2);
  }
  await pgDb.initSchema();

  for (const u of [A, B]) await pgDb.deleteCompany(u).catch(() => {});
  for (const slug of ['tenancy-a', 'tenancy-b']) {
    const held = await pgDb.getCompanyBySlug(slug);
    if (held) await pgDb.deleteCompany(held.user_id).catch(() => {});
  }

  const shopA = await buildShop(A, false);
  const shopB = await buildShop(B, true);
  console.log(`Built two shops. Everything belonging to the second is marked ${MARK}.`);

  const sweep = await sweepDataLayer(shopA);
  const routes = await sweepRoutes(shopA);
  await sweepForgedScope(shopA, shopB);

  // A test that exercises nothing passes for the wrong reason.
  console.log('\n── The test itself did something ──');
  if (sweep.called < 20) { failures.push({ label: `only ${sweep.called} read functions were exercised`, sample: '' }); }
  else { console.log(`  ok    ${sweep.called} read functions`); pass++; }
  if (routes < 10) { failures.push({ label: `only ${routes} GET routes answered`, sample: '' }); }
  else { console.log(`  ok    ${routes} GET routes`); pass++; }

  // Nothing that answers without a session. A debug endpoint mounted above
  // the auth middleware is how three of them sat on the public internet, one
  // of them listing every user's email address.
  console.log('\n── Nothing answers without a session ──');
  {
    const anon = buildApp({});
    const srv = http.createServer(anon);
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const open = [];
    for (const p2 of registeredGets(anon, shopA)) {
      // Public by design, each for a reason: the customer's own booking page,
      // anything that signs somebody in, and the check for whether a shop
      // address is free — which has to answer before anyone has an account.
      if (p2.startsWith('/api/booking') || p2.startsWith('/auth')
          || p2 === '/api/signup/slug-available') continue;
      const body = await new Promise((resolve) => {
        const req = http.request({ port, path: p2, method: 'GET' },
          (r2) => { let b = ''; r2.on('data', (c) => b += c); r2.on('end', () => resolve({ s: r2.statusCode, b })); });
        req.on('error', () => resolve({ s: 0, b: '' }));
        req.setTimeout(8000, () => { req.destroy(); resolve({ s: 0, b: '' }); });
        req.end();
      });
      if (body.s === 200) open.push(p2);
    }
    if (open.length) {
      for (const p2 of open) failures.push({ label: `GET ${p2} answers with no session`, sample: '' });
      console.log(`  OPEN  ${open.length} route(s) answered without signing in`);
      for (const p2 of open) console.log(`        ${p2}`);
    } else {
      console.log('  ok    every route asked for a session'); pass++;
    }
    srv.close();
  }

  // And that the mark would have been found if it were there.
  const canary = leakIn({ shop: `Somebody else ${MARK}` });
  if (!canary) { failures.push({ label: 'the leak detector does not detect leaks', sample: '' }); }
  else { console.log('  ok    the detector finds a planted leak'); pass++; }

  for (const u of [A, B]) await pgDb.deleteCompany(u).catch(() => {});

  console.log(`\n${pass} checks passed, ${failures.length} leaked\n`);
  if (failures.length) {
    console.log('Each of these returned data belonging to another company:');
    for (const f of failures) console.log(`  • ${f.label}`);
  }
  process.exit(failures.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
