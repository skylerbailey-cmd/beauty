'use strict';

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const { PRODUCTS, generateWelcomeEmailBody } = require('./welcome');

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

// One-time, non-destructive bridge: reattach any orphaned pre-migration dataset
// to this (now-stable) company account. Never pulls another company's data.
const bridgedUsers = new Set();
router.use(async (req, res, next) => {
  const userId = req.session.userId;
  if (userId && !bridgedUsers.has(userId)) {
    bridgedUsers.add(userId);
    try {
      const { getUser } = require('../db');
      const companyName = getUser(userId)?.company_name || '';
      await pgDb.bridgeLegacyData(userId, companyName);
    } catch (e) {
      console.error('[pos] Legacy data bridge failed:', e.message);
    }
  }
  next();
});

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

// Copy employees from another company (identified by its login email) into the
// current company. Skips employees that already exist here (matched by name).
router.post('/employees/import-from', async (req, res) => {
  const userId = req.session.userId;
  const { source_email } = req.body;
  if (!source_email) return res.status(400).json({ error: 'source_email is required' });

  // Resolve the source company's stable id from its email (works even if its
  // SQLite row was reset on a redeploy, since ids are deterministic).
  const { findOrCreateUserByEmail } = require('../db');
  const { user: sourceUser } = findOrCreateUserByEmail(String(source_email).trim().toLowerCase());
  if (!sourceUser) return res.status(404).json({ error: 'That company was not found.' });
  if (sourceUser.id === userId) return res.status(400).json({ error: 'Cannot import from the same company.' });

  const [sourceEmployees, existing] = await Promise.all([
    pgDb.getEmployees(sourceUser.id),
    pgDb.getEmployees(userId),
  ]);
  const existingNames = new Set(existing.map(e => e.name.trim().toLowerCase()));

  let imported = 0, skipped = 0;
  for (const emp of sourceEmployees) {
    if (existingNames.has(emp.name.trim().toLowerCase())) { skipped++; continue; }
    await pgDb.createEmployee(emp.name, emp.pin, emp.role, emp.commission_rate, userId);
    existingNames.add(emp.name.trim().toLowerCase());
    imported++;
  }
  res.json({ ok: true, imported, skipped, source_count: sourceEmployees.length });
});

// ─── Transactions ──────────────────────────────────────────────────────────

