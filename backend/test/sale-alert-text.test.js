'use strict';
// The sale text: who made the sale comes straight after the amount, because a
// carrier's gateway cuts long texts off at the end, and the separators are
// plain ASCII so the carrier doesn't drop to a 70-character encoding.
let pass = 0, fail = 0;
const check = (l, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok && detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
};
const { saleAlertText } = require('../src/routes/pos');
const sale = { type: 'sale', total: 324.56, receipt_number: '1142', customer_name: 'Steven Rousseau',
  employees: [{ employee_name: 'Star' }, { employee_name: 'Roy' }, { employee_name: 'Sagiv' }] };
const t = saleAlertText(sale, 'Glow SF');
check('who made the sale is right after the amount', t.startsWith('Sale $324.56 by Star, Roy, Sagiv'), t);
check('then the store, the customer and the receipt', t === 'Sale $324.56 by Star, Roy, Sagiv - Glow SF - Steven Rousseau - #1142', t);
check('plain ASCII, so the carrier keeps 160 characters', /^[\x20-\x7e]*$/.test(t), t);
check('it fits in one text', t.length <= 120, `${t.length} chars`);
check('the names are within the first 40 characters, wherever a carrier cuts',
  t.indexOf('Sagiv') + 'Sagiv'.length <= 40, t);
const ret = saleAlertText({ type: 'return', total: 50, receipt_number: 'R1016', employees: [{ employee_name: 'maya' }] }, 'Desert Wellness');
check('a refund says who too', ret === 'Refund $50.00 by maya - Desert Wellness - #R1016', ret);
check('the same person twice is named once',
  saleAlertText({ ...sale, employees: [{ employee_name: 'Roy' }, { employee_name: 'Roy ' }] }, 'X').startsWith('Sale $324.56 by Roy - '));
check('nobody on the sale: no "by"', saleAlertText({ ...sale, employees: [] }, 'Glow SF') === 'Sale $324.56 - Glow SF - Steven Rousseau - #1142');
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
