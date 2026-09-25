'use strict';
// Serves the real POS against the test database with a session already in
// place, so it can be looked at on a phone-sized screen.
process.env.DATABASE_URL = 'postgres://skysale@127.0.0.1:55433/skysale_test';
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'harness';

const express = require('express');
const path = require('path');
const P = '/Users/skyler/repos/beauty/backend/';
const pgDb = require(P + 'src/db/postgres.js');
const USER = 'harness-shop';

// The SQLite user row the auth check looks for.
const { saveUser } = require(P + 'src/db/index.js');
saveUser({ id: USER, email: 'mara@northgate.example', access_token: null, refresh_token: null, push_token: null, gmail_history_id: null });

const app = express();
app.use(express.json());
app.use((req, _r, next) => { req.session = { userId: USER, save: (cb) => cb && cb() }; next(); });
// pos.html with a measuring script bolted on, so overflow can be read out of
// the DOM by a headless browser that cannot otherwise run our JS for us.
app.get('/diag.html', (req, res) => {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(P, 'web/pos.html'), 'utf8');
  html = html.replace('</body>', `<div id="__diag" style="position:fixed;inset:0 0 auto 0;z-index:99999;background:#fff;color:#000;font:11px/1.35 monospace;padding:6px;white-space:pre-wrap;word-break:break-all;max-height:100vh;overflow:auto">measuring…</div>
<script>
setTimeout(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    if (!el.offsetParent && el.tagName !== 'BODY') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const overRight = Math.round(r.right - vw);
    const tooWide = Math.round(el.scrollWidth - el.clientWidth);
    if (overRight > 2 || tooWide > 2) {
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: (el.className && el.className.toString().slice(0, 44)) || '',
        right: Math.round(r.right), w: Math.round(r.width),
        overRight, tooWide,
      });
    }
  });
  out.sort((a, b) => b.overRight - a.overRight);
  document.getElementById('__diag').textContent =
    'VW=' + vw + ' BODY=' + document.body.scrollWidth + ' ||| ' +
    JSON.stringify(out.slice(0, 22));
}, 3500);
</script></body>`);
  res.set('Content-Type', 'text/html').send(html);
});

// Headless Chrome will not open a window narrower than 500px, so it renders a
// 500px page and crops the picture — which looks exactly like broken layout.
// An iframe gets a viewport of whatever width it is given, so this is a real
// 390px phone rather than a cropped desktop.
app.get('/phone.html', (req, res) => {
  const w = Number(req.query.w) || 390;
  const h = Number(req.query.h) || 844;
  const src = req.query.src || '/pos.html';
  res.set('Content-Type', 'text/html').send(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#888}
     iframe{width:${w}px;height:${h}px;border:0;display:block;background:#fff}</style>
     <iframe src="${src}"></iframe>`);
});

app.use(express.static(path.join(P, 'web'), { index: false }));
app.use('/api/pos', require(P + 'src/routes/pos.js'));
app.use('/auth', require(P + 'src/routes/auth.js'));
app.use('/api/emails', require(P + 'src/routes/emails.js'));
app.use('/api/welcome', require(P + 'src/routes/welcome.js').router);

(async () => {
  await pgDb.initSchema();
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  await pgDb.deleteCompany(USER).catch(() => {});
  for (const row of (await db.query("SELECT user_id FROM pos_settings WHERE slug='northgate'")).rows) {
    await pgDb.deleteCompany(row.user_id).catch(() => {});
  }
  await db.query(`INSERT INTO pos_settings (user_id, store_name, slug, tax_rate, timezone, brands)
                  VALUES ($1,'Northgate Aesthetics','northgate',0.0875,'America/Denver','[]')
                  ON CONFLICT (user_id) DO UPDATE SET store_name='Northgate Aesthetics'`, [USER]);
  await db.query(`INSERT INTO pos_employees (user_id, name, pin, role) VALUES ($1,'Mara','1471','admin')`, [USER]);
  await db.query(`INSERT INTO pos_employees (user_id, name, pin, role) VALUES ($1,'Sam','2222','sales')`, [USER]);

  const PRODUCTS = [
    ['Eneo Totalé', 11950], ['Eneo Totalé Blu', 11950], ['Noni Pore Purifying Toner', 250],
    ['Eye Rescue Phyto-Serum', 600], ['Noni Polishing Peel', 300], ['Wrinkle Reversal Solution', 1300],
    ['Noni Night Repair Cream', 350], ['Dark Circle Eye Perfecting Cream', 600],
    ['Advanced Night Repair', 325], ['Bio Milk Cleanser', 349], ['Vitamin C Serum', 800],
    ['SPF 50 Shield Cream', 849],
  ];
  for (const [name, price] of PRODUCTS) {
    await db.query(`INSERT INTO pos_custom_products (user_id, name, brand, price) VALUES ($1,$2,'Northgate Labs',$3)`, [USER, name, price]);
  }
  for (let i = 1; i <= 14; i++) {
    const tx = (await db.query(`INSERT INTO pos_transactions
                                  (user_id, receipt_number, total, subtotal, tax_amount, payment_method, customer_name, customer_email)
                                VALUES ($1,$2,$3,$4,$5,'card',$6,$7) RETURNING id`,
      [USER, 'R-' + (1000 + i), 250 * i, 230 * i, 20 * i, 'Customer ' + i, `c${i}@example.com`])).rows[0].id;
    await db.query(`INSERT INTO pos_transaction_items (transaction_id, product_id, product_name, brand, quantity, unit_price, line_total)
                    VALUES ($1,'p1',$2,'Northgate Labs',1,$3,$3)`, [tx, PRODUCTS[i % PRODUCTS.length][0], 250 * i]);
    await db.query(`INSERT INTO pos_transaction_payments (transaction_id, method, amount) VALUES ($1,'card',$2)`, [tx, 250 * i]);
  }
  await db.end();

  app.listen(3998, () => console.log('harness on http://localhost:3998/pos.html'));
})().catch((e) => { console.error(e); process.exit(1); });
