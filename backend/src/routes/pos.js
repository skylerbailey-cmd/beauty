'use strict';

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const { PRODUCTS } = require('./welcome');

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Debug endpoint (no auth)
router.get('/debug/products-sample', async (req, res) => {
  try {
    const userId = '24f18ae0-c5c5-420b-b9b3-1f4ea2c74112';
    const prices = await pgDb.getProductPrices(userId);
    const employees = await pgDb.getEmployees(userId);
    const sample = prices.slice(0, 3).map(p => ({ product_id: p.product_id, price: p.price, min_price: p.min_price }));
    res.json({ price_count: prices.length, employee_count: employees.length, employees: employees.map(e => ({ id: e.id, name: e.name, role: e.role, user_id: e.user_id })), sample, db_connected: true });
  } catch (err) {
    res.json({ error: err.message, db_connected: false });
  }
});

// Debug: check session userId
router.get('/debug/session', (req, res) => {
  res.json({ session_userId: req.session?.userId || 'NOT SET', has_session: !!req.session });
});

router.use(requireAuth);

// ─── Products (with prices) ────────────────────────────────────────────────

router.get('/products', async (req, res) => {
  try {
  const userId = req.session.userId;
  const [prices, visibility, customProducts] = await Promise.all([
    pgDb.getProductPrices(userId),
    pgDb.getProductVisibility(userId),
    pgDb.getCustomProducts(userId),
  ]);
  const priceMap = {};
  for (const p of prices) priceMap[p.product_id] = p;
  const visMap = {};
  for (const v of visibility) visMap[v.product_id] = v.visible;

  const allProducts = [];
  for (const [brandKey, products] of Object.entries(PRODUCTS)) {
    for (const prod of products) {
      const priceEntry = priceMap[prod.id];
      const vis = visMap[prod.id];
      allProducts.push({
        id: prod.id,
        name: prod.name,
        brand: prod.brand || brandKey,
        description: prod.description,
        image: prod.image,
        retailPrice: prod.retailPrice || 0,
        price: priceEntry?.price ?? prod.retailPrice ?? 0,
        minPrice: priceEntry?.min_price ?? 0,
        cost: priceEntry?.cost ?? 0,
        visible: vis === undefined ? true : !!vis,
        isCustom: false,
      });
    }
  }
  // Add custom products
  for (const cp of customProducts) {
    allProducts.push({
      id: `custom-${cp.id}`,
      name: cp.name,
      brand: cp.brand || 'Custom',
      description: cp.description,
      image: cp.image,
      retailPrice: cp.price,
      price: cp.price,
      minPrice: cp.min_price || 0,
      cost: 0,
      visible: true,
      isCustom: true,
      customId: cp.id,
    });
  }
  res.json({ products: allProducts });
  } catch (err) {
    console.error('[pos] Products error:', err.message, err.stack);
    // Fallback: return catalog products without prices/visibility from Postgres
    const allProducts = [];
    for (const [brandKey, prods] of Object.entries(PRODUCTS)) {
      for (const prod of prods) {
        allProducts.push({
          id: prod.id, name: prod.name, brand: prod.brand || brandKey,
          description: prod.description, image: prod.image,
          retailPrice: prod.retailPrice || 0, price: prod.retailPrice || 0,
          minPrice: 0, cost: 0, visible: true, isCustom: false,
        });
      }
    }
    res.json({ products: allProducts });
  }
});

router.post('/products/price', async (req, res) => {
  const { product_id, price, min_price, cost } = req.body;
  if (!product_id || price === undefined) {
    return res.status(400).json({ error: 'product_id and price required' });
  }
  await pgDb.setProductPrice(product_id, parseFloat(price), parseFloat(min_price || 0), parseFloat(cost || 0), req.session.userId);
  res.json({ ok: true });
});

router.post('/products/prices/bulk', async (req, res) => {
  const { prices } = req.body;
  if (!Array.isArray(prices)) return res.status(400).json({ error: 'prices array required' });
  for (const p of prices) {
    await pgDb.setProductPrice(p.product_id, parseFloat(p.price), parseFloat(p.min_price || 0), parseFloat(p.cost || 0), req.session.userId);
  }
  res.json({ ok: true });
});