router.post('/transactions', async (req, res) => {
  const userId = req.session.userId;
  const { type, employee_id, employees: employeeAssignments, customer_name, customer_email, items, payment_method, card_last4, notes, tax_rate, discount_amount, original_receipt, manager_name, manager_pin } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one item required' });
  }

  // An employee must be assigned before a transaction can be completed.
  const hasEmployee = (Array.isArray(employeeAssignments) && employeeAssignments.some(e => e && e.employee_id)) || !!employee_id;
  if (!hasEmployee) {
    return res.status(400).json({ error: 'At least one employee must be added to complete this transaction.' });
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
  let receiptOverride = null;
  let employeesChanged = false;
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

    // Require the last 4 of the card, and match it to the original sale.
    if (!card_last4 || card_last4.length !== 4) {
      return res.status(400).json({ error: 'Enter the last 4 digits of the card used for this return.' });
    }
    if (orig.card_last4 && card_last4 !== orig.card_last4) {
      const manager = await verifyManager(userId, manager_name, manager_pin);
      if (!manager) {
        return res.status(403).json({
          error: `Card ****${card_last4} does not match the card on the original sale (****${orig.card_last4}). A manager must approve this return.`,
          needsManagerOverride: true,
        });
      }
    }

    original_transaction_id = orig.id;
    original_sale_date = orig.created_at;
    // Return receipt = "R" + the original sale's receipt number
    receiptOverride = 'R' + orig.receipt_number;

    // Flag if the employees credited on the return differ from the sale
    const origIds = new Set((orig.employees || []).map(e => e.employee_id));
    const retIds = new Set(
      (Array.isArray(employeeAssignments) && employeeAssignments.length
        ? employeeAssignments.map(e => e.employee_id)
        : (employee_id ? [employee_id] : []))
    );
    employeesChanged = origIds.size !== retIds.size || [...retIds].some(id => !origIds.has(id));
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
    receipt_number: receiptOverride,
    employees_changed: employeesChanged,
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

  // Record employee commissions — based on the pre-tax SUBTOTAL (tax excluded)
  if (employeeAssignments && employeeAssignments.length > 0) {
    const empRecords = employeeAssignments.map(ea => {
      let commissionAmount = 0;
      if (ea.commission_type === 'dollar') {
        commissionAmount = ea.commission_value || 0;
      } else {
        commissionAmount = Math.round(subtotal * (ea.commission_value || 100) / 100 * 100) / 100;
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
      commission_amount: subtotal,
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

  const tx = await pgDb.getTransaction(id, userId);
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
  const tx = await pgDb.getTransaction(parseInt(req.params.id), req.session.userId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

// ─── Manager-gated Edit / Delete ────────────────────────────────────────────

// Verify a manager's name + PIN for the current company. Returns the manager
// employee record or null.
async function verifyManager(userId, name, pin) {
  if (!pin) return null;
  const emp = await pgDb.verifyEmployeePin(pin, userId);
  if (!emp || emp.role !== 'manager') return null;
  // Name must match the PIN's employee (case-insensitive, trimmed) when provided
  if (name && emp.name.trim().toLowerCase() !== String(name).trim().toLowerCase()) return null;
  return emp;
}

router.post('/manager/verify', async (req, res) => {
  const { name, pin } = req.body;
  const manager = await verifyManager(req.session.userId, name, pin);
  if (!manager) return res.status(401).json({ error: 'Manager name and code do not match a manager for this store.' });
  res.json({ ok: true, manager: { id: manager.id, name: manager.name } });
});

router.put('/transactions/:id', async (req, res) => {
  const userId = req.session.userId;
  const { manager_name, manager_pin } = req.body;
  const manager = await verifyManager(userId, manager_name, manager_pin);
  if (!manager) return res.status(403).json({ error: 'Only a manager can edit a transaction. Manager name and code did not match.' });

  const hasEmployee = Array.isArray(req.body.employees) && req.body.employees.some(e => e && e.employee_id);
  if (!hasEmployee) return res.status(400).json({ error: 'At least one employee must be assigned to the transaction.' });

  try {
    const tx = await pgDb.updateTransaction(parseInt(req.params.id), userId, req.body);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ transaction: tx });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/transactions/:id', async (req, res) => {
  const userId = req.session.userId;
  const { manager_name, manager_pin } = req.body;
  const manager = await verifyManager(userId, manager_name, manager_pin);
  if (!manager) return res.status(403).json({ error: 'Only a manager can delete a transaction. Manager name and code did not match.' });

  const ok = await pgDb.deleteTransaction(parseInt(req.params.id), userId);
  if (!ok) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ ok: true });
});

router.get('/transactions/receipt/:number', async (req, res) => {
  const tx = await pgDb.getTransactionByReceipt(req.params.number, req.session.userId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: tx });
});

// ─── Gmail helper ─────────────────────────────────────────────────────────

// Load the current company's user record and ensure its own Gmail refresh
// token is populated (from Postgres if SQLite lost it after a redeploy).
// Never falls back to another company's token.
async function getSendingUser(userId) {
  const { getUser, updateUserTokens } = require('../db');
  const user = getUser(userId);
  if (user && !user.refresh_token) {
    // SQLite lost the token (redeploy) — restore this company's own token
    try {
      const rt = await pgDb.getGmailToken(userId);
      if (rt) { updateUserTokens(userId, null, rt); user.refresh_token = rt; }
    } catch (_) {}
  } else if (user && user.refresh_token) {
    // Back-fill: persist an already-connected token to Postgres so the
    // connection survives future redeploys without a reconnect.
    try {
      const rt = await pgDb.getGmailToken(userId);
      if (!rt) await pgDb.saveGmailToken(userId, user.refresh_token, user.email);
    } catch (_) {}
  }
  return user;
}

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
  const tx = await pgDb.getTransaction(parseInt(req.params.id), req.session.userId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const email = req.body.email || tx.customer_email;
  if (!email) return res.status(400).json({ error: 'Email address required' });

  const user = await getSendingUser(req.session.userId);
  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Connect this company\'s Gmail on the Welcome Emails page first.' });
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
        ${employeeNames ? `<p style="font-size:.85rem;color:#6b5057;margin:0 0 4px">Employee${tx.employees.length > 1 ? 's' : ''}: <strong>${employeeNames}</strong></p>` : ''}
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

// ─── Send Welcome Email ─────────────────────────────────────────────────────
// Generates the SAME personalized welcome email as the Welcome Emails tool,
// straight from the transaction's products, and sends it via Gmail.

router.post('/transactions/:id/welcome', async (req, res) => {
  const userId = req.session.userId;
  const tx = await pgDb.getTransaction(parseInt(req.params.id), userId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  const email = req.body.email || tx.customer_email;
  if (!email) return res.status(400).json({ error: 'Email address required' });

  const customerName = (req.body.customer_name || tx.customer_name || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Customer name is required to send a welcome email.' });

  const user = await getSendingUser(userId);
  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Connect this company\'s Gmail on the Welcome Emails page first.' });
  }

  // Only catalog products can drive the personalized routine (custom products
  // have no usage data). Use the transaction's line items.
  const selectedProductIds = tx.items.map(i => i.product_id);

  let emailBody, selectedProducts;
  try {
    ({ emailBody, selectedProducts } = generateWelcomeEmailBody({
      customerEmail: email,
      customerName,
      selectedProductIds,
      userId,
    }));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const storeName = (await pgDb.getSettings(userId)).store_name || user.company_name || 'our store';
  const subject = user.company_name ? `Welcome to ${user.company_name}!` : 'Welcome!';

  try {
    await sendGmail(user, email, subject, emailBody);
    // Record in history + CRM, matching the Welcome Emails tool behavior
    try {
      await pgDb.saveWelcomeEmail({
        customer_name: customerName,
        customer_email: email,
        products: selectedProducts.map(p => p.name),
        user_id: userId,
      });
      const customer = await pgDb.findOrCreateCustomer(customerName, email, userId);
      await pgDb.addCustomerProducts(customer.id, selectedProducts.map(p => ({ id: p.id, name: p.name })));
    } catch (_) { /* non-critical */ }
    res.json({ ok: true, sent_to: email });
  } catch (err) {
    console.error('[pos] Welcome email error:', err.message);
    res.status(500).json({ error: 'Failed to send welcome email: ' + err.message });
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

router.get('/reports/flagged-returns', async (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const endDate = end || new Date().toISOString();
  res.json({ report: await pgDb.getFlaggedReturns(req.session.userId, startDate, endDate) });
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
