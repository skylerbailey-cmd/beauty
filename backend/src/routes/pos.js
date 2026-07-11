'use strict';

const express = require('express');
const router = express.Router();
const posDb = require('../db/pos');
const { PRODUCTS } = require('./welcome');
const { findOrCreateCustomer, addCustomerProducts, getCustomerByEmail } = require('../db');
const nodemailer = require('nodemailer');

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

router.use(requireAuth);

// ─── Products (with prices) ────────────────────────────────────────────────

router.get('/products', (req, res) => {
  const userId = req.session.userId;
  const prices = posDb.getProductPrices(userId);
  const priceMap = {};
  for (const p of prices) priceMap[p.product_id] = p;

  const allProducts = [];
  for (const [brandKey, products] of Object.entries(PRODUCTS)) {
    for (const prod of products) {
      const priceEntry = priceMap[prod.id];
      allProducts.push({
        id: prod.id,
        name: prod.name,
        brand: prod.brand || brandKey,
        description: prod.description,
        image: prod.image,
        retailPrice: prod.retailPrice || 0,
        price: priceEntry?.price ?? prod.retailPrice ?? 0,
        cost: priceEntry?.cost ?? 0,
      });
    }
  }
  res.json({ products: allProducts });
});

router.post('/products/price', (req, res) => {
  const userId = req.session.userId;
  const { product_id, price, cost } = req.body;
  if (!product_id || price === undefined) {
    return res.status(400).json({ error: 'product_id and price required' });
  }
  posDb.setProductPrice(product_id, parseFloat(price), parseFloat(cost || 0), userId);
  res.json({ ok: true });
});

router.post('/products/prices/bulk', (req, res) => {
  const userId = req.session.userId;
  const { prices } = req.body;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'prices array required' });
  for (const p of prices) {
    posDb.setProductPrice(p.product_id, parseFloat(p.price), parseFloat(p.cost || 0), userId);
  }
  res.json({ ok: true });
});

// ─── Employees ─────────────────────────────────────────────────────────────

router.get('/employees', (req, res) => {
  res.json({ employees: posDb.getEmployees(req.session.userId) });
});

router.post('/employees', (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
  if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  const employee = posDb.createEmployee(name, pin, role, req.session.userId);
  res.json({ employee });
});

router.put('/employees/:id', (req, res) => {
  posDb.updateEmployee(parseInt(req.params.id), req.body);
  res.json({ ok: true });
});

router.post('/employees/verify', (req, res) => {
  const { pin } = req.body;
  const employee = posDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ employee });
});

// ─── Clock In/Out ──────────────────────────────────────────────────────────

router.post('/clock/in', (req, res) => {
  const { employee_id } = req.body;
  const entry = posDb.clockIn(employee_id, req.session.userId);
  res.json({ entry });
});

router.post('/clock/out', (req, res) => {
  const { employee_id } = req.body;
  posDb.clockOut(employee_id);
  res.json({ ok: true });
});

router.get('/clock/status/:employeeId', (req, res) => {
  const entry = posDb.getOpenClockEntry(parseInt(req.params.employeeId));
  res.json({ clocked_in: !!entry, entry });
});

router.get('/clock/entries', (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(Date.now() - 30 * 86400000).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ entries: posDb.getClockEntries(req.session.userId, startDate, endDate) });
});

// ─── Transactions ──────────────────────────────────────────────────────────

router.post('/transactions', (req, res) => {
  const userId = req.session.userId;
  const { type, employee_id, customer_name, customer_email, items, payment_method, notes, tax_rate, discount_amount, original_receipt } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one item required' });
  }

  // If this is a return, look up original transaction
  let original_transaction_id = null;
  if (type === 'return' && original_receipt) {
    const orig = posDb.getTransactionByReceipt(original_receipt, userId);
    if (orig) original_transaction_id = orig.id;
  }

  const rate = tax_rate ?? 0.0875;
  const subtotal = items.reduce((sum, i) => sum + (i.unit_price * (i.quantity || 1) - (i.discount || 0)), 0);
  const disc = parseFloat(discount_amount || 0);
  const taxable = subtotal - disc;
  const tax_amount = Math.round(taxable * rate * 100) / 100;
  const total = Math.round((taxable + tax_amount) * 100) / 100;

  const { id, receipt_number } = posDb.createTransaction({
    type: type || 'sale',
    employee_id,
    customer_name: customer_name || '',
    customer_email: customer_email || '',
    subtotal,
    tax_rate: rate,
    tax_amount,
    discount_amount: disc,
    total,
    payment_method: payment_method || 'card',
    notes: notes || '',
    original_transaction_id,
    user_id: userId,
  });

  const txItems = items.map(i => ({
    product_id: i.product_id,
    product_name: i.product_name,
    brand: i.brand || '',
    quantity: i.quantity || 1,
    unit_price: i.unit_price,
    discount: i.discount || 0,
    line_total: i.unit_price * (i.quantity || 1) - (i.discount || 0),
  }));

  posDb.addTransactionItems(id, txItems);

  // Also record in CRM if customer info provided and it's a sale
  if (type !== 'return' && customer_email) {
    try {
      const customer = findOrCreateCustomer(customer_name, customer_email, userId);
      const productsForCrm = txItems.map(i => ({ id: i.product_id, name: i.product_name }));
      addCustomerProducts(customer.id, productsForCrm);
    } catch (_) { /* non-critical */ }
  }

  const tx = posDb.getTransaction(id);
  res.json({ transaction: tx });
});

