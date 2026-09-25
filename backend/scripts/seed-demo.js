'use strict';

// A shop that has been trading for a while, for anyone who wants to see what
// SkySale looks like before they have any data of their own.
//
// Everything here is invented. No real customer, no real staff member and no
// real sale appears in it, which matters because this account is open to
// anyone who types its address — it is a showroom, not a shop.
//
// Run it again whenever the demo has been poked about in: it deletes the
// company and rebuilds it, so the figures on the reports are always the ones
// described here rather than whatever a visitor left behind.
//
//   node scripts/seed-demo.js
//
// It refuses to touch anything but the demo company.

const { v5: uuidv5 } = require('uuid');
const pgDb = require('../src/db/postgres');

// DEMO_EMAIL may list several spellings of the same shop. The account belongs
// to the first, exactly as the sign-in derives it — deriving it from the whole
// list would build a second shop with a comma in its address, which is how
// this first ran and why the slug guard below earned its keep.
const DEMO_EMAIL = String(process.env.DEMO_EMAIL || 'test@demo.com')
  .split(',')[0].trim().toLowerCase();
const DEMO_USER_ID = uuidv5('mailto:' + DEMO_EMAIL, uuidv5.URL);
const TZ = 'America/Denver';
const TAX = 0.0875;

// ─── The shop ───────────────────────────────────────────────────────────────

const STORE = {
  store_name: 'Harbour & Vine',
  slug: 'demo',
  store_address: '118 Alder Street',
  store_city: 'Boulder',
  store_state: 'CO',
  store_zip: '80302',
  store_phone: '(303) 555-0142',
  store_email: DEMO_EMAIL,
  timezone: TZ,
  tax_rate: TAX,
  brands: '[]',
  receipt_footer: 'Thank you — we love seeing you.',
  payroll_paydays: 'semi-monthly',
};

// Two roles, as asked for, and the same PIN on both: this is a demo and the
// point is that anyone can get in. A real shop would never share a PIN, which
// is why the PIN is what unlocks payroll and the money screens.
// Rates are percentages everywhere in this product — 8 means 8%, not 0.08.
// Written as fractions here at first, which would have shown a shop what a
// tenth of a percent looks like on a payslip.
const STAFF = [
  { name: 'admin', pin: '5555', role: 'admin', rate: 10,
    // A day over $2,000 earns the higher rate on that whole day — the tiered
    // plan, so the demo has one of those to look at.
    plan: { plan_type: 'daily_threshold', base_rate: 8, tier_rate: 12, tier_threshold: 2000 } },
  { name: 'employee', pin: '5555', role: 'sales', rate: 8,
    plan: { plan_type: 'flat', base_rate: 8 } },
  { name: 'Rosa', pin: '2481', role: 'manager', rate: 9,
    // Paid on her own sales and on the floor's: 9% of what she sells, plus 4%
    // of everything the shop takes.
    plan: { plan_type: 'flat', base_rate: 9, store_rate: 4 } },
  { name: 'Tomas', pin: '3694', role: 'sales', rate: 7,
    plan: { plan_type: 'flat', base_rate: 7 } },
];

// The range, taken from the catalogue this server already carries.
//
// Written out by hand at first, which left a register of grey boxes — a demo
// whose whole job is to look like a working shop. These are real products
// with real photographs, copied in as the demo's own so the shop owns its
// range the way any other shop does, rather than being switched onto a
// catalogue brand that no real new shop would have.
const { PRODUCTS: CATALOG } = require('../src/routes/welcome');

// A routine's worth, plus a couple of devices so the top-products report has
// something with a large ticket on it.
const WANTED = [
  ['hydrasphere', 'Advanced Foaming Cleanser', 'cleanser', 'daily'],
  ['hydrasphere', 'Hydra Toning Solution', 'toner', 'daily'],
  ['hydrasphere', 'Vitamin C Serum', 'serum', 'daily'],
  ['hydrasphere', 'Advanced Night Repair', 'serum', 'daily'],
  ['hydrasphere', 'Advanced Eye Lifting Serum', 'eye treatment', 'daily'],
  ['hydrasphere', 'Deep Moisturizing Cream', 'moisturizer', 'daily'],
  ['hydrasphere', 'Oxygen Brightening Cream', 'moisturizer', 'daily'],
  ['hydrasphere', 'SPF 50 Shield Cream', 'sunscreen', 'daily'],
  ['hydrasphere', 'Facial Peeling Gel', 'exfoliant', 'weekly'],
  ['hydrasphere', 'MineralLift Thermal Mask', 'mask', 'weekly'],
  ['hydrasphere', 'MineralLift Thermal Cream', 'treatment cream', 'daily'],
  ['avologi', 'Eneo Totalé', 'device treatment', 'weekly'],
  ['avologi', 'Eneo Blu', 'device treatment', 'weekly'],
];