// ─── Product Visibility ────────────────────────────────────────────────────

router.post('/products/visibility', async (req, res) => {
  const { product_id, visible } = req.body;
  await pgDb.setProductVisibility(product_id, req.session.userId, visible);
  res.json({ ok: true });
});

router.post('/products/visibility/bulk', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  for (const item of items) {
    await pgDb.setProductVisibility(item.product_id, req.session.userId, item.visible);
  }
  res.json({ ok: true });
});

// ─── Custom Products ──────────────────────────────────────────────────────

router.post('/products/custom', async (req, res) => {
  const product = await pgDb.createCustomProduct(req.body, req.session.userId);
  res.json({ product });
});

router.put('/products/custom/:id', async (req, res) => {
  await pgDb.updateCustomProduct(parseInt(req.params.id), req.body);
  res.json({ ok: true });
});

// ─── Employees ─────────────────────────────────────────────────────────────

router.get('/employees', async (req, res) => {
  res.json({ employees: await pgDb.getEmployees(req.session.userId) });
});

router.post('/employees', async (req, res) => {
  const { name, pin, role, commission_rate } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
  if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  const employee = await pgDb.createEmployee(name, pin, role, commission_rate, req.session.userId);
  res.json({ employee });
});

router.put('/employees/:id', async (req, res) => {
  await pgDb.updateEmployee(parseInt(req.params.id), req.body);
  res.json({ ok: true });
});

router.post('/employees/verify', async (req, res) => {
  const { pin } = req.body;
  const employee = await pgDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ employee });
});

// ─── Transactions ──────────────────────────────────────────────────────────

router.post('/transactions', async (req, res) => {
  const userId = req.session.userId;
  const { type, employee_id, employees: employeeAssignments, customer_name, customer_email, items, payment_method, card_last4, notes, tax_rate, discount_amount, original_receipt } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one item required' });
  }

  if (payment_method === 'card' && type !== 'return' && (!card_last4 || card_last4.length !== 4)) {
    return res.status(400).json({ error: 'Last 4 digits of credit card required for card payments' });
  }

  // Enforce minimum pricing (skip for returns)
  if (type !== 'return') {
    const [prices, customProducts] = await Promise.all([
      pgDb.getProductPrices(userId),
      pgDb.getCustomProducts(userId),
    ]);
    const minPriceMap = {};
    for (const p of prices) { if (p.min_price > 0) minPriceMap[p.product_id] = p.min_price; }
    for (const cp of customProducts) { if (cp.min_price > 0) minPriceMap[`custom-${cp.id}`] = cp.min_price; }

    for (const item of items) {
      const minPrice = minPriceMap[item.product_id];
      if (minPrice && item.unit_price > 0 && item.unit_price < minPrice) {
        return res.status(400).json({
          error: `Cannot honor this pricing. The minimum allowed price for "${item.product_name}" is $${minPrice.toFixed(2)}.`
        });
      }
    }
  }

  // If this is a return, require original receipt and enforce 14-day policy
  let original_transaction_id = null;
  let original_sale_date = null;
  if (type === 'return') {
    if (!original_receipt) {
      return res.status(400).json({ error: 'Original receipt number is required for returns' });
    }
    const orig = await pgDb.getTransactionByReceipt(original_receipt, userId);
    if (!orig) {
      return res.status(404).json({ error: 'Original receipt not found' });
    }
    if (orig.type !== 'sale') {
      return res.status(400).json({ error: 'Can only return against a sale receipt' });
    }
    const saleDate = new Date(orig.created_at);
    const daysSince = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) {
      return res.status(400).json({ error: `Return window expired. Sale was ${Math.floor(daysSince)} days ago (14-day limit).` });
    }
    original_transaction_id = orig.id;
    original_sale_date = orig.created_at;
  }

  // Use tax rate from settings if not explicitly provided
  let rate = tax_rate;
  if (rate === undefined || rate === null) {
    const settings = await pgDb.getSettings(userId);
    rate = settings?.tax_rate ?? 0.0875;
  }
  const subtotal = items.reduce((sum, i) => sum + (i.unit_price * (i.quantity || 1) - (i.discount || 0)), 0);
  const disc = parseFloat(discount_amount || 0);
  const taxable = subtotal - disc;
  const tax_amount = Math.round(taxable * rate * 100) / 100;
  const total = Math.round((taxable + tax_amount) * 100) / 100;

  const { id, receipt_number } = await pgDb.createTransaction({
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
    card_last4: card_last4 || '',
    notes: notes || '',
    original_transaction_id,
    original_sale_date,
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

  await pgDb.addTransactionItems(id, txItems);

  // Record employee commissions
  if (employeeAssignments && employeeAssignments.length > 0) {
    const empRecords = employeeAssignments.map(ea => {
      let commissionAmount = 0;
      if (ea.commission_type === 'dollar') {
        commissionAmount = ea.commission_value || 0;
      } else {
        commissionAmount = Math.round(total * (ea.commission_value || 100) / 100 * 100) / 100;
      }
      return {
        employee_id: ea.employee_id,
        commission_type: ea.commission_type || 'percent',
        commission_value: ea.commission_value || 100,
        commission_amount: commissionAmount,
      };
    });
    await pgDb.addTransactionEmployees(id, empRecords);
  } else if (employee_id) {
    await pgDb.addTransactionEmployees(id, [{
      employee_id,
      commission_type: 'percent',
      commission_value: 100,
      commission_amount: total,
    }]);
  }

  // Also record in CRM (Postgres)
  if (type !== 'return' && customer_email) {
    try {
      const customer = await pgDb.findOrCreateCustomer(customer_name, customer_email, userId);
      const productsForCrm = txItems.map(i => ({ id: i.product_id, name: i.product_name }));
      await pgDb.addCustomerProducts(customer.id, productsForCrm);
    } catch (_) { /* non-critical */ }
  }

  const tx = await pgDb.getTransaction(id);
  res.json({ transaction: tx });
});

