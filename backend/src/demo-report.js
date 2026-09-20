// A worked example of the report, for showing staff how to read their own.
//
// Nothing here touches the database. There is no employee record, no sale, no
// dispute — signing in as this name returns these figures and nothing else, so
// a training session can never land a fake sale in the books, move a real
// paycheck, or show one person another person's numbers.
//
// The example works at BOTH stores, because most of the roster does and it is
// the part of the report people misread: a row per store, a combined line under
// them, and one paycheck covering the two. Every figure is derived from the
// per-store lists below rather than typed twice, so a store and the combined
// line cannot drift apart.

const NAME = 'Demo';
const PIN = process.env.DEMO_REPORT_PIN || '0000';
const STORE_A = 'Training North (example)';
const STORE_B = 'Training South (example)';
const RATE = 36;                       // commission %
const ID_A = -1, ID_B = -2;            // negative: cannot collide with a real row

const round2 = (n) => Math.round(n * 100) / 100;

// Six sales across the two stores, one of them returned.
const SALES = [
  ['DEMO-1001', '2026-09-02', 'Example Customer', 1200, STORE_A],
  ['DEMO-1002', '2026-09-03', 'Second Example', 900, STORE_A],
  ['DEMO-1003', '2026-09-04', 'Third Example', 300, STORE_A],
  ['DEMO-1005', '2026-09-08', 'Fourth Example', 300, STORE_A],
  ['DEMO-1006', '2026-09-10', 'Fifth Example', 750, STORE_B],
  ['DEMO-1007', '2026-09-11', 'Sixth Example', 750, STORE_B],
];
// Counted against the day it was SOLD, rung up later — the case that confuses.
const RETURNS = [
  ['DEMO-1004', '2026-09-04', '2026-09-12', 'Third Example', 300, STORE_A],
];
const LOST_DISPUTE = 200;              // closed lost at North — commission taken back
const OPEN_DISPUTE = 1250;             // still open at North — held, not lost
const WON_DISPUTE = 500;               // won at South — money held earlier, paid back

const grossAt = (store) => round2(SALES.filter(s => s[4] === store).reduce((t, s) => t + s[3], 0));
const returnedAt = (store) => round2(RETURNS.filter(r => r[5] === store).reduce((t, r) => t + r[4], 0));
const lostAt = (store) => (store === STORE_A ? LOST_DISPUTE : 0);

// One row per store, exactly as a person working at both is reported.
function storeRow(store, id) {
  const gross = grossAt(store);
  const returned = returnedAt(store);
  const net = round2(gross - returned);
  const lost = lostAt(store);
  return {
    employee_id: id, employee_name: NAME, commission_rate: RATE,
    company_name: store, active: 1,
    sale_count: SALES.filter(s => s[4] === store).length,
    return_count: RETURNS.filter(r => r[5] === store).length,
    sales_total: gross, returns_total: returned, net_total: net,
    chargeback_count: lost ? 1 : 0, chargeback_total: lost,
    // The commission base the table reads for "Counts As". Without it the row
    // bills a lost dispute as if it had been earned.
    net_after_chargebacks: round2(net - lost),
  };
}

const rows = () => [storeRow(STORE_A, ID_A), storeRow(STORE_B, ID_B)];
const earnedAt = (store) =>
  round2(storeRow(store, 0).net_after_chargebacks * RATE / 100);
const HELD = round2(OPEN_DISPUTE * RATE / 100);          // 450.00, at North
const RELEASED = round2(WON_DISPUTE * RATE / 100);       // 180.00, at South

function isDemo(name, pin) {
  return String(name || '').trim().toLowerCase() === NAME.toLowerCase()
    && String(pin || '').trim() === PIN;
}

const employee = { id: ID_A, name: NAME, role: 'sales', commission_rate: RATE, active: 1 };

const activity = (store) => [
  ...SALES.filter(s => !store || s[4] === store).map(([receipt, day, who, amount, where], i) => ({
    transaction_id: -(200 + i), receipt_number: receipt, type: 'sale',
    counts_on: day, rung_up: day, customer_name: who,
    employee_name: NAME, store_name: where,
    subtotal: amount, total: round2(amount * 1.081875), share: amount,
    payment_method: 'card', card_last4: '',
    commission_rate: RATE, commission: round2(amount * RATE / 100), credited_count: 1,
  })),
  ...RETURNS.filter(r => !store || r[5] === store).map(([receipt, sold, back, who, amount, where], i) => ({
    transaction_id: -(100 + i), receipt_number: receipt, type: 'return',
    counts_on: sold, rung_up: back, customer_name: who,
    employee_name: NAME, store_name: where,
    subtotal: amount, total: amount, share: amount,
    commission_rate: RATE, commission: round2(amount * RATE / 100), credited_count: 1,
  })),
];

