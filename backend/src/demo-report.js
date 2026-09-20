// A worked example of the report, for showing staff how to read their own.
//
// Nothing here touches the database. There is no employee record, no sale, no
// dispute — signing in as this name returns these figures and nothing else, so
// a training session can never land a fake sale in the books, move a real
// paycheck, or show one person another person's numbers.
//
// The figures are arranged so the arithmetic on screen can be followed all the
// way down: six sales, one of them returned, one dispute lost and one still
// open. Everything below is derived from these few numbers rather than typed
// twice, so the page can't contradict itself.

const NAME = 'Demo';
const PIN = process.env.DEMO_REPORT_PIN || '0000';
const STORE = 'Training Store (example)';
const RATE = 36;                       // commission %
const EMPLOYEE_ID = -1;                // negative: cannot collide with a real row

const GROSS = 4200;                    // six sales
const RETURNED = 300;                  // one of them came back
const LOST_DISPUTE = 200;              // a dispute closed lost — commission taken back
const OPEN_DISPUTE = 1250;             // a dispute still open — commission held, not lost

const round2 = (n) => Math.round(n * 100) / 100;
const NET = round2(GROSS - RETURNED);                       // 3,900.00
const COUNTS_AS = round2(NET - LOST_DISPUTE);               // 3,700.00
const EARNED = round2(COUNTS_AS * RATE / 100);              // 1,332.00
const HELD = round2(OPEN_DISPUTE * RATE / 100);             //   450.00
const TAKE_HOME = round2(EARNED - HELD);                    //   882.00

// Is this the training login? Checked before any real PIN lookup, and only
// matches on both the name and the PIN together.
function isDemo(name, pin) {
  return String(name || '').trim().toLowerCase() === NAME.toLowerCase()
    && String(pin || '').trim() === PIN;
}

const employee = { id: EMPLOYEE_ID, name: NAME, role: 'sales', commission_rate: RATE, active: 1 };

// The commission row: six sales, net of the return, less the lost dispute.
const reportRow = () => ({
  employee_id: EMPLOYEE_ID, employee_name: NAME, commission_rate: RATE,
  company_name: STORE, active: 1,
  sale_count: 6, return_count: 1,
  sales_total: GROSS, returns_total: RETURNED, net_total: NET,
  chargeback_total: LOST_DISPUTE,
});

// The return behind that figure, dated the way a real one is: counted against
// the day the item was SOLD, rung up later.
const returns = () => ([{
  transaction_id: -101, receipt_number: 'DEMO-1004', type: 'return',
  counts_on: '2026-09-04', rung_up: '2026-09-12',
  customer_name: 'Example Customer', employee_name: NAME, store_name: STORE,
  subtotal: RETURNED, total: RETURNED, share: RETURNED,
  commission_rate: RATE, commission: round2(RETURNED * RATE / 100), credited_count: 1,
}]);

const sales = () => ([
  ['DEMO-1001', '2026-09-02', 'Example Customer', 1200],
  ['DEMO-1002', '2026-09-03', 'Second Example', 900],
  ['DEMO-1003', '2026-09-04', 'Third Example', 300],
  ['DEMO-1005', '2026-09-08', 'Fourth Example', 650],
  ['DEMO-1006', '2026-09-10', 'Fifth Example', 400],
  ['DEMO-1007', '2026-09-11', 'Sixth Example', 750],
].map(([receipt, day, who, amount], i) => ({
  transaction_id: -(200 + i), receipt_number: receipt, type: 'sale',
  counts_on: day, rung_up: day, customer_name: who,
  employee_name: NAME, store_name: STORE,
  subtotal: amount, total: round2(amount * 1.081875), share: amount,
  payment_method: 'card', card_last4: '',
  commission_rate: RATE, commission: round2(amount * RATE / 100), credited_count: 1,
})));

