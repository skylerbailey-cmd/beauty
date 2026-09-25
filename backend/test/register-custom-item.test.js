// Exercises the build-your-own code as it actually sits in pos.html: the
// functions are pulled out of the file by name and run against a fake DOM, so
// a change to the page that breaks them fails here.
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

// ── pull the source of the pieces under test ────────────────────────────────
function grab(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('not found in pos.html: ' + startMarker);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error('end not found after ' + startMarker);
  return html.slice(a, b);
}

const oneOffSrc = grab("const ONE_OFF_PREFIX = 'one-off:';", '// Enter confirms');
const helpers = [
  'const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;',
  "function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }",
  grab('function escapeHtml(str) {', '\n}\n') + '\n}',
].join('\n');

// The cart renderer and the checkout payload mapping, so a one-off line is
// followed all the way to what the server would receive.
const cartLineHtml = (item) => {
  const lineCharged = (i) => (i.unit_price - (i.discount_per_unit || 0)) * i.quantity;
  return `<div class="ci-name">${ctx.escapeHtml(item.product_name)}</div><div class="ci-brand">${ctx.escapeHtml(item.brand)}</div><span>${ctx.money(lineCharged(item))}</span>`;
};

// ── fake DOM: just the fields the modal touches ─────────────────────────────
const fields = {};
const fake = (id) => (fields[id] = { value: '', style: {}, textContent: '', focus() {}, select() {} });
['ciName', 'ciBrand', 'ciPrice', 'ciDiscPrice', 'ciQty', 'ciPreview', 'searchInput'].forEach(fake);
const modalClasses = new Set();

let lastAlert = null;
const ctx = {
  cart: [],
  renderCart() {},
  setTimeout(fn) { fn(); },
  alert(msg) { lastAlert = msg; },
  document: {
    getElementById: (id) => {
      if (id === 'customItemModal') {
        return { classList: { add: (c) => modalClasses.add(c), remove: (c) => modalClasses.delete(c), contains: (c) => modalClasses.has(c) } };
      }
      return fields[id] || fake(id);
    },
    querySelector: () => (ctx.__gridHasProducts ? {} : null),
    addEventListener() {},
  },
  __gridHasProducts: false,
};
vm.createContext(ctx);
// `const` declarations don't land on the context's global object, so hand
// the few the test needs back out explicitly.
vm.runInContext(helpers + '\n' + oneOffSrc + '\nthis.round2 = round2;', ctx);

// ── assertions ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
};
const fill = (name, price, disc, qty, brand) => {
  fields.ciName.value = name;
  fields.ciPrice.value = price;
  fields.ciDiscPrice.value = disc;
  fields.ciQty.value = qty === undefined ? '1' : String(qty);
  fields.ciBrand.value = brand || '';
  lastAlert = null;
};

console.log('\nBuild your own — one-off register line\n');

// 1. a plain one-off
ctx.cart.length = 0;
fill('Gift basket', '120', '', 1);
ctx.confirmCustomItem();
check('rings up at the price given', ctx.cart.length === 1 && ctx.cart[0].unit_price === 120 && ctx.cart[0].discount_per_unit === 0, JSON.stringify(ctx.cart[0]));
check('defaults the brand to Custom', ctx.cart[0] && ctx.cart[0].brand === 'Custom');
check('closes the modal on success', !modalClasses.has('show'));

// 2. with a discount price
ctx.cart.length = 0;
fill('Bridal package', '500', '425', 1, 'Packages');
ctx.confirmCustomItem();
const line = ctx.cart[0];
check('keeps the regular price as the line price', line.unit_price === 500);
check('carries the markdown as a discount', line.discount_per_unit === 75, String(line.discount_per_unit));
check('keeps the brand typed in', line.brand === 'Packages');

// what the checkout payload would send for that line
const payload = {
  product_id: line.product_id,
  product_name: line.product_name,
  quantity: line.quantity,
  unit_price: line.unit_price,
  discount: ctx.round2((line.discount_per_unit || 0) * line.quantity),
};
const serverSubtotal = payload.unit_price * payload.quantity - payload.discount;
check('the server would charge the discounted price', serverSubtotal === 425, String(serverSubtotal));

// 3. quantity
ctx.cart.length = 0;
fill('Touch-up', '60', '45', 3);
ctx.confirmCustomItem();
check('takes a quantity', ctx.cart[0].quantity === 3);
check('discount is per unit, not per line', ctx.cart[0].discount_per_unit === 15);
const q3 = ctx.round2((ctx.cart[0].discount_per_unit) * ctx.cart[0].quantity);
check('three at $45 charge $135', ctx.cart[0].unit_price * 3 - q3 === 135, String(ctx.cart[0].unit_price * 3 - q3));

// 4. adding the same thing twice merges
fill('Touch-up', '60', '45', 2);
ctx.confirmCustomItem();
check('the same one-off merges into one line', ctx.cart.length === 1 && ctx.cart[0].quantity === 5, JSON.stringify(ctx.cart));