// The three states an employee will actually meet, one of them at the other
// store — so it is clear a dispute follows the sale, not the person's main shop.
const disputes = () => ([
  {
    chargeback_id: -1, status: 'pending', amount: OPEN_DISPUTE, card_last4: '',
    note: 'Example: the bank is still deciding.',
    opened_at: '2026-09-14', closed_at: null,
    withheld_payday: null, withheld_by: '', released_payday: null,
    transaction_id: -201, receipt_number: 'DEMO-1002', sale_total: 900,
    customer_name: 'Second Example', sale_date: '2026-09-03', store_name: STORE_A,
    employee_id: ID_A, employee_name: NAME, commission_rate: RATE,
    disputed_share: OPEN_DISPUTE, commission_at_risk: HELD,
  },
  {
    chargeback_id: -2, status: 'lost', amount: LOST_DISPUTE, card_last4: '',
    note: 'Example: the bank decided for the customer, so the commission goes back.',
    opened_at: '2026-08-20', closed_at: '2026-09-05',
    withheld_payday: '2026-09-15', withheld_by: 'demo', released_payday: null,
    transaction_id: -202, receipt_number: 'DEMO-0990', sale_total: LOST_DISPUTE,
    customer_name: 'Earlier Example', sale_date: '2026-08-18', store_name: STORE_A,
    employee_id: ID_A, employee_name: NAME, commission_rate: RATE,
    disputed_share: LOST_DISPUTE, commission_at_risk: round2(LOST_DISPUTE * RATE / 100),
  },
  {
    chargeback_id: -3, status: 'won', amount: WON_DISPUTE, card_last4: '',
    note: 'Example: the shop won, so the money held back is paid out again.',
    opened_at: '2026-08-02', closed_at: '2026-08-29',
    withheld_payday: '2026-09-01', withheld_by: 'demo', released_payday: '2026-09-15',
    transaction_id: -203, receipt_number: 'DEMO-0975', sale_total: WON_DISPUTE,
    customer_name: 'Older Example', sale_date: '2026-07-30', store_name: STORE_B,
    employee_id: ID_B, employee_name: NAME, commission_rate: RATE,
    disputed_share: WON_DISPUTE, commission_at_risk: RELEASED,
  },
]);

// One paycheck, a line per store — the two add up to what is actually paid.
const paycheckRows = () => ([
  {
    employee_id: ID_A, employee_name: NAME, commission_rate: RATE,
    company_id: null, store_name: STORE_A,
    sales_total: round2(grossAt(STORE_A) - returnedAt(STORE_A)),
    sale_count: SALES.filter(s => s[4] === STORE_A).length,
    returns_netted: returnedAt(STORE_A),
    commission_earned: earnedAt(STORE_A),
    adjustments: [{
      kind: 'withheld', chargeback_id: -1, employee_id: ID_A, pinned: false,
      receipt: 'DEMO-1002', amount: -HELD,
      note: 'dispute opened on the 2026-09-03 sale',
    }],
    adjustment_total: -HELD,
    commission_balance: earnedAt(STORE_A),
    total: round2(earnedAt(STORE_A) - HELD),
    paid: false, paid_at: null, paid_by: '', paid_individually: false,
  },
  {
    employee_id: ID_B, employee_name: NAME, commission_rate: RATE,
    company_id: null, store_name: STORE_B,
    sales_total: grossAt(STORE_B), sale_count: SALES.filter(s => s[4] === STORE_B).length,
    returns_netted: 0,
    commission_earned: earnedAt(STORE_B),
    adjustments: [],
    adjustment_total: 0,
    commission_balance: earnedAt(STORE_B),
    total: earnedAt(STORE_B),
    paid: false, paid_at: null, paid_by: '', paid_individually: false,
  },
]);

// The store rows and the paycheck are reached by different routes — the table
// derives commission from each row's base, the summary carries the earned
// figures. If they ever part company the demo teaches the wrong thing, so say
// so at boot rather than in front of staff.
(() => {
  const fromRows = round2(rows().reduce((t, r) => t + r.net_after_chargebacks * r.commission_rate / 100, 0));
  const fromPay = round2(paycheckRows().reduce((t, r) => t + r.commission_earned, 0));
  if (Math.abs(fromRows - fromPay) > 0.005) {
    console.warn('[demo-report] the store rows and the paycheck disagree:', fromRows, 'vs', fromPay);
  }
})();

module.exports = {
  NAME, PIN, STORE_A, STORE_B, isDemo, employee,
  // Same shapes the real routes return, so the page cannot tell the difference.
  personal: () => ({
    employee, role: 'sales', report: rows(),
    returns: activity().filter(r => r.type === 'return'),
    // Two companies, so the page adds its "both companies" line.
    companies_included: [STORE_A, STORE_B], companies_rejected: [],
  }),
  paycheck: (payday) => ({
    payday: payday || null,
    period: { start: '2026-09-01', end: '2026-09-15' },
    paid: false, rows: paycheckRows(), role: 'sales',
  }),
  chargebacks: () => ({ chargebacks: disputes(), role: 'sales' }),
  // Opened from one store's row, so it answers for that store alone.
  detail: (store) => {
    const only = store && store !== 'null' ? store : null;
    const mine = activity(only);
    return {
      employee: NAME, store: only, role: 'sales',
      sales: mine.filter(r => r.type === 'sale'),
      returns: mine.filter(r => r.type === 'return'),
      chargebacks: disputes().filter(c => c.status !== 'won' && (!only || c.store_name === only)),
      held_elsewhere: [],
    };
  },
  adjustments: () => ({ adjustments: [], payday: null, role: 'sales' }),
};