// One dispute lost, one still open, one won and given back — the three states
// an employee will actually meet.
const chargebacks = () => ([
  {
    chargeback_id: -1, status: 'pending', amount: OPEN_DISPUTE, card_last4: '',
    note: 'Example: the bank is still deciding.',
    opened_at: '2026-09-14', closed_at: null,
    withheld_payday: null, withheld_by: '', released_payday: null,
    transaction_id: -201, receipt_number: 'DEMO-1002', sale_total: 900,
    customer_name: 'Second Example', sale_date: '2026-09-03', store_name: STORE,
    employee_id: EMPLOYEE_ID, employee_name: NAME, commission_rate: RATE,
    disputed_share: OPEN_DISPUTE, commission_at_risk: HELD,
  },
  {
    chargeback_id: -2, status: 'lost', amount: LOST_DISPUTE, card_last4: '',
    note: 'Example: the bank decided for the customer, so the commission goes back.',
    opened_at: '2026-08-20', closed_at: '2026-09-05',
    withheld_payday: '2026-09-15', withheld_by: 'demo', released_payday: null,
    transaction_id: -202, receipt_number: 'DEMO-0990', sale_total: 200,
    customer_name: 'Earlier Example', sale_date: '2026-08-18', store_name: STORE,
    employee_id: EMPLOYEE_ID, employee_name: NAME, commission_rate: RATE,
    disputed_share: LOST_DISPUTE, commission_at_risk: round2(LOST_DISPUTE * RATE / 100),
  },
  {
    chargeback_id: -3, status: 'won', amount: 500, card_last4: '',
    note: 'Example: the shop won, so the money held back is paid out again.',
    opened_at: '2026-08-02', closed_at: '2026-08-29',
    withheld_payday: '2026-09-01', withheld_by: 'demo', released_payday: '2026-09-15',
    transaction_id: -203, receipt_number: 'DEMO-0975', sale_total: 500,
    customer_name: 'Older Example', sale_date: '2026-07-30', store_name: STORE,
    employee_id: EMPLOYEE_ID, employee_name: NAME, commission_rate: RATE,
    disputed_share: 500, commission_at_risk: round2(500 * RATE / 100),
  },
]);

// The paycheck: what was earned, what is being held, what is left.
const paycheckRow = () => ({
  employee_id: EMPLOYEE_ID, employee_name: NAME, commission_rate: RATE,
  company_id: null, store_name: STORE,
  sales_total: NET, sale_count: 6, returns_netted: RETURNED,
  commission_earned: EARNED,
  adjustments: [{
    kind: 'withheld', chargeback_id: -1, employee_id: EMPLOYEE_ID, pinned: false,
    receipt: 'DEMO-1002', amount: -HELD,
    note: 'dispute opened on the 2026-09-03 sale',
  }],
  adjustment_total: -HELD,
  commission_balance: EARNED,
  total: TAKE_HOME,
  paid: false, paid_at: null, paid_by: '', paid_individually: false,
});

module.exports = {
  NAME, PIN, STORE, isDemo, employee,
  // Same shapes the real routes return, so the page cannot tell the difference.
  personal: () => ({
    employee, role: 'sales', report: [reportRow()], returns: returns(),
    companies_included: [STORE], companies_rejected: [],
  }),
  paycheck: (payday) => ({
    payday: payday || null,
    period: { start: '2026-09-01', end: '2026-09-15' },
    paid: false, rows: [paycheckRow()], role: 'sales',
  }),
  chargebacks: () => ({ chargebacks: chargebacks(), role: 'sales' }),
  detail: () => ({
    employee: NAME, store: STORE, role: 'sales',
    sales: sales(), returns: returns(),
    chargebacks: chargebacks().filter(c => c.status !== 'won'),
    held_elsewhere: [],
  }),
  adjustments: () => ({ adjustments: [], payday: null, role: 'sales' }),
  // For the note on screen, so the numbers can be checked by hand.
  figures: { GROSS, RETURNED, NET, LOST_DISPUTE, COUNTS_AS, RATE, EARNED, OPEN_DISPUTE, HELD, TAKE_HOME },
};