const PRODUCTS = WANTED.map(([brandKey, name, step, freq]) => {
  const found = (CATALOG[brandKey] || []).find((p) => p.name === name);
  if (!found) throw new Error(`The catalogue has no "${name}" under ${brandKey}.`);
  return {
    name: found.name,
    price: found.retailPrice,
    // A floor a little under the asking price, so the minimum-price rule has
    // something to demonstrate.
    min: Math.round(found.retailPrice * 0.85),
    step,
    freq,
    usage: found.howToUse || '',
    benefits: found.benefits || '',
    description: found.cardDescription || found.description || '',
    image: found.image || '',
    category: step === 'device treatment' ? 'Devices' : 'Skincare',
  };
});

const CUSTOMERS = [
  ['Marguerite Oyelaran', 'm.oyelaran@example.com', '(303) 555-0118'],
  ['Devon Achterberg', 'devon.a@example.com', '(303) 555-0129'],
  ['Priya Raghunathan', 'priya.r@example.com', '(720) 555-0164'],
  ['Colm Ferreira', 'colm.f@example.com', '(303) 555-0173'],
  ['Yuki Tanaka-Brown', 'yuki.tb@example.com', '(720) 555-0155'],
  ['Amara Nwosu', 'amara.n@example.com', '(303) 555-0192'],
  ['Silje Haugen', 'silje.h@example.com', '(720) 555-0147'],
  ['Rafael Ibarra', 'r.ibarra@example.com', '(303) 555-0136'],
  ['Nadia Christoffersen', 'nadia.c@example.com', '(720) 555-0181'],
  ['Emeka Balogun', 'emeka.b@example.com', '(303) 555-0125'],
  ['Wren Lindqvist', 'wren.l@example.com', '(720) 555-0108'],
  ['Teodora Marinescu', 'teo.m@example.com', '(303) 555-0159'],
];

// Deterministic, so the demo reads the same every time it is rebuilt and a
// screenshot taken today matches one taken next week.
let seed = 20260925;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