router.get('/transactions', (req, res) => {
  const { type, start, end, employee_id, limit } = req.query;
  const opts = {};
  if (type) opts.type = type;
  if (start) opts.startDate = start;
  if (end) opts.endDate = end;
  if (employee_id) opts.employeeId = parseInt(employee_id);
  if (limit) opts.limit = parseInt(limit);
  res.json({ transactions: posDb.getTransactions(req.session.userId, opts) });
});

router.get('/transactions/:id', (req, res) => {
  const tx = posDb.getTransaction(parseInt(req.params.id));
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

router.get('/transactions/receipt/:number', (req, res) => {
  const tx = posDb.getTransactionByReceipt(req.params.number, req.session.userId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

// ─── Email Receipt ─────────────────────────────────────────────────────────

router.post('/transactions/:id/email', async (req, res) => {
  const tx = posDb.getTransaction(parseInt(req.params.id));
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const email = req.body.email || tx.customer_email;
  if (!email) return res.status(400).json({ error: 'Email address required' });

  const { getUser } = require('../db');
  const user = getUser(req.session.userId);
  const companyName = user?.company_name || 'Glow SF';

  const itemRows = tx.items.map(i =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.product_name}</td>` +
    `<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>` +
    `<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${i.unit_price.toFixed(2)}</td>` +
    `<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${i.line_total.toFixed(2)}</td></tr>`
  ).join('');

  const html = `
    <div style="max-width:500px;margin:0 auto;font-family:Georgia,serif;color:#2c2022">
      <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c97d8a">
        <h1 style="margin:0;font-size:1.4rem;color:#9e5567">${companyName}</h1>
        <p style="margin:4px 0 0;font-size:.85rem;color:#6b5057">${tx.type === 'return' ? 'Return Receipt' : 'Sales Receipt'}</p>
      </div>
      <div style="padding:20px 0">
        <p style="font-size:.85rem;color:#6b5057;margin:0 0 4px">Receipt #: <strong>${tx.receipt_number}</strong></p>
        <p style="font-size:.85rem;color:#6b5057;margin:0 0 16px">Date: ${new Date(tx.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        <table style="width:100%;border-collapse:collapse;font-size:.88rem">
          <thead><tr style="background:#f2dde2">
            <th style="padding:8px;text-align:left">Item</th>
            <th style="padding:8px;text-align:center">Qty</th>
            <th style="padding:8px;text-align:right">Price</th>
            <th style="padding:8px;text-align:right">Total</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="margin-top:16px;text-align:right;font-size:.9rem">
          <p style="margin:4px 0">Subtotal: <strong>$${tx.subtotal.toFixed(2)}</strong></p>
          ${tx.discount_amount > 0 ? `<p style="margin:4px 0;color:#c97d8a">Discount: -$${tx.discount_amount.toFixed(2)}</p>` : ''}
          <p style="margin:4px 0">Tax: <strong>$${tx.tax_amount.toFixed(2)}</strong></p>
          <p style="margin:8px 0 0;font-size:1.1rem;color:#9e5567"><strong>Total: $${tx.total.toFixed(2)}</strong></p>
        </div>
        <p style="margin-top:16px;font-size:.82rem;color:#6b5057">Payment: ${tx.payment_method}</p>
      </div>
      <div style="text-align:center;padding:16px 0;border-top:1px solid #e8d5d9;font-size:.8rem;color:#6b5057">
        Thank you for your purchase!
      </div>
    </div>
  `;

  try {
    const { google } = require('googleapis');
    const oauth2Client = new (require('googleapis').auth.OAuth2)(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      access_token: user.access_token,
      refresh_token: user.refresh_token,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const subject = `${tx.type === 'return' ? 'Return' : 'Sales'} Receipt - ${tx.receipt_number} | ${companyName}`;
    const raw = [
      `From: ${user.email}`,
      `To: ${email}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join('\r\n');

    const encoded = Buffer.from(raw).toString('base64url');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });

    res.json({ ok: true, sent_to: email });
  } catch (err) {
    console.error('[pos] Email receipt error:', err.message);
    res.status(500).json({ error: 'Failed to send receipt email: ' + err.message });
  }
});

// ─── Reports ───────────────────────────────────────────────────────────────

router.get('/reports/sales', (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: posDb.getSalesReport(req.session.userId, startDate, endDate) });
});

router.get('/reports/employees', (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: posDb.getEmployeeSalesReport(req.session.userId, startDate, endDate) });
});

router.get('/reports/products', (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: posDb.getTopProductsReport(req.session.userId, startDate, endDate) });
});

router.get('/reports/customers', (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: posDb.getCustomerReport(req.session.userId, startDate, endDate) });
});

// ─── Customer Lookup ───────────────────────────────────────────────────────

router.get('/customers/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ customers: [] });
  const customer = getCustomerByEmail(q, req.session.userId);
  res.json({ customers: customer ? [customer] : [] });
});

module.exports = router;
