'use strict';
// The Subscription panel in Settings → Account.
//
// Four states that look alike and mean very different things: on trial,
// paying, cancelled but still running to the end of a month already paid for,
// and stopped. Getting the wording wrong here means somebody either cancels
// thinking they can undo it, or believes they have cancelled when they have
// not and is charged again.
//
// It sits ABOVE "Close this account" on purpose. Cancelling is what most
// people actually want, and burying it under a delete button is how somebody
// ends up deleting their books to stop a charge.
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  console.log('\n  skipped: jsdom is not installed (npm i -D jsdom to run this one)\n');
  process.exit(0);
}
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'pos.html'), 'utf8');

const calls = [];
let confirmText = null;
const dom = new JSDOM(html, { url: 'https://glowsf.sky-sale.com/pos.html', runScripts: 'dangerously',
  beforeParse(w) {
    w.fetch = (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET' });
      return Promise.resolve({ ok: true, json: async () => ({ url: 'https://checkout.stripe.test/s/x' }) });
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.scrollTo = () => {}; w.alert = () => {};
    w.confirm = (m) => { confirmText = m; return false; };
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

const show = (state) => {
  w.eval(`subState = ${JSON.stringify(state)}; renderSubscription();`);
  return {
    text: id('subStatus').textContent.replace(/\s+/g, ' ').trim(),
    buttons: [...id('subActions').querySelectorAll('button')].map((b) => b.textContent.trim()),
  };
};
const BASE = { configured: true, monthly_cents: 11500, trial_days: 14 };

// The page shows these on the viewer's own clock, which is right — a shop in
// Denver should read its renewal date in Denver. So the expected string is
// computed the same way rather than written out, or this test passes or fails
// depending on the machine it runs on.
const asShown = (iso) => new Date(Date.parse(iso))
  .toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const TRIAL_END = '2026-10-14T12:00:00Z';
const PERIOD_END = '2026-11-01T12:00:00Z';

setTimeout(() => {
  console.log('\n── Where it sits ──');
  check('the panel is in the Account tab',
    id('subscriptionCard').dataset.sgroup === 'danger', id('subscriptionCard').dataset.sgroup);
  const cards = [...w.document.querySelectorAll('[data-sgroup="danger"]')];
  check('above closing the account',
    cards.indexOf(id('subscriptionCard')) < cards.findIndex((c) => /Close this account/.test(c.textContent)),
    cards.map((c) => c.querySelector('h3')?.textContent).join(' | '));

  console.log('\n── Never signed up ──');
  let v = show({ ...BASE, status: '', may_sell: false });
  check('it says the price', /\$115 a month/.test(v.text), v.text);
  check('and that the first fortnight is free', /14 days free/.test(v.text), v.text);
  check('with one thing to do', v.buttons.join(',') === 'Start the subscription', v.buttons.join(','));

  console.log('\n── On the free trial ──');
  v = show({ ...BASE, status: 'trialing', may_sell: true, trialing: true,
    trial_end: TRIAL_END, current_period_end: TRIAL_END });
  check('it says it is a trial', /Free trial/.test(v.text), v.text);
  check('and when the first charge lands', v.text.includes(asShown(TRIAL_END)), v.text);
  check('and that cancelling first costs nothing', /nothing is charged/.test(v.text));
  check('cancelling is offered', v.buttons.includes('Cancel subscription'), v.buttons.join(','));

  console.log('\n── Paying ──');
  v = show({ ...BASE, status: 'active', may_sell: true, current_period_end: PERIOD_END });
  check('it reads as active', /Active/.test(v.text), v.text);
  check('with the renewal date', v.text.includes(asShown(PERIOD_END)), v.text);
  check('and no talk of a trial', !/trial/i.test(v.text), v.text);

  console.log('\n── Cancelled, still running ──');
  // The state most likely to be misread. They have cancelled AND they can
  // still trade, and both halves have to be said.
  v = show({ ...BASE, status: 'active', may_sell: true, cancel_at_period_end: true,
    current_period_end: PERIOD_END });
  check('it says cancelled', /Cancelled/.test(v.text), v.text);
  check('and that the shop keeps working until the period ends',
    /keeps working until/.test(v.text) && v.text.includes(asShown(PERIOD_END)), v.text);
  check('and what stops then', /stops taking new sales/.test(v.text));
  check('and that the records stay', /stays readable|stays here/.test(v.text), v.text);
  check('undoing it is the main button', v.buttons[0] === 'Keep the subscription', v.buttons.join(','));
  check('and cancelling is not offered twice', !v.buttons.includes('Cancel subscription'));

  console.log('\n── Card failed ──');
  v = show({ ...BASE, status: 'past_due', may_sell: false, has_customer: true });
  check('it says sales are paused', /new sales are paused/.test(v.text), v.text);
  check('and blames the payment, not the shop', /did not go through/.test(v.text), v.text);
  check('their records are still promised', /still here/.test(v.text));
  check('they can fix the card', v.buttons.includes('Update card'), v.buttons.join(','));

  console.log('\n── Lapsed ──');
  v = show({ ...BASE, status: 'canceled', may_sell: false, has_customer: true });
  check('it says it ended', /has ended/.test(v.text), v.text);
  check('and offers to start again', v.buttons.includes('Start it again'), v.buttons.join(','));

  console.log('\n── Billing switched off on this server ──');
  v = show({ configured: false, status: '', may_sell: false });
  check('it says so plainly', /not switched on/.test(v.text), v.text);
  check('and offers no button that cannot work', v.buttons.length === 0, v.buttons.join(','));

  console.log('\n── Cancelling asks first, and says what happens ──');
  show({ ...BASE, status: 'active', may_sell: true, current_period_end: PERIOD_END });
  calls.length = 0;
  w.eval('cancelSubscription()');
  check('it confirms', !!confirmText, String(confirmText));
  check('naming the day it stops', (confirmText || '').includes(asShown(PERIOD_END)), confirmText);
  check('and saying the records stay', /stays here/.test(confirmText || ''), confirmText);
  check('saying no cancels nothing',
    !calls.some((c) => /billing\/cancel/.test(c.url)), calls.map((c) => c.url).join(' | '));

  confirmText = null;
  show({ ...BASE, status: 'trialing', may_sell: true, trialing: true, trial_end: TRIAL_END });
  w.eval('cancelSubscription()');
  check('on a trial it says nothing has been charged',
    /nothing has been charged/.test(confirmText || ''), confirmText);

  console.log('\n── The buttons go to the right place ──');
  calls.length = 0;
  w.eval('startCheckout()');
  setTimeout(() => {
    check('subscribing asks the server for a checkout link',
      calls.some((c) => c.method === 'POST' && /api\/billing\/checkout/.test(c.url)),
      calls.map((c) => c.url).join(' | '));
    calls.length = 0;
    w.eval('openBillingPortal()');
    setTimeout(() => {
      check('updating a card opens the billing portal',
        calls.some((c) => c.method === 'POST' && /api\/billing\/portal/.test(c.url)),
        calls.map((c) => c.url).join(' | '));

      console.log('\n── Opening the tab reads it fresh ──');
      // A trial ending, a card failing and a cancellation from Stripe's own
      // page all happen while nobody is looking at this screen.
      calls.length = 0;
      w.eval("settingsGroup('danger')");
      check('it asks the server each time',
        calls.some((c) => /api\/billing\/status/.test(c.url)),
        calls.map((c) => c.url).join(' | '));

      console.log(`\n${pass} passed, ${fail} failed\n`);
      process.exit(fail ? 1 : 0);
    }, 40);
  }, 40);
}, 700);
