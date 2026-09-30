'use strict';
// Two things that had grown wrong quietly.
//
// THE BRAND LIST was two lists. A shop's own imported ranges sat above the
// ranges SkySale carries, and the ones above had disabled checkboxes — always
// ticked, impossible to turn off. Worse, the register agreed: the product
// filter read `!p.isCustom && ...`, so a shop's own products skipped the
// brand check entirely. The ticks above the line were decoration.
//
// They also had no value attribute, so every save collected them as the
// string "on" and wrote that into the shop's brand list.
//
// SHELL COMPANIES came from getSettings, which INSERTed a row when it found
// none — so merely ASKING about an id brought a company into being, and
// everything asks. A mistyped address, a wrong id typed by hand, a background
// job: each left a nameless company behind.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const saved = [];
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      if (opts.body && /brands/.test(String(opts.body))) saved.push(JSON.parse(opts.body));
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

// A shop with its own imported range AND one of ours switched on.
const PRODUCTS = [
  { name: 'Own A', brand: 'BeneLift', isCustom: true },
  { name: 'Own B', brand: 'BeneLift', isCustom: true },
  { name: 'Own C', brand: 'Zenith Labs', isCustom: true },
  { name: 'Ours', brand: 'Avologi', isCustom: false },
  { name: 'Ours 2', brand: 'HydraSphere Plus', isCustom: false },
];
const setup = (brands) => w.eval(
  `products = ${JSON.stringify(PRODUCTS)}; selectedBrands = ${JSON.stringify(brands)}; renderBrandCheckboxes();`);
const rows = () => [...id('brandCheckboxes').querySelectorAll('.brand-config-row')];
const boxes = () => [...id('brandCheckboxes').querySelectorAll('input[type=checkbox]')];

setTimeout(() => {
  console.log('\n── One list ──');
  setup(['avologi']);
  check('every range is in it', rows().length === 7,
    `${rows().length} rows — 2 of theirs, 5 of ours`);
  const text = id('brandCheckboxes').textContent.replace(/\s+/g, ' ');
  check('theirs are there', /BeneLift/.test(text) && /Zenith Labs/.test(text), text.slice(0, 200));
  check('and ours', /Avologi/.test(text) && /Lumières/.test(text));
  check('with no section headings dividing them',
    !/YOUR PRODUCTS|ALSO AVAILABLE/i.test(text), text.slice(0, 200));
  check('sorted as one list, not theirs-then-ours',
    rows()[0].dataset.brandKey === 'avinichi',
    rows().map((r) => r.dataset.brandKey).join(', '));
  check('each still says where it came from',
    (text.match(/yours/g) || []).length === 2 && (text.match(/SkySale/g) || []).length === 5,
    text.slice(0, 260));

  console.log('\n── Everything can be switched off ──');
  check('no checkbox is disabled', boxes().every((b) => !b.disabled),
    `${boxes().filter((b) => b.disabled).length} disabled`);
  check('and every one carries its key', boxes().every((b) => b.value && b.value !== 'on'),
    boxes().map((b) => b.value).join(', '));
  const mine = rows().find((r) => r.dataset.brandKey === 'own:benelift');
  check('their own range has a real key', !!mine,
    rows().map((r) => r.dataset.brandKey).join(', '));

  console.log('\n── A shop that has never touched this keeps everything ──');
  setup(['avologi']);
  check('their own ranges are ticked', rows()
    .filter((r) => r.dataset.brandKey.startsWith('own:'))
    .every((r) => r.querySelector('input').checked));
  check('and their products show on the register',
    w.eval("brandIsOn({ isCustom: true, brand: 'BeneLift' })") === true);
  check('while a range of ours that is off does not',
    w.eval("brandIsOn({ isCustom: false, brand: 'Avinichi' })") === false);

  console.log('\n── Once they choose, the choice is honoured ──');
  setup(['own', 'own:benelift', 'avologi']);
  check('the one they kept shows',
    w.eval("brandIsOn({ isCustom: true, brand: 'BeneLift' })") === true);
  check('the one they turned off does not',
    w.eval("brandIsOn({ isCustom: true, brand: 'Zenith Labs' })") === false,
    'their own range could never be switched off before');
  check('and the list reflects it',
    rows().find((r) => r.dataset.brandKey === 'own:zenith labs').querySelector('input').checked === false);

  console.log('\n── Turning every one of their own off is not "never chosen" ──');
  // The distinction that needs a marker: without it, switching all of your
  // own ranges off would read as a shop that had never opened the screen,
  // and the whole range would come straight back.
  setup(['own', 'avologi']);
  check('all of their own stay off',
    w.eval("brandIsOn({ isCustom: true, brand: 'BeneLift' })") === false
    && w.eval("brandIsOn({ isCustom: true, brand: 'Zenith Labs' })") === false);
  check('and ours is unaffected',
    w.eval("brandIsOn({ isCustom: false, brand: 'Avologi' })") === true);

  console.log('\n── Saving ──');
  setup(['own', 'own:benelift', 'avologi']);
  saved.length = 0;
  w.eval('saveBrands()');
  const body = saved.find((b) => Array.isArray(b.brands));
  check('it saves the keys that are ticked', !!body, JSON.stringify(saved[0]));
  check('including their own range', body.brands.includes('own:benelift'), body.brands.join(', '));
  check('and the marker that says these were chosen',
    body.brands.includes('own'), body.brands.join(', '));
  check('and never the string "on"', !body.brands.includes('on'),
    'the disabled checkboxes used to have no value, so every save wrote "on"');

  console.log('\n── Reading a shop that does not exist does not create one ──');
  const pgSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'postgres.js'), 'utf8');
  const getSettings = pgSrc.slice(pgSrc.indexOf('async function getSettings(userId) {'),
    pgSrc.indexOf('async function updateSettings'));
  check('getSettings never inserts', !/INSERT INTO pos_settings/.test(getSettings), getSettings);
  check('it answers with the schema\'s own defaults', /defaultSettingsRow\(\)/.test(getSettings));
  check('and still answers with an object, so no caller has to change',
    /return \{ \.\.\.\(await defaultSettingsRow\(\)\), user_id: userId \}/.test(getSettings));
  // Writing is what brings a shop into being, and it already did its own insert.
  const update = pgSrc.slice(pgSrc.indexOf('async function updateSettings'));
  check('writing still creates the row it needs',
    /INSERT INTO pos_settings \(user_id\) VALUES \(\$1\) ON CONFLICT DO NOTHING/
      .test(update.slice(0, 2000)));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