router.get('/transactions', async (req, res) => {
  const { type, start, end, employee_id, limit } = req.query;
  const opts = {};
  if (type) opts.type = type;
  if (start) opts.startDate = start;
  if (end) opts.endDate = end;
  if (employee_id) opts.employeeId = parseInt(employee_id);
  if (limit) opts.limit = parseInt(limit);
  res.json({ transactions: await pgDb.getTransactions(req.session.userId, opts) });
});

router.get('/transactions/:id', async (req, res) => {
  const tx = await pgDb.getTransaction(parseInt(req.params.id));
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

router.get('/transactions/receipt/:number', async (req, res) => {
  const tx = await pgDb.getTransactionByReceipt(req.params.number, req.session.userId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

// ─── Gmail helper ─────────────────────────────────────────────────────────

async function sendGmail(user, toEmail, subject, htmlBody) {
  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: user.refresh_token });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const fromName = user.company_name || user.email;
  const raw = [
    `From: "${fromName}" <${user.email}>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    htmlBody,
  ].join('\r\n');

  const encoded = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
}

// ─── Email Receipt ─────────────────────────────────────────────────────────

router.post('/transactions/:id/email', async (req, res) => {
  const tx = await pgDb.getTransaction(parseInt(req.params.id));
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const email = req.body.email || tx.customer_email;
  if (!email) return res.status(400).json({ error: 'Email address required' });

  const { getUser } = require('../db');
  const user = getUser(req.session.userId);
  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail not connected. Please connect Gmail via the Welcome Emails page first.' });
  }

  const settings = await pgDb.getSettings(req.session.userId);
  const storeName = settings.store_name || user.company_name || 'Glow SF';
  const storeAddress = settings.store_address || '';
  const footer = settings.receipt_footer || 'Thank you for your purchase!';
  const tz = settings.timezone || 'America/Los_Angeles';

  const dateStr = new Date(tx.created_at).toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const employeeNames = (tx.employees || []).map(e => e.employee_name).join(', ');

  const itemRows = tx.items.map(i =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.product_name}</td>` +
    `<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>` +
    `<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${i.unit_price.toFixed(2)}</td>` +
    `<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${i.line_total.toFixed(2)}</td></tr>`
  ).join('');

  const html = `
    <div style="max-width:500px;margin:0 auto;font-family:Georgia,serif;color:#2c2022">
      <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c97d8a">
        <h1 style="margin:0;font-size:1.4rem;color:#9e5567">${storeName}</h1>
        ${storeAddress ? `<p style="margin:4px 0 0;font-size:.78rem;color:#6b5057">${storeAddress}</p>` : ''}
        <p style="margin:4px 0 0;font-size:.85rem;color:#6b5057">${tx.type === 'return' ? 'Return Receipt' : 'Sales Receipt'}</p>
      </div>
      <div style="padding:20px 0">
        <p style="font-size:.85rem;color:#6b5057;margin:0 0 4px">Receipt #: <strong>${tx.receipt_number}</strong></p>
        <p style="font-size:.85rem;color:#6b5057;margin:0 0 4px">Date: ${dateStr}</p>
        ${employeeNames ? `<p style="font-size:.85rem;color:#6b5057;margin:0 0 4px">Sales Associate${tx.employees.length > 1 ? 's' : ''}: <strong>${employeeNames}</strong></p>` : ''}
        ${tx.customer_name ? `<p style="font-size:.85rem;color:#6b5057;margin:0 0 4px">Customer: <strong>${tx.customer_name}</strong></p>` : ''}
        <div style="margin-top:12px">
        <table style="width:100%;border-collapse:collapse;font-size:.88rem">
          <thead><tr style="background:#f2dde2">
            <th style="padding:8px;text-align:left">Item</th>
            <th style="padding:8px;text-align:center">Qty</th>
            <th style="padding:8px;text-align:right">Price</th>
            <th style="padding:8px;text-align:right">Total</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        </div>
        <div style="margin-top:16px;text-align:right;font-size:.9rem">
          <p style="margin:4px 0">Subtotal: <strong>$${tx.subtotal.toFixed(2)}</strong></p>
          <p style="margin:4px 0">Tax (${(tx.tax_rate * 100).toFixed(2)}%): <strong>$${tx.tax_amount.toFixed(2)}</strong></p>
          <p style="margin:8px 0 0;font-size:1.1rem;color:#9e5567"><strong>Total: $${tx.total.toFixed(2)}</strong></p>
        </div>
        <p style="margin-top:16px;font-size:.82rem;color:#6b5057">Payment: ${tx.payment_method}${tx.card_last4 ? ` ****${tx.card_last4}` : ''}</p>
      </div>
      <div style="text-align:center;padding:16px 0;border-top:1px solid #e8d5d9;font-size:.8rem;color:#6b5057">
        ${footer}
      </div>
    </div>
  `;

  try {
    const subject = `${tx.type === 'return' ? 'Return' : 'Sales'} Receipt #${tx.receipt_number} | ${storeName}`;
    await sendGmail(user, email, subject, html);
    res.json({ ok: true, sent_to: email });
  } catch (err) {
    console.error('[pos] Email receipt error:', err.message);
    res.status(500).json({ error: 'Failed to send receipt email: ' + err.message });
  }
});

// ─── Email Product Instructions ─────────────────────────────────────────────

router.post('/transactions/:id/instructions', async (req, res) => {
  const tx = await pgDb.getTransaction(parseInt(req.params.id));
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const email = req.body.email || tx.customer_email;
  if (!email) return res.status(400).json({ error: 'Email address required' });

  const { getUser } = require('../db');
  const user = getUser(req.session.userId);
  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail not connected. Please connect Gmail via the Welcome Emails page first.' });
  }

  const settings = await pgDb.getSettings(req.session.userId);
  const storeName = settings.store_name || user.company_name || 'Glow SF';

  const allProducts = [];
  for (const [, products] of Object.entries(PRODUCTS)) {
    for (const p of products) allProducts.push(p);
  }

  const instructionSections = tx.items.map(item => {
    const catalogProduct = allProducts.find(p => p.id === item.product_id);
    if (!catalogProduct) return '';
    return `
      <div style="margin-bottom:24px;padding:20px;border:1px solid #e8d5d9;border-radius:12px;background:#fdf9f5">
        <h3 style="margin:0 0 4px;font-size:1rem;color:#9e5567">${catalogProduct.name}</h3>
        <p style="margin:0 0 12px;font-size:.78rem;color:#6b5057;font-style:italic">${catalogProduct.brand}</p>
        ${catalogProduct.howToUse ? `<div style="margin-bottom:12px"><strong style="font-size:.82rem;color:#2c2022">How to Use:</strong><p style="margin:4px 0 0;font-size:.88rem;color:#2c2022;line-height:1.6">${catalogProduct.howToUse}</p></div>` : ''}
        ${catalogProduct.benefits ? `<div><strong style="font-size:.82rem;color:#2c2022">Benefits:</strong><p style="margin:4px 0 0;font-size:.85rem;color:#6b5057;line-height:1.5">${catalogProduct.benefits}</p></div>` : ''}
        ${catalogProduct.frequency ? `<p style="margin:8px 0 0;font-size:.82rem;color:#9e5567"><strong>Recommended frequency:</strong> ${catalogProduct.frequency}</p>` : ''}
      </div>
    `;
  }).filter(Boolean).join('');

  if (!instructionSections) {
    return res.status(400).json({ error: 'No product instructions available for items in this transaction' });
  }

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#2c2022">
      <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c97d8a">
        <h1 style="margin:0;font-size:1.4rem;color:#9e5567">${storeName}</h1>
        <p style="margin:4px 0 0;font-size:.85rem;color:#6b5057">Your Product Instructions</p>
      </div>
      <div style="padding:24px 0">
        <p style="font-size:.92rem;color:#2c2022;margin:0 0 20px;line-height:1.5">
          Thank you for your purchase! Here are the usage instructions for your products.
        </p>
        ${instructionSections}
      </div>
      <div style="text-align:center;padding:16px 0;border-top:1px solid #e8d5d9;font-size:.8rem;color:#6b5057">
        Questions? Reply to this email and we'll be happy to help.
      </div>
    </div>
  `;

  try {
    await sendGmail(user, email, `Your Product Instructions | ${storeName}`, html);
    res.json({ ok: true, sent_to: email });
  } catch (err) {
    console.error('[pos] Instructions email error:', err.message);
    res.status(500).json({ error: 'Failed to send instructions email: ' + err.message });
  }
});

// ─── Reports ───────────────────────────────────────────────────────────────

router.get('/reports/sales', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: await pgDb.getSalesReport(req.session.userId, startDate, endDate) });
});

router.get('/reports/employees', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: await pgDb.getEmployeeSalesReport(req.session.userId, startDate, endDate) });
});

router.get('/reports/products', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: await pgDb.getTopProductsReport(req.session.userId, startDate, endDate) });
});

router.get('/reports/customers', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: await pgDb.getCustomerReport(req.session.userId, startDate, endDate) });
});

// ─── Employee Personal Report (PIN-protected) ─────────────────────────────

router.post('/reports/employee-personal', async (req, res) => {
  const { pin, start, end } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const employee = await pgDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid PIN' });

  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();

  // Managers see all employees, sales see only their own
  if (employee.role === 'manager') {
    const report = await pgDb.getEmployeeSalesReport(req.session.userId, startDate, endDate);
    res.json({ employee, role: 'manager', report });
  } else {
    // Single employee report
    const report = await pgDb.getEmployeeSalesReport(req.session.userId, startDate, endDate);
    const personal = report.filter(r => r.employee_id === employee.id);
    res.json({ employee, role: 'sales', report: personal });
  }
});

// ─── Settings ──────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  res.json({ settings: await pgDb.getSettings(req.session.userId) });
});

router.post('/settings', async (req, res) => {
  await pgDb.updateSettings(req.session.userId, req.body);
  res.json({ settings: await pgDb.getSettings(req.session.userId) });
});

// ─── Customer Lookup ───────────────────────────────────────────────────────

router.get('/customers/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ customers: [] });
  const customer = await pgDb.getCustomerByEmail(q, req.session.userId);
  res.json({ customers: customer ? [customer] : [] });
});

module.exports = router;
