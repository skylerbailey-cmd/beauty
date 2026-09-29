'use strict';
// Bringing a client list over from the till the shop used before.
//
// The real file has 731 people in it and writes the word "none" into every
// empty email, phone and note, and "0000-00-00" into every empty birthday.
// Taken literally that is not 731 customers with odd data — it is ONE
// customer: a person is recognised by their email address, so the second
// "none" imported looks like the first one coming back, and every row after
// that overwrites the same record. The list has to arrive as people, not as
// the previous system's punctuation.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = () => Promise.reject(new Error('offline'));
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

// The old list's own header, and rows copied from it unchanged.
const HEADER = ['Name', 'Email', 'Phone', 'Phone2', 'Address', 'State', 'City', 'Zip', 'Birth Day', 'Notes'];
const ROWS = [
  ['om  chauham', 'none', '6468248969', 'none', '', '', '', '', '0000-00-00', 'none'],
  ['sandra  young', 'none', 'none', 'none', '', '', '', '', '0000-00-00', 'none'],
  ['a  a', 'none', '1234', 'none', '', '', '', '', '0000-00-00', 'none'],
  ['susan  ortega', 'susanortega59@gmail.com', '6202020155', 'none', '', '', '', '', '0000-00-00', 'none'],
  ['shoshana  kalfon', 'silkac9b@hotmail.com', '5149616672', 'none', '', '', '', '', '0000-00-00', '120 syringy'],
];

// `importState` and the field lists are script-scoped, not on the window, so
// everything goes through eval inside the page.
const load = (header, rows) => w.eval(`(() => {
  const header = ${JSON.stringify(header)}, rows = ${JSON.stringify(rows)};
  importState = { kind: 'customers', header, rows,
    map: autoMapColumns(header, IMPORT_CUSTOMER_FIELDS),
    dayFirst: false, dayCertain: true, delimiter: ',', fileName: 'customers.csv' };
  return importState;
})()`);
const build = () => w.eval('buildImportCustomerRows(null).rows');

