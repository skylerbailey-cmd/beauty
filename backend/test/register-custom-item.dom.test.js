'use strict';
// The whole page, loaded and scripted: click the tile, fill the modal, and
// read the cart and the totals back out of the DOM. Catches the class of bug
// where the code is right but the dialog never shows.
const fs = require('fs');
const path = require('path');

// jsdom is deliberately not a declared dependency — it is a test convenience,
// not something the server should carry into a deploy. If it isn't here, say
// so and pass; test:register covers the logic without it.
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
let pass = 0, fail = 0;
const check = (l, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}`);
  if (!ok) console.log(`        expected ${JSON.stringify(e)}\n        actual   ${JSON.stringify(a)}`);
  ok ? pass++ : fail++;
};
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('offline'));
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = (m) => { w.__alert = m; };
    Object.defineProperty(w, 'localStorage', { value: { store: {}, getItem(k){return this.store[k]??null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} } });
  } });
const w = dom.window;
const $ = (s) => w.document.querySelector(s);
const txt = (s) => ($(s) ? $(s).textContent.trim() : null);

setTimeout(() => {
  console.log('\n── The tile is on the register ──');
  w.eval(`
    selectedBrands = ['hydrasphere'];
    products = [{ id:'hs-1', name:'Hydra Serum', brand:'HydraSphere', visible:true, price:180, retailPrice:180, minPrice:0 }];
    storeSettings = { tax_rate: 0.0875 };
    renderProducts();
  `);
  const tiles = [...w.document.querySelectorAll('#productGrid .product-tile')];
  check('one-off tile leads the grid', tiles[0] && tiles[0].classList.contains('one-off'), true);
  check('the catalogue product is still there', tiles.length, 2);

  console.log('\n── Clicking it actually opens the dialog ──');
  tiles[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const modal = $('#customItemModal');
  check('the dialog is displayed', w.getComputedStyle(modal).display !== 'none', true);

  console.log('\n── Filling it in rings the line up ──');
  $('#ciName').value = 'Bridal package';
  $('#ciBrand').value = 'Packages';
  $('#ciPrice').value = '500';
  $('#ciDiscPrice').value = '425';
  $('#ciQty').value = '2';
  w.eval('updateCustomItemPreview()');
  check('the preview says what it charges', /850\.00/.test(txt('#ciPreview')) && /150\.00/.test(txt('#ciPreview')), true);

  // Press the button the till actually presses.
  [...w.document.querySelectorAll('#customItemModal .btn-confirm')][0]
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  check('the dialog closed', w.getComputedStyle(modal).display === 'none', true);
  check('the cart has one line', w.eval('cart.length'), 1);
  check('the line name is on screen', txt('#cartItems .ci-name'), 'Bridal package');
  check('the brand is on screen', txt('#cartItems .ci-brand'), 'Packages');
  check('the old price is struck through', !!$('#cartItems .ci-price span[style*="line-through"]'), true);
  check('subtotal is the discounted price', txt('#cartSubtotal'), '$850.00');
  check('tax is on the discounted figure', txt('#cartTax'), '$74.38');
  check('total', txt('#cartTotal'), '$924.38');
  check('the phone bar counts it', txt('#cartJumpCount'), '2');

  console.log('\n── A typed name cannot inject markup ──');
  w.eval('cart = []; renderCart();');
  w.eval("openCustomItem()");
  $('#ciName').value = '<img src=x onerror="window.__pwned=1">';
  $('#ciPrice').value = '10';
  $('#ciDiscPrice').value = '';
  $('#ciQty').value = '1';
  w.eval('confirmCustomItem()');
  check('no image element was created', !$('#cartItems img'), true);
  check('nothing ran', w.__pwned === undefined, true);
  check('the name is shown as text', txt('#cartItems .ci-name'), '<img src=x onerror="window.__pwned=1">');

  console.log('\n── It refuses what it should ──');
  w.eval('cart = []; renderCart();');
  w.eval("openCustomItem()");
  $('#ciName').value = 'Thing'; $('#ciPrice').value = '50'; $('#ciDiscPrice').value = '80';
  w.eval('confirmCustomItem()');
  check('a discount above the price is refused', w.eval('cart.length'), 0);
  check('and says why', /lower than the regular price/.test(w.__alert || ''), true);
  check('the dialog stays open to fix it', w.getComputedStyle($('#customItemModal')).display !== 'none', true);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 600);