// 4b. ...but a different price does not
fill('Touch-up', '60', '50', 1);
ctx.confirmCustomItem();
check('a different price makes its own line', ctx.cart.length === 2, JSON.stringify(ctx.cart.map(c => c.discount_per_unit)));

// 5. refusals
ctx.cart.length = 0;
fill('', '50', '', 1);
ctx.confirmCustomItem();
check('refuses a nameless item', ctx.cart.length === 0 && /name/i.test(lastAlert || ''), String(lastAlert));

fill('Thing', '', '', 1);
ctx.confirmCustomItem();
check('refuses a priceless item', ctx.cart.length === 0 && /price/i.test(lastAlert || ''), String(lastAlert));

fill('Thing', '50', '80', 1);
ctx.confirmCustomItem();
check('refuses a discount above the regular price', ctx.cart.length === 0 && /lower/i.test(lastAlert || ''), String(lastAlert));

fill('Thing', '-5', '', 1);
ctx.confirmCustomItem();
check('refuses a negative price', ctx.cart.length === 0, JSON.stringify(ctx.cart));

fill('Thing', '50', 'abc', 1);
ctx.confirmCustomItem();
check('refuses a nonsense discount', ctx.cart.length === 0, JSON.stringify(ctx.cart));

// free is allowed — the price modal has a Free button, so a $0 one-off is too
fill('Sample', '0', '', 1);
ctx.confirmCustomItem();
check('allows a $0 item', ctx.cart.length === 1 && ctx.cart[0].unit_price === 0);

// 6. the id groups by name so the product report doesn't fragment
check('same name, same id', ctx.oneOffId('Gift Basket') === ctx.oneOffId('gift   basket'), ctx.oneOffId('Gift Basket') + ' vs ' + ctx.oneOffId('gift   basket'));
check('different names, different ids', ctx.oneOffId('Gift basket') !== ctx.oneOffId('Bridal package'));
check('ids are prefixed', ctx.oneOffId('Gift basket') === 'one-off:gift-basket', ctx.oneOffId('Gift basket'));
check('a name of only punctuation still gets an id', ctx.oneOffId('!!!') === 'one-off:item', ctx.oneOffId('!!!'));

// 7. a typed name cannot inject markup into the cart
ctx.cart.length = 0;
fill('<img src=x onerror=alert(1)>', '10', '', 1);
ctx.confirmCustomItem();
const rendered = cartLineHtml(ctx.cart[0]);
check('a typed name is escaped in the cart', !rendered.includes('<img') && rendered.includes('&lt;img'), rendered.slice(0, 80));

// 8. the preview reads back what will be charged
fill('Package', '500', '425', 2);
ctx.updateCustomItemPreview();
check('preview names the charge and the discount', /850\.00/.test(fields.ciPreview.textContent) && /150\.00/.test(fields.ciPreview.textContent), fields.ciPreview.textContent);
fill('Package', '500', '', 1);
ctx.updateCustomItemPreview();
check('preview with no discount just states the charge', /500\.00/.test(fields.ciPreview.textContent) && !/discount/.test(fields.ciPreview.textContent), fields.ciPreview.textContent);
fill('Package', '500', '900', 1);
ctx.updateCustomItemPreview();
check('preview warns when the discount is too high', /higher/.test(fields.ciPreview.textContent), fields.ciPreview.textContent);

// 9. opening it after a fruitless search offers what they searched for
fields.searchInput.value = 'lash lift';
ctx.__gridHasProducts = false;
ctx.openCustomItem();
check('prefills the name from a search that found nothing', fields.ciName.value === 'lash lift', fields.ciName.value);
check('opens the modal', modalClasses.has('show'));
fields.searchInput.value = 'hydra';
ctx.__gridHasProducts = true;
ctx.openCustomItem();
check('leaves the name blank when the search did find products', fields.ciName.value === '', fields.ciName.value);
check('clears the previous price', fields.ciPrice.value === '' && fields.ciDiscPrice.value === '' && fields.ciQty.value === '1');

// 10. the tile is in the grid, ahead of the products, and ignores the filters
const gridSrc = grab('const oneOff = `', 'grid.innerHTML = oneOff');
check('the tile calls openCustomItem', /onclick="openCustomItem\(\)"/.test(gridSrc));
check('the tile leads the grid', /grid\.innerHTML = oneOff \+ filtered\.map/.test(html));

// 11. the cart itself escapes what was typed (the check above proves the
// helper works; this proves the renderer uses it)
check('renderCart escapes the line name', html.includes('<div class="ci-name">${escapeHtml(item.product_name)}</div>'));
check('renderCart escapes the line brand', html.includes('<div class="ci-brand">${escapeHtml(item.brand)}</div>'));

// 12. the whole page still parses
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check('pos.html has a main script block', scripts.length > 0);
let syntaxOk = true, syntaxErr = '';
for (const src of scripts) {
  try { new vm.Script(src); } catch (e) { syntaxOk = false; syntaxErr = e.message; }
}
check('every script block in pos.html parses', syntaxOk, syntaxErr);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