setTimeout(() => {
  console.log('\n── The old list\'s columns are recognised ──');
  const st = load(HEADER, ROWS);
  const col = (k) => HEADER[st.map[k]];
  check('Name is the name', col('name') === 'Name', col('name'));
  check('Email is the email', col('email') === 'Email', col('email'));
  check('Phone is the phone', col('phone') === 'Phone', col('phone'));
  check('Phone2 is the second phone, not the first', col('phone2') === 'Phone2', col('phone2'));
  check('"Birth Day" is read as the birthday', col('birthday') === 'Birth Day', col('birthday'));
  check('City is found', col('city') === 'City', col('city'));
  check('State is found', col('state') === 'State', col('state'));
  check('Zip is found', col('zip') === 'Postcode' || col('zip') === 'Zip', col('zip'));
  check('Notes are found', col('notes') === 'Notes', col('notes'));
  check('nothing was guessed as the registered date', st.map.registered === undefined,
    String(st.map.registered));

  console.log('\n── "none" is not an email address ──');
  const built = build();
  check('all five people came through', built.length === 5, `${built.length} rows`);
  check('nobody has "none" as an email', built.every((r) => r.email !== 'none'),
    JSON.stringify(built.map((r) => r.email)));
  check('nobody has "none" as a phone', built.every((r) => r.phone !== 'none'),
    JSON.stringify(built.map((r) => r.phone)));
  check('nobody has "none" in their notes', built.every((r) => !/none/.test(r.notes)),
    JSON.stringify(built.map((r) => r.notes)));
  check('the two real email addresses survived',
    built.filter((r) => r.email).length === 2, JSON.stringify(built.map((r) => r.email)));
  check('everyone who can be matched is matched on something real',
    built.filter((r) => r.contactable).every((r) => r.email || r.phone.replace(/\D/g, '').length >= 10));

  console.log('\n── A phone nobody can dial is not a contact detail ──');
  const shorty = built.find((r) => r.name.toLowerCase().startsWith('a '));
  check('a four-digit number is kept as typed', shorty.phone === '1234', shorty.phone);
  check('but does not count as contactable', shorty.contactable === false);
  const noPhone = built.find((r) => r.name === 'Sandra Young');
  check('someone with nothing at all is flagged', noPhone && noPhone.contactable === false);
  check('and still imports with their name', noPhone && noPhone.name === 'Sandra Young', noPhone && noPhone.name);

  console.log('\n── "0000-00-00" is not a birthday ──');
  check('no birthdays were invented', built.every((r) => r.birthday === ''),
    JSON.stringify(built.map((r) => r.birthday)));

  console.log('\n── Names arrive readable ──');
  check('double spaces are closed up', built[0].name === 'Om Chauham', JSON.stringify(built[0].name));
  check('a lowercase file gets capitals', built[3].name === 'Susan Ortega', built[3].name);
  const cased = load(['Name', 'Phone'], [['McDonald de Luca', '5551234567']]);
  check("a file with its own capitals keeps them",
    build()[0].name === 'McDonald de Luca',
    build()[0].name);
  void cased;

  console.log('\n── The registered date ──');
  load(['Name', 'Email', 'Customer Since', 'Date of Birth'],
    [['Ada Lovelace', 'ada@example.com', '2019-03-04', '1815-12-10']]);
  let r = build()[0];
  check('a "Customer Since" column is found', r.registered === '2019-03-04', r.registered);
  check('and is not confused with the birthday', r.birthday === '1815-12-10', r.birthday);
  load(['Name', 'Created At'], [['Grace Hopper', '12/09/1906']]);
  r = build()[0];
  check('"Created At" counts too', r.registered === '1906-12-09', r.registered);
  load(['Name', 'Email'], [['Nobody Dated', 'n@example.com']]);
  check('a file without one leaves it empty',
    build()[0].registered === '');

  console.log('\n── Four address columns, one address line ──');
  load(['Name', 'Address', 'City', 'State', 'Zip'],
    [['Split Address', '400 Pine St', 'San Francisco', 'CA', '94104']]);
  check('they are joined the way an envelope is written',
    build()[0].address === '400 Pine St, San Francisco, CA 94104',
    build()[0].address);
  load(['Name', 'City', 'State'], [['Partial', 'Denver', 'CO']]);
  check('missing pieces leave no stray commas',
    build()[0].address === 'Denver, CO',
    build()[0].address);

  console.log('\n── A second phone is not thrown away ──');
  load(['Name', 'Phone', 'Phone2'], [['Two Numbers', '3035551212', '7205559999']]);
  r = build()[0];
  check('the first number stays the phone', r.phone === '3035551212', r.phone);
  check('the second is kept with their notes', /Second phone: 7205559999/.test(r.notes), r.notes);
  load(['Name', 'Phone', 'Phone2'], [['One Number', 'none', '7205559999']]);
  r = build()[0];
  check('with no first number, the second becomes the phone', r.phone === '7205559999', r.phone);
  check('and is not also written into the notes', r.notes === '', JSON.stringify(r.notes));

  console.log('\n── What the shop is told before importing ──');
  load(HEADER, ROWS);
  w.eval('renderCustomerImportNotes()');
  const notes = id('importMapNotes').textContent.replace(/\s+/g, ' ');
  check('it says "none" means nothing', /none/.test(notes) && /nothing here/.test(notes), notes);
  check('it names the birthday filler too', /0000-00-00/.test(notes), notes);
  check('it counts who cannot be matched', /neither an email nor a phone/.test(notes), notes);
  check('and the import is allowed to go ahead', id('importMapGo').disabled === false);

  console.log('\n── A file with no name column cannot import ──');
  load(['Email', 'Phone'], [['a@b.com', '3035551212']]);
  w.eval('renderCustomerImportNotes()');
  check('it says so', /Pick a column for the/.test(id('importMapNotes').textContent));
  check('and the button is off', id('importMapGo').disabled === true);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}, 700);