async function main() {
  await pgDb.initSchema();

  console.log(`Rebuilding the demo company (${DEMO_EMAIL})…`);
  const gone = await pgDb.deleteCompany(DEMO_USER_ID);
  if (gone.slug) console.log(`  cleared the previous one (${gone.slug})`);

  // Anything else holding the address — a half-built earlier attempt.
  const holder = await pgDb.getCompanyBySlug(STORE.slug);
  if (holder && holder.user_id !== DEMO_USER_ID) {
    throw new Error(`The address "${STORE.slug}" belongs to another company (${holder.user_id}). Refusing to touch it.`);
  }

  await pgDb.updateSettings(DEMO_USER_ID, STORE);
  await pgDb.rememberUser(DEMO_USER_ID);
  console.log(`  ${STORE.store_name} at ${STORE.slug}`);

  // ── Staff ──
  const staff = [];
  for (const s of STAFF) {
    const emp = await pgDb.createEmployee(s.name, s.pin, s.role, s.rate, DEMO_USER_ID);
    await pgDb.setCommissionPlan(emp.id, s.plan, DEMO_USER_ID);
    staff.push({ ...s, id: emp.id });
  }
  console.log(`  ${staff.length} staff, each on a commission plan`);

  // ── Products ──
  const products = [];
  for (const p of PRODUCTS) {
    const row = await pgDb.createCustomProduct({
      name: p.name, brand: 'Harbour & Vine', price: p.price, min_price: p.min,
      category: p.category, description: p.description,
      usage: p.usage, usage_frequency: p.freq, routine_step: p.step, benefits: p.benefits,
      image: p.image,
    }, DEMO_USER_ID);
    products.push({ ...p, id: `custom-${row.id}` });
  }
  const withPictures = products.filter((p) => p.image).length;
  console.log(`  ${products.length} products, ${withPictures} with a photograph, all with usage notes and routine steps`);

  // ── Customers ──
  const customers = [];
  for (const [name, email, phone] of CUSTOMERS) {
    const id = await pgDb.createCustomerRecord(DEMO_USER_ID, { name, email, phone });
    customers.push({ id, name, email, phone });
  }
  console.log(`  ${customers.length} customers`);

  // ── Four months of trade ──
  //
  // Enough history that the reports, the pay periods and the leaderboard all
  // have something to show, and spread across the staff so the commission
  // figures differ between them.
  const today = new Date();
  const start = new Date(today); start.setMonth(start.getMonth() - 4);

  let receipts = 1000;
  let sales = 0, returns = 0, revenue = 0;
  const soldSoFar = [];

  for (let day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
    const dow = day.getDay();
    // Closed Sundays, quiet Mondays, busy at the weekend.
    if (dow === 0) continue;
    const count = dow === 1 ? between(0, 2) : (dow === 5 || dow === 6) ? between(3, 7) : between(1, 5);

    for (let i = 0; i < count; i++) {
      const emp = pick(staff);
      const customer = rnd() < 0.85 ? pick(customers) : null;
      const lines = between(1, 3);
      const items = [];
      let subtotal = 0;

      for (let l = 0; l < lines; l++) {
        // Devices sell far less often than creams, which is what makes the
        // top-products report worth looking at.
        const p = rnd() < 0.12 ? pick(products.filter((x) => x.price > 400)) : pick(products.filter((x) => x.price <= 400));
        const qty = p.price > 400 ? 1 : between(1, 2);
        const line = p.price * qty;
        items.push({ product_id: p.id, product_name: p.name, brand: 'Harbour & Vine',
          quantity: qty, unit_price: p.price, discount: 0, line_total: line });
        subtotal += line;
      }

      const tax = Math.round(subtotal * TAX * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const at = new Date(day);
      at.setHours(between(9, 18), between(0, 59), 0, 0);

      const txId = await pgDb.importTransaction({
        type: 'sale', employee_id: emp.id,
        customer_name: customer?.name || '', customer_email: customer?.email || '',
        customer_phone: customer?.phone || '',
        subtotal, tax_amount: tax, total,
        payment_method: rnd() < 0.78 ? 'card' : (rnd() < 0.5 ? 'cash' : 'other'),
        receipt_number: `HV-${++receipts}`,
        user_id: DEMO_USER_ID, created_at: iso(at), tz: TZ,
        items,
        employees: [{ employee_id: emp.id, commission_type: 'percent', commission_value: 100,
          // The share of the sale credited to them, which the payroll page
          // then applies their rate to. 100% of it — a split sale is a thing
          // the product supports but not what a demo needs to show.
          commission_amount: subtotal }],
      });
      sales++; revenue += total;
      soldSoFar.push({ txId, at: new Date(at), emp, items, subtotal, tax, total, customer, receipt: `HV-${receipts}` });
    }
  }

  // ── A few returns, so the commission rules have something to bite on ──
  //
  // Deliberately of sales made in an earlier month: a return counts against
  // the month the item sold, which is the rule the payroll page exists to get
  // right and the one worth being able to see working.
  const older = soldSoFar.filter((s) => s.at < new Date(today.getFullYear(), today.getMonth(), 1));
  for (let i = 0; i < 6 && older.length; i++) {
    const original = older[Math.floor(rnd() * older.length)];
    const line = original.items[0];
    const subtotal = -line.line_total;
    const tax = Math.round(subtotal * TAX * 100) / 100;
    const at = new Date(original.at);
    at.setDate(at.getDate() + between(20, 50));
    if (at > today) continue;

    await pgDb.importTransaction({
      type: 'return', employee_id: original.emp.id,
      customer_name: original.customer?.name || '', customer_email: original.customer?.email || '',
      subtotal, tax_amount: tax, total: Math.round((subtotal + tax) * 100) / 100,
      payment_method: 'card',
      receipt_number: `HV-R${++receipts}`,
      user_id: DEMO_USER_ID, created_at: iso(at), tz: TZ,
      items: [{ ...line, quantity: -line.quantity, line_total: subtotal }],
      employees: [{ employee_id: original.emp.id, commission_type: 'percent', commission_value: 100,
        commission_amount: subtotal }],
    });
    returns++;
  }

  console.log(`  ${sales} sales and ${returns} returns over four months, $${Math.round(revenue).toLocaleString()} taken`);

  // ── Something in the diary ──
  try {
    await pgDb.setAvailability(DEMO_USER_ID, [
      { weekday: 0, open: false, start_time: '10:00', end_time: '16:00' },
      { weekday: 1, open: true, start_time: '10:00', end_time: '17:00' },
      { weekday: 2, open: true, start_time: '09:00', end_time: '18:00' },
      { weekday: 3, open: true, start_time: '09:00', end_time: '18:00' },
      { weekday: 4, open: true, start_time: '09:00', end_time: '19:00' },
      { weekday: 5, open: true, start_time: '09:00', end_time: '19:00' },
      { weekday: 6, open: true, start_time: '10:00', end_time: '16:00' },
    ]);
    const made = [];
    for (const [name, mins] of [['Signature Facial', 60], ['Microcurrent Lift', 45],
                                ['LED Resurfacing', 30], ['Consultation', 30]]) {
      made.push(await pgDb.createTreatment(DEMO_USER_ID, name, mins));
    }
    let booked = 0;
    for (let i = 1; i <= 10; i++) {
      const when = new Date(today);
      when.setDate(when.getDate() + i);
      if (when.getDay() === 0) continue;
      when.setHours(between(10, 15), rnd() < 0.5 ? 0 : 30, 0, 0);
      const c = pick(customers);
      const t = pick(made);
      const who = pick(staff);
      await pgDb.createAppointment({
        user_id: DEMO_USER_ID,
        treatment_id: t.id, treatment_name: t.name,
        customer_name: c.name, customer_email: c.email, customer_phone: c.phone,
        employee_id: who.id, employee_name: who.name,
        starts_at: when.toISOString(), duration_min: t.duration_min, notes: '',
      });
      booked++;
    }
    console.log(`  opening hours, ${made.length} treatments and ${booked} bookings in the next fortnight`);
  } catch (err) {
    console.log(`  (skipped the diary: ${err.message})`);
  }

  console.log(`\nDone. Sign in as ${DEMO_EMAIL} — admin/5555 for everything, employee/5555 for the till.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Could not build the demo:', err.message);
  process.exit(1);
});
