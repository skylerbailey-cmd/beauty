'use strict';

const express = require('express');
const router = express.Router();
const pgDb = require('../db/postgres');
const { PRODUCTS, generateWelcomeEmailBody } = require('./welcome');

// Format a money amount with thousands separators (e.g. 15146.25 -> "15,146.25")
function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Combine the street address with city/state/zip so receipts always show the
// full mailing address, e.g. "123 Main St" + "San Francisco"/"CA"/"94103".
function formatStoreAddress(settings) {
  const street = (settings?.store_address || '').trim();
  const cityStateZip = [settings?.store_city, settings?.store_state].filter(Boolean).join(', ') +
    (settings?.store_zip ? ' ' + settings.store_zip : '');
  return [street, cityStateZip.trim()].filter(Boolean).join(', ');
}

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
        minPrice: priceEntry?.min_price ?? prod.minPrice ?? 0,
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
          minPrice: prod.minPrice || 0, cost: 0, visible: true, isCustom: false,
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

// ─── Commission Plans ──────────────────────────────────────────────────────
// A "flat" employee earns their per-sale commission_value% straight, as
// recorded at checkout. A "daily_threshold" employee instead gets one of two
// rates for their WHOLE day depending on their day's net sales: base_rate below
// tier_threshold, tier_rate at/above it. This is computed at report time from
// transaction history (see calculateEmployeeCommission), so it naturally
// resets every calendar day with no stored "today's total" to reset.

router.get('/employees/:id/commission-plan', async (req, res) => {
  const plan = await pgDb.getCommissionPlan(parseInt(req.params.id));
  res.json({ plan });
});

router.put('/employees/:id/commission-plan', async (req, res) => {
  const { plan_type, base_rate, tier_rate, tier_threshold } = req.body;
  if (!['flat', 'daily_threshold'].includes(plan_type)) {
    return res.status(400).json({ error: 'plan_type must be "flat" or "daily_threshold"' });
  }
  const baseRate = parseFloat(base_rate);
  if (isNaN(baseRate) || baseRate < 0 || baseRate > 100) {
    return res.status(400).json({ error: 'base_rate must be a percentage between 0 and 100' });
  }
  const plan = { plan_type, base_rate: baseRate };
  if (plan_type === 'daily_threshold') {
    const tierRate = parseFloat(tier_rate);
    const tierThreshold = parseFloat(tier_threshold);
    if (isNaN(tierRate) || tierRate < 0 || tierRate > 100) {
      return res.status(400).json({ error: 'tier_rate must be a percentage between 0 and 100' });
    }
    if (isNaN(tierThreshold) || tierThreshold < 0) {
      return res.status(400).json({ error: 'tier_threshold must be a dollar amount of 0 or more' });
    }
    plan.tier_rate = tierRate;
    plan.tier_threshold = tierThreshold;
  }
  await pgDb.setCommissionPlan(parseInt(req.params.id), plan, req.session.userId);
  res.json({ ok: true });
});

router.delete('/employees/:id/commission-plan', async (req, res) => {
  await pgDb.deleteCommissionPlan(parseInt(req.params.id));
  res.json({ ok: true });
});

// Verify any employee's own name + PIN (not manager-restricted) — used to gate
// the Settings tab so an employee can get in far enough to see their own name
// and change their own PIN, without exposing the rest of Settings to them.
// Only {id, name} is returned, never the full row (which includes the PIN).
router.post('/employees/verify', async (req, res) => {
  const { name, pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  const employee = await pgDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid name or PIN' });
  if (name && employee.name.trim().toLowerCase() !== String(name).trim().toLowerCase()) {
    return res.status(401).json({ error: 'Invalid name or PIN' });
  }
  const role = employee.role === 'manager' ? 'manager' : 'sales';
  res.json({ employee: { id: employee.id, name: employee.name }, role });
});

// Self-service PIN change: authenticated by the employee's OWN current PIN
// (not a manager override), and can only ever touch that one employee's PIN —
// no other field is reachable through this route.
router.post('/employees/change-pin', async (req, res) => {
  const { name, pin, new_pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'Current PIN required' });
  const employee = await pgDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid name or PIN' });
  if (name && employee.name.trim().toLowerCase() !== String(name).trim().toLowerCase()) {
    return res.status(401).json({ error: 'Invalid name or PIN' });
  }
  const newPin = String(new_pin || '').trim();
  if (newPin.length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
  await pgDb.updateEmployee(employee.id, { pin: newPin });
  res.json({ ok: true });
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

// A transaction must be assigned to at least one REAL, active employee of
// this company — not just any truthy id. Returns an error string, or null
// if the assignment is valid.
async function validateEmployeeAssignment(userId, employeeAssignments, employeeId) {
  const assignedIds = (Array.isArray(employeeAssignments) && employeeAssignments.length)
    ? employeeAssignments.map(e => e && e.employee_id).filter(id => id != null)
    : (employeeId ? [employeeId] : []);
  if (assignedIds.length === 0) {
    return 'At least one employee must be added to complete this transaction.';
  }
  const roster = await pgDb.getEmployees(userId);
  const validIds = new Set(roster.filter(e => e.active).map(e => e.id));
  if (assignedIds.some(id => !validIds.has(id))) {
    return 'One of the assigned employees is no longer active or does not exist. Refresh and re-select employees.';
  }
  return null;
}

router.post('/transactions', async (req, res) => {
  const userId = req.session.userId;
  const { type, employee_id, employees: employeeAssignments, customer_name, customer_email, customer_phone, items, payment_method, card_last4, payments, notes, tax_rate, discount_amount, original_receipt, manager_name, manager_pin } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one item required' });
  }

  // An employee must be assigned before a transaction can be completed.
  const employeeError = await validateEmployeeAssignment(userId, employeeAssignments, employee_id);
  if (employeeError) {
    return res.status(400).json({ error: employeeError });
  }

  // Sales (not returns) require a customer name and a valid email before they
  // can be completed.
  if (type !== 'return') {
    if (!customer_name || !String(customer_name).trim()) {
      return res.status(400).json({ error: 'Customer name is required to complete a sale.' });
    }
    if (!customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer_email).trim())) {
      return res.status(400).json({ error: 'A valid customer email is required to complete a sale.' });
    }
  }

  // Compute totals and the payment tenders up front so the return card-matching
  // below can validate the refund against the original sale's card(s).
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

  // Split payment: the register may send one or more tenders — for sales AND
  // refunds. Fall back to the legacy single payment_method/card_last4 when no
  // `payments` array is given.
  const tenders = (Array.isArray(payments) && payments.length)
    ? payments.map(p => ({
        method: ['card', 'cash', 'other'].includes(p.method) ? p.method : 'card',
        amount: Math.round((Number(p.amount) || 0) * 100) / 100,
        card_last4: String(p.card_last4 || '').trim(),
      }))
    : [{ method: payment_method || 'card', amount: total, card_last4: String(card_last4 || '').trim() }];

  for (const t of tenders) {
    if (t.amount <= 0) {
      return res.status(400).json({ error: 'Each payment amount must be greater than $0.' });
    }
    if (t.method === 'card' && !/^\d{4}$/.test(t.card_last4)) {
      return res.status(400).json({ error: `Last 4 digits of the card are required for each card ${type === 'return' ? 'refund' : 'payment'}.` });
    }
  }
  const tenderSum = Math.round(tenders.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  if (Math.abs(tenderSum - total) > 0.01) {
    const word = type === 'return' ? 'Refunds' : 'Payments';
    return res.status(400).json({ error: `${word} add up to $${money(tenderSum)} but the total is $${money(total)}. They must match.` });
  }

  // Legacy summary columns: a single tender keeps its method/card; a true split
  // is stored as 'split' with the per-tender detail living in the payments table.
  const isSplit = tenders.length > 1;
  const summaryMethod = isSplit ? 'split' : tenders[0].method;
  const summaryLast4 = isSplit ? '' : tenders[0].card_last4;

  // Enforce minimum pricing (skip for returns)
  if (type !== 'return') {
    const [prices, customProducts] = await Promise.all([
      pgDb.getProductPrices(userId),
      pgDb.getCustomProducts(userId),
    ]);
    const minPriceMap = {};
    // Catalog-defined default minimums (overridden by any per-store price entry below)
    for (const [, prods] of Object.entries(PRODUCTS)) {
      for (const prod of prods) { if (prod.minPrice > 0) minPriceMap[prod.id] = prod.minPrice; }
    }
    for (const p of prices) { if (p.min_price > 0) minPriceMap[p.product_id] = p.min_price; }
    for (const cp of customProducts) { if (cp.min_price > 0) minPriceMap[`custom-${cp.id}`] = cp.min_price; }

    for (const item of items) {
      const minPrice = minPriceMap[item.product_id];
      // Check the price actually charged (unit_price minus any per-unit
      // discount), not the pre-discount unit_price — otherwise a discount
      // could be used to sell below the enforced minimum.
      const effectivePrice = item.unit_price - (item.discount || 0) / (item.quantity || 1);
      if (minPrice && effectivePrice > 0 && effectivePrice < minPrice) {
        return res.status(400).json({
          error: `Cannot honor this pricing. The minimum allowed price for "${item.product_name}" is $${money(minPrice)}.`
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

    // Match the refunded card(s) to the card(s) used on the original sale. With
    // split payments both the sale and the refund can span multiple cards, so
    // check each refunded card against the set used originally; any card that
    // wasn't on the sale needs a manager to approve (same control as before,
    // now split-aware). Card last-4s were already validated on the tenders.
    const refundCards = tenders.filter(t => t.method === 'card').map(t => t.card_last4);
    const origCards = new Set(
      (Array.isArray(orig.payments) ? orig.payments : [])
        .filter(p => p && p.method === 'card')
        .map(p => String(p.card_last4 || '').trim())
        .concat(orig.card_last4 ? [String(orig.card_last4).trim()] : [])
        .filter(c => /^\d{4}$/.test(c))
    );
    // Only enforce matching when we actually know the original card(s).
    const mismatched = origCards.size ? refundCards.filter(c => !origCards.has(c)) : [];
    if (mismatched.length) {
      const manager = await verifyManager(userId, manager_name, manager_pin);
      if (!manager) {
        const list = [...new Set(mismatched)].map(c => `****${c}`).join(', ');
        const origList = [...origCards].map(c => `****${c}`).join(', ');
        return res.status(403).json({
          error: `Card ${list} does not match the card${origCards.size > 1 ? 's' : ''} on the original sale (${origList}). A manager must approve this return.`,
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

  const { id, receipt_number } = await pgDb.createTransaction({
    type: type || 'sale',
    employee_id,
    customer_name: customer_name || '',
    customer_email: customer_email || '',
    customer_phone: customer_phone || '',
    subtotal,
    tax_rate: rate,
    tax_amount,
    discount_amount: disc,
    total,
    payment_method: summaryMethod,
    card_last4: summaryLast4,
    payments: tenders,
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
      const customer = await pgDb.findOrCreateCustomer(customer_name, customer_email, userId, customer_phone);
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

// ─── Employee-scoped Transactions (PIN-protected, read-only) ──────────────
// Any employee can view transactions, but only their own — either rung up as
// the primary cashier or assigned as a participant (e.g. commission split).
// Managers see the full company list. This never exposes edit/delete.
router.post('/transactions/mine', async (req, res) => {
  const { name, pin, start, end } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const employee = await pgDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid name or PIN' });
  if (name && employee.name.trim().toLowerCase() !== String(name).trim().toLowerCase()) {
    return res.status(401).json({ error: 'Invalid name or PIN' });
  }

  const opts = { limit: 2000 };
  if (start) opts.startDate = start;
  if (end) opts.endDate = end;

  const role = employee.role === 'manager' ? 'manager' : 'sales';
  const transactions = role === 'manager'
    ? await pgDb.getTransactions(req.session.userId, opts)
    : await pgDb.getEmployeeTransactions(req.session.userId, employee.id, opts);

  res.json({ employee: { id: employee.id, name: employee.name }, role, transactions });
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

  const employeeError = await validateEmployeeAssignment(userId, req.body.employees, null);
  if (employeeError) return res.status(400).json({ error: employeeError });

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

// One manager approval covers the whole batch — each id is still scoped to
// this company and independently checked, so a bad id in the list just gets
// skipped rather than failing the others.
router.post('/transactions/bulk-delete', async (req, res) => {
  const userId = req.session.userId;
  const { ids, manager_name, manager_pin } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No transactions selected' });
  }
  const manager = await verifyManager(userId, manager_name, manager_pin);
  if (!manager) return res.status(403).json({ error: 'Only a manager can delete transactions. Manager name and code did not match.' });

  let deleted = 0;
  for (const id of ids) {
    const ok = await pgDb.deleteTransaction(parseInt(id), userId);
    if (ok) deleted++;
  }
  res.json({ ok: true, deleted, requested: ids.length });
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

  const settings = await pgDb.getSettings(req.session.userId);
  const storeName = settings.store_name || user?.company_name || 'Glow SF';
  const storeAddress = formatStoreAddress(settings);
  const footer = settings.receipt_footer || 'Thank you for your purchase!';
  const tz = settings.timezone || 'America/Los_Angeles';

  const dateStr = new Date(tx.created_at).toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const employeeNames = (tx.employees || []).map(e => e.employee_name).join(', ');

  const itemRows = tx.items.map(i => {
    const discounted = (i.discount || 0) > 0.001;
    const totalCell = discounted
      ? `<span style="text-decoration:line-through;color:#999;font-size:.8em">$${money(i.unit_price * i.quantity)}</span><br>$${money(i.line_total)}`
      : `$${money(i.line_total)}`;
    return `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.product_name}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${money(i.unit_price)}</td>` +
      `<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${totalCell}</td></tr>`;
  }).join('');

  // Payment line(s): single tender shows one line; a split lists each tender.
  const pays = (tx.payments && tx.payments.length) ? tx.payments : [{ method: tx.payment_method, amount: tx.total, card_last4: tx.card_last4 }];
  const payLabel = (p) => `${p.method || ''}${p.card_last4 ? ` ****${p.card_last4}` : ''}`;
  const paymentHtml = pays.length > 1
    ? `<p style="margin-top:16px;font-size:.82rem;color:#6b5057">Payment (split):</p>` +
      pays.map(p => `<p style="margin:2px 0;font-size:.82rem;color:#6b5057;padding-left:12px">${payLabel(p)} — $${money(p.amount)}</p>`).join('')
    : `<p style="margin-top:16px;font-size:.82rem;color:#6b5057">Payment: ${payLabel(pays[0])}</p>`;

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
          <p style="margin:4px 0">Subtotal: <strong>$${money(tx.subtotal)}</strong></p>
          <p style="margin:4px 0">Tax (${parseFloat((tx.tax_rate * 100).toFixed(4))}%): <strong>$${money(tx.tax_amount)}</strong></p>
          <p style="margin:8px 0 0;font-size:1.1rem;color:#9e5567"><strong>Total: $${money(tx.total)}</strong></p>
        </div>
        ${paymentHtml}
      </div>
      <div style="text-align:center;padding:16px 0;border-top:1px solid #e8d5d9;font-size:.8rem;color:#6b5057">
        ${footer}
      </div>
    </div>
  `;

  const subject = req.body.subject || `${tx.type === 'return' ? 'Return' : 'Sales'} Receipt #${tx.receipt_number} | ${storeName}`;
  // A previewed-then-edited body comes back as `html`; otherwise use what we just built.
  const finalHtml = req.body.html || html;

  // Preview: return the generated (or client-edited) email without sending it.
  if (req.body.preview) {
    return res.json({ subject, html: finalHtml });
  }

  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Connect this company\'s Gmail on the Welcome Emails page first.' });
  }

  try {
    await sendGmail(user, email, subject, finalHtml);
    await pgDb.logSentEmail({ user_id: req.session.userId, to_email: email, to_name: tx.customer_name || '', subject, body: finalHtml, kind: 'receipt' });
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

  const subject = req.body.subject || (user?.company_name ? `Welcome to ${user.company_name}!` : 'Welcome!');
  // A previewed-then-edited body comes back as `html`; otherwise use the generated one.
  const finalHtml = req.body.html || emailBody;

  // Preview: return the generated (or client-edited) email without sending it.
  if (req.body.preview) {
    return res.json({ subject, html: finalHtml });
  }

  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Connect this company\'s Gmail on the Welcome Emails page first.' });
  }

  try {
    await sendGmail(user, email, subject, finalHtml);
    await pgDb.logSentEmail({ user_id: userId, to_email: email, to_name: customerName, subject, body: finalHtml, kind: 'welcome' });
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

// ─── Mass Email (to a filtered customer list, sent individually) ────────────

router.post('/mass-email', async (req, res) => {
  const userId = req.session.userId;
  const { recipients, subject, message } = req.body;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients selected.' });
  }
  if (!subject || !subject.trim() || !message || !message.trim()) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }

  const user = await getSendingUser(userId);
  if (!user?.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Connect this company\'s Gmail on the Emails page first.' });
  }

  // De-dupe by email
  const seen = new Set();
  const list = recipients.filter(r => {
    const e = (r.email || '').trim().toLowerCase();
    if (!e || seen.has(e)) return false;
    seen.add(e);
    return true;
  });

  let sent = 0;
  const errors = [];
  for (const r of list) {
    const to = (r.email || '').trim();
    const name = r.name || '';
    const subj = subject.replace(/\{name\}/g, name || 'there');
    const bodyText = message.replace(/\{name\}/g, name || 'there').replace(/\n/g, '<br>');
    const html = `<div style="font-family:Georgia,serif;color:#2c2022;max-width:600px;margin:0 auto;line-height:1.6;font-size:15px">${bodyText}</div>`;
    try {
      await sendGmail(user, to, subj, html);
      await pgDb.logSentEmail({ user_id: userId, to_email: to, to_name: name, subject: subj, body: html, kind: 'campaign' });
      sent++;
    } catch (e) {
      errors.push(`${to}: ${e.message}`);
    }
  }
  res.json({ ok: true, sent, total: list.length, errors: errors.slice(0, 5) });
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

router.get('/reports/day-summary', async (req, res) => {
  const userId = req.session.userId;
  const settings = await pgDb.getSettings(userId);
  const tz = settings.timezone || 'America/Los_Angeles';

  let date = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // en-CA => YYYY-MM-DD
  }

  res.json({ report: await pgDb.getDaySummary(userId, date, tz) });
});

// ─── Employee Personal Report (PIN-protected) ─────────────────────────────

router.post('/reports/employee-personal', async (req, res) => {
  const { name, pin, start, end } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const employee = await pgDb.verifyEmployeePin(pin, req.session.userId);
  if (!employee) return res.status(401).json({ error: 'Invalid name or PIN' });
  if (name && employee.name.trim().toLowerCase() !== String(name).trim().toLowerCase()) {
    return res.status(401).json({ error: 'Invalid name or PIN' });
  }

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

// Never expose the Maverick token to the browser; report only whether it's set.
function sanitizeSettings(s) {
  if (!s) return s;
  const { maverick_token, ...rest } = s;
  return { ...rest, maverick_connected: !!(maverick_token && String(maverick_token).trim()) };
}

router.get('/settings', async (req, res) => {
  res.json({ settings: sanitizeSettings(await pgDb.getSettings(req.session.userId)) });
});

router.post('/settings', async (req, res) => {
  // Ignore an empty maverick_token so saving other settings doesn't wipe it
  const body = { ...req.body };
  if (body.maverick_token !== undefined && !String(body.maverick_token).trim()) {
    delete body.maverick_token;
  }
  await pgDb.updateSettings(req.session.userId, body);
  res.json({ settings: sanitizeSettings(await pgDb.getSettings(req.session.userId)) });
});

// ─── Customer Lookup ───────────────────────────────────────────────────────

router.get('/customers/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ customers: [] });
  const customer = await pgDb.getCustomerByEmail(q, req.session.userId);
  res.json({ customers: customer ? [customer] : [] });
});

// Create-or-update the CRM record for a customer, keyed by email (the same
// key transactions use). Lets the Customers detail view save phone/address/
// notes even for a customer who doesn't have a `customers` row yet.
router.post('/customers/upsert', async (req, res) => {
  const { name, email, phone, birthday, address, notes } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'This customer has no email on file, so there\'s no way to save CRM info for them yet.' });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const customer = await pgDb.findOrCreateCustomer(name, email, req.session.userId, phone);
  await pgDb.updateCustomer(customer.id, { birthday: birthday || null, address: address || '', notes: notes || '' });
  res.json({ customer: await pgDb.getCustomer(customer.id) });
});

// ─── Import transactions from a prior-POS CSV export ────────────────────────

function parseNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[",$\s]/g, ''));
  return isNaN(n) ? 0 : n;
}
function randomPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Accepts already-parsed rows (array of objects with the export's columns).
// Only imports rows whose LOCATION matches the current company, backdated to
// their original date, de-duped by sale code. Creates employees as needed.
router.post('/import-transactions', async (req, res) => {
  const userId = req.session.userId;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'rows array required' });

  const settings = await pgDb.getSettings(userId);
  const storeName = (settings.store_name || '').trim().toLowerCase();
  const tz = settings.timezone || 'America/Los_Angeles';
  if (!storeName) return res.status(400).json({ error: 'Set this company\'s Store Name in Settings first, so imports route to the right company.' });

  const emps = await pgDb.getEmployees(userId);
  const empByName = {};
  for (const e of emps) empByName[e.name.trim().toLowerCase()] = e;

  let imported = 0, skippedOther = 0, skippedDupe = 0, failed = 0;
  const createdEmployees = new Set();

  for (const row of rows) {
    try {
      const location = (row.location || '').trim().toLowerCase();
      if (location !== storeName) { skippedOther++; continue; }

      const receipt = (row.sale_code || '').trim();
      if (!receipt) { skippedOther++; continue; }
      if (await pgDb.receiptExists(receipt, userId)) { skippedDupe++; continue; }

      const isReturn = String(row.type || '').toLowerCase().startsWith('refund') || String(row.type || '').toLowerCase() === 'return';
      const subtotal = Math.abs(parseNum(row.sub_total));
      const tax = Math.abs(parseNum(row.tax));
      const total = Math.abs(parseNum(row.sale_total)) || (subtotal + tax);

      // Payment method from the tender columns
      let payment = 'card';
      if (Math.abs(parseNum(row.credit)) > 0) payment = 'card';
      else if (Math.abs(parseNum(row.cash)) > 0) payment = 'cash';
      else if (Math.abs(parseNum(row.check)) > 0 || Math.abs(parseNum(row.store_credit)) > 0) payment = 'other';

      // Employees (comma-separated names) — match or create
      const names = String(row.associates || '').split(',').map(s => s.trim()).filter(Boolean);
      const empIds = [];
      for (const nm of names) {
        const key = nm.toLowerCase();
        let e = empByName[key];
        if (!e) {
          e = await pgDb.createEmployee(nm, randomPin(), 'sales', 0, userId);
          empByName[key] = e;
          createdEmployees.add(nm);
        }
        empIds.push(e.id);
      }
      const empRecords = empIds.map(id => {
        const pct = Math.round(100 / empIds.length * 100) / 100;
        return { employee_id: id, commission_type: 'percent', commission_value: pct, commission_amount: Math.round(subtotal * pct / 100 * 100) / 100 };
      });

      const items = [{ product_id: 'import', product_name: 'Imported (prior POS)', brand: '', quantity: 1, unit_price: subtotal, discount: 0, line_total: subtotal }];

      await pgDb.importTransaction({
        type: isReturn ? 'return' : 'sale',
        receipt_number: receipt,
        subtotal, tax_amount: tax, total,
        payment_method: payment,
        created_at: (row.date || '').trim(),
        tz,
        customer_name: row.customer || '',
        user_id: userId,
        items, employees: empRecords,
        employee_id: empIds[0] || null,
      });
      imported++;
    } catch (e) {
      failed++;
    }
  }

  res.json({ ok: true, imported, skipped_other_company: skippedOther, skipped_duplicate: skippedDupe, failed, created_employees: [...createdEmployees] });
});

// ─── Maverick Batch Reconciliation ──────────────────────────────────────────

const MAVERICK_BASE = 'https://dashboard.maverickpayments.com';

function numVal(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = parseFloat(v.replace(/[",$\s]/g, '')); return isNaN(n) ? null : n; }
  return null;
}

// Maverick's batch amount field/name isn't fixed in the docs and may be nested,
// so deep-search for the most likely settled-amount field while skipping fee/
// tax/count/card/id fields.
function batchAmount(b) {
  if (!b || typeof b !== 'object') return 0;
  const found = []; // { key, val, depth }
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      const lk = k.toLowerCase();
      const skip = /fee|tax|count|(^|[^a-z])id([^a-z]|$)|bin|number|brand|category|organization|date|name|last4|expir/.test(lk);
      const val = numVal(v);
      if (val != null && !skip) found.push({ k: lk, val, depth });
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(b, 0);
  const pick = (re) => {
    const c = found.filter(f => re.test(f.k)).sort((a, b) => a.depth - b.depth);
    return c.length ? c[0].val : null;
  };
  const v = pick(/netamount|^net$|netsale/) ?? pick(/settled/) ?? pick(/totalamount|^total$|totalsale/) ?? pick(/sale/) ?? pick(/^amount$/) ?? pick(/volume|gross/);
  return v == null ? 0 : v;
}

// Some non-zero codes don't mean the money failed to move — they're advisory
// flags on a transaction that still funded. Code "0238" means the transaction
// was OVER THE MERCHANT'S LIMIT: it settled like any other sale, so it stays in
// the settled total and matches its POS sale (contributing nothing to the
// difference). We only TAG it here so the UI can flag it as an "over limit"
// warning rather than treating it as a problem. Keep this list narrow — only
// add codes confirmed to still settle. Codes are compared with any leading
// zeros stripped, so "0238", "238", and the number 238 all match.
const OVER_LIMIT_CODES = new Set(['238']);
function isOverLimit(b) {
  if (!b || typeof b !== 'object') return false;
  if (b.reject && typeof b.reject === 'object') {
    const code = b.reject.code != null ? String(b.reject.code).trim().replace(/^0+/, '') : '';
    if (code && OVER_LIMIT_CODES.has(code)) return true;
  }
  return false;
}

// Some reject codes are advisory only and don't mean the money failed to
// move — code "0197" is one of these: despite living in the same `reject`
// field as a real decline, it still settles normally. Same rule as
// OVER_LIMIT_CODES: keep this list narrow, only add codes confirmed to
// still fund. Compared with leading zeros stripped.
const BENIGN_REJECT_CODES = new Set(['197']);

// A batch record that didn't actually go through must be excluded from the
// settled total. Maverick flags these with a `reject` object carrying a
// non-zero code. A rejected/declined transaction did not fund — this is true
// whether it's a SALE (debit) or a REFUND (credit), so we exclude any record
// with a real reject code (or a declined/rejected status) regardless of
// type — except the benign/over-limit codes above, which still funded.
// Excluded records are surfaced separately as "did not settle" so they
// aren't silently dropped.
function isRejected(b) {
  if (!b || typeof b !== 'object') return false;
  if (isOverLimit(b)) return false; // over-limit still funded — not a failure

  if (b.reject && typeof b.reject === 'object') {
    const code = b.reject.code != null ? String(b.reject.code).trim() : '';
    if (code && BENIGN_REJECT_CODES.has(code.replace(/^0+/, ''))) return false;
    const hasReject = code !== '' && !/^0+$/.test(code); // non-zero reject code
    if (hasReject) return true;
  }

  // An explicit declined/rejected status also excludes (any type).
  const st = b.status;
  const stStr = (st && typeof st === 'object') ? String(st.status || '') : String(st || '');
  if (/declin|reject/i.test(stStr)) return true;
  return false;
}

function batchCount(b) {
  const keys = ['count', 'transactionCount', 'totalCount', 'transactions', 'itemCount', 'salesCount'];
  for (const k of keys) {
    const v = b && b[k];
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v.length;
  }
  return null;
}

// List the DBAs available to the saved token, so the user can pick the right
// dbaId for the reporting endpoints instead of guessing.
router.get('/maverick/dbas', async (req, res) => {
  const settings = await pgDb.getSettings(req.session.userId);
  const token = (settings.maverick_token || '').trim();
  if (!token) return res.status(400).json({ error: 'Save your Maverick access token first.' });
  try {
    const resp = await fetch(`${MAVERICK_BASE}/api/dba`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = null; }
    if (!resp.ok) return res.status(502).json({ error: (data && (data.message || data.name)) || `Maverick returned ${resp.status}` });
    const items = Array.isArray(data) ? data : (data?.items || []);
    res.json({ dbas: items.map(d => ({ id: d.id, name: d.name })) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/reconciliation', async (req, res) => {
  const userId = req.session.userId;
  const settings = await pgDb.getSettings(userId);
  const dbaId = (settings.maverick_dba_id || '').trim();
  const token = (settings.maverick_token || '').trim();
  const tz = settings.timezone || 'America/Los_Angeles';

  if (!dbaId || !token) {
    return res.json({ configured: false });
  }

  // Date to reconcile (YYYY-MM-DD); default today in the store timezone
  let date = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // en-CA => YYYY-MM-DD
  }

  // POS side: card sales recorded for that day
  const pos = await pgDb.getCardSalesForDate(userId, date, tz);

  // Maverick side: batches settled on that date
  const url = `${MAVERICK_BASE}/api/reporting/batches/${encodeURIComponent(dbaId)}?filter[date][gte]=${date}&filter[date][lte]=${date}`;
  let batches = [];
  let maverickError = null;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    if (!resp.ok) {
      maverickError = (data && (data.message || data.name)) || `Maverick API returned ${resp.status}`;
    } else {
      batches = Array.isArray(data) ? data : (data?.items || data?.batches || []);
    }
  } catch (e) {
    maverickError = e.message;
  }

  if (maverickError) {
    return res.json({ configured: true, date, pos, maverick: null, error: maverickError });
  }

  const maverickTotal = batches.reduce((s, b) => s + batchAmount(b), 0);
  const batchList = batches.map(b => ({
    id: b.id ?? b.batchId ?? null,
    date: b.date ?? b.batchedOn ?? b.batchDate ?? date,
    amount: batchAmount(b),
    count: batchCount(b),
    brand: b.card?.bin?.brand ?? b.brand ?? null,
  }));

  const posNet = pos.net_total;
  const difference = Math.round((maverickTotal - posNet) * 100) / 100;

  res.json({
    configured: true,
    date,
    pos,
    maverick: {
      batch_count: batches.length,
      total: Math.round(maverickTotal * 100) / 100,
      batches: batchList,
    },
    difference,
    matched: Math.abs(difference) < 0.01,
  });
});

// Date-range audit: compares each day's Maverick settled total to the POS's
// recorded card sales, and explains any day that doesn't match.
function batchDateOf(b, fallback) {
  if (!b || typeof b !== 'object') return fallback;
  const norm = (v) => { const m = v == null ? null : String(v).match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; };
  const direct = norm(b.date || b.batchedOn || b.batchDate || b.createdOn || b.settledOn || b.processingDate || b.closedOn);
  if (direct) return direct;
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return null;
    for (const [k, v] of Object.entries(o)) {
      if (/date|batched|settled|created|closed|process/i.test(k)) { const n = norm(v); if (n) return n; }
    }
    for (const v of Object.values(o)) { if (v && typeof v === 'object') { const n = walk(v, depth + 1); if (n) return n; } }
    return null;
  };
  return walk(b, 0) || fallback;
}

async function fetchMaverickBatches(dbaId, from, to, token) {
  // Maverick filters batches by the settlement field "batch.date" (per the docs
  // note). Omit it when from/to are null (then it returns the last 5 days).
  // Results are paginated at 50/page — follow every page so nothing is dropped.
  const dateFilter = (from && to) ? `filter[batch.date][gte]=${from}&filter[batch.date][lte]=${to}&` : '';
  const base = `${MAVERICK_BASE}/api/reporting/batches/${encodeURIComponent(dbaId)}?${dateFilter}per-page=50`;

  const all = [];
  let lastData = null;
  const MAX_PAGES = 60; // safety cap (3000 records)
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetch(`${base}&page=${page}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = null; }
    if (!resp.ok) {
      return {
        ok: false, status: resp.status, batches: [], raw: data,
        error: (data && (data.message || data.name)) || `Maverick returned ${resp.status}`,
      };
    }
    lastData = data;
    const items = Array.isArray(data) ? data : (data?.items || data?.batches || []);
    all.push(...items);
    const pageCount = Number(data?._meta?.pageCount) || 1;
    if (items.length === 0 || page >= pageCount) break;
  }

  // Maverick's paginated/date-filtered results can include the exact same
  // settled transaction more than once (e.g. a request whose date window
  // lands on a page/batch boundary), which silently double-counts real
  // money in the day totals. Each record carries Maverick's own unique
  // transaction id — dedupe on that (never on amount/card/date, which can
  // legitimately repeat for two separate real transactions, e.g. two
  // identical service prices charged to different cards the same day).
  const seen = new Set();
  const batches = [];
  for (const b of all) {
    const key = b && (b.id ?? b.referenceNumber);
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    batches.push(b);
  }

  return { ok: true, status: 200, batches, raw: lastData, error: null };
}

// Maverick's coarse `filter[batch.date]` range query has been observed to
// return records with the WRONG date and even the wrong debit/credit type
// once the requested window spans more than the batch(es) actually being
// asked about (confirmed via its own raw response — a single-day query
// returned another day's refund and sale, one with its type flipped). A
// day-centered window matching exactly what's requested does not show this
// corruption, so every per-day total — whether for one day or across a
// whole report range — must be built from its OWN day-centered fetch,
// never sliced out of one wide multi-day fetch.
const DAY_WINDOW = 3;
const dayShift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Settled (and failed) records that genuinely belong to one calendar day.
async function fetchMerchantDay(dbaId, day, token) {
  const r = await fetchMaverickBatches(dbaId, dayShift(day, -DAY_WINDOW), dayShift(day, DAY_WINDOW), token);
  if (!r.ok) return { ok: false, error: r.error, records: [], failed: [] };
  const sameDay = r.batches.filter(b => batchDateOf(b, day) === day);
  return { ok: true, records: sameDay.filter(b => !isRejected(b)), failed: sameDay.filter(b => isRejected(b)) };
}

// Run `fn` over `items` with at most `limit` in flight at once — a report
// spanning up to 30 days means up to 30 Maverick round trips, so this keeps
// us from either serializing them one at a time or firing all 30 at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// The reporting API keys off the DBA id, but the dashboard shows a merchant
// account id — resolve the real DBA id by matching the company's store name.
async function resolveDbaByName(token, storeName) {
  try {
    const resp = await fetch(`${MAVERICK_BASE}/api/dba`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const items = Array.isArray(data) ? data : (data?.items || []);
    if (!items.length) return null;
    const nm = (storeName || '').trim().toLowerCase();
    const match = items.find(d => (d.name || '').trim().toLowerCase() === nm) || (items.length === 1 ? items[0] : null);
    return match ? String(match.id) : null;
  } catch (_) {
    return null;
  }
}

router.get('/reconciliation-audit', async (req, res) => {
  const userId = req.session.userId;
  const settings = await pgDb.getSettings(userId);
  const dbaId = (settings.maverick_dba_id || '').trim();
  const token = (settings.maverick_token || '').trim();
  const tz = settings.timezone || 'America/Los_Angeles';
  if (!dbaId || !token) return res.json({ configured: false });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  let from = (req.query.from || '').trim();
  let to = (req.query.to || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const d = new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6);
    from = d.toISOString().slice(0, 10);
  }
  // Maverick caps the batch date filter at 30 days
  if ((new Date(to) - new Date(from)) / 86400000 > 30) {
    const d = new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 30);
    from = d.toISOString().slice(0, 10);
  }

  // Resolve/validate the DBA id with the same range fetch as before, and
  // surface auth/connection errors up front. Its data is NOT used for the
  // day totals below — see fetchMerchantDay's comment for why a single wide
  // fetch can't be trusted for that.
  let usedDbaId = dbaId;
  try {
    let r = await fetchMaverickBatches(dbaId, from, to, token);
    // If the configured id isn't accessible (e.g. it's a merchant id, not the
    // DBA id), resolve the real DBA id by store name and retry once.
    if (!r.ok && (r.status === 403 || /not allowed|forbidden|not found/i.test(r.error || ''))) {
      const realId = await resolveDbaByName(token, settings.store_name);
      if (realId && realId !== dbaId) {
        const r2 = await fetchMaverickBatches(realId, from, to, token);
        if (r2.ok) {
          usedDbaId = realId;
          await pgDb.updateSettings(userId, { maverick_dba_id: realId }); // persist the correction
          r = r2;
        }
      }
    }
    if (!r.ok) return res.json({ configured: true, from, to, error: r.error });
  } catch (e) {
    return res.json({ configured: true, from, to, error: e.message });
  }

  // Each day in the range gets its own day-centered fetch (fetchMerchantDay),
  // run with limited concurrency since a 30-day report means up to 30
  // Maverick round trips.
  const allDays = [];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    allDays.push(d.toISOString().slice(0, 10));
  }
  const dayResults = await mapWithConcurrency(allDays, 5, day => fetchMerchantDay(usedDbaId, day, token));

  // Each record is a settled transaction: { amount, type: 'debit'|'credit', date,
  // batch: { id, date } }. A 'credit' is a refund back to the cardholder, so it
  // subtracts from the merchant's net settled amount. Any record carrying a
  // non-zero reject code (a declined sale or a refund that didn't fund) never
  // settled, so it is excluded from the total and tracked in failedRecords so it
  // can be surfaced as "caught, did not settle" (see isRejected).
  const merchantByDate = {};
  const failedRecords = [];
  const overLimitRecords = [];
  let sampleRecord = null;
  let totalRawCount = 0;
  for (let i = 0; i < allDays.length; i++) {
    const day = allDays[i];
    const dayResult = dayResults[i];
    if (!dayResult.ok) continue; // best-effort — one bad day shouldn't kill the whole report
    totalRawCount += dayResult.records.length + dayResult.failed.length;
    if (!sampleRecord) sampleRecord = dayResult.records[0] || dayResult.failed[0] || null;
    if (!merchantByDate[day]) merchantByDate[day] = { total: 0, sales: 0, credits: 0, sale_count: 0, credit_count: 0, failed: 0, failed_amount: 0, over_limit: 0, over_limit_amount: 0, txns: 0, batchIds: new Set() };

    for (const b of dayResult.failed) {
      const type = String(b.type || '').toLowerCase();
      const mag = Math.abs(batchAmount(b));
      const isCredit = /credit|refund|return|void|reversal/.test(type);
      const signed = isCredit ? -mag : mag;
      merchantByDate[day].failed += 1;
      merchantByDate[day].failed_amount += signed;
      failedRecords.push({ date: day, amount: signed, type, last4: last4Of(b.card?.number), batch_id: b.batch?.id || null, reject: b.reject || null });
    }

    for (const b of dayResult.records) {
      const type = String(b.type || '').toLowerCase();
      const mag = Math.abs(batchAmount(b));
      const isCredit = /credit|refund|return|void|reversal/.test(type);
      const signed = isCredit ? -mag : mag;

      // An over-limit transaction (code 0238) DID fund, so it belongs in the
      // settled total and matches its POS sale like any other — it contributes
      // nothing to the difference. We only TAG it so the UI can flag it as an
      // "over limit" warning instead of it reading as a problem.
      if (isOverLimit(b)) {
        merchantByDate[day].over_limit += 1;
        merchantByDate[day].over_limit_amount += signed;
        overLimitRecords.push({ date: day, amount: signed, type, last4: last4Of(b.card?.number), batch_id: b.batch?.id || null, reject: b.reject || null });
      }

      merchantByDate[day].total += signed;
      if (isCredit) { merchantByDate[day].credits += mag; merchantByDate[day].credit_count += 1; }
      else { merchantByDate[day].sales += mag; merchantByDate[day].sale_count += 1; }
      merchantByDate[day].txns += 1;
      if (b.batch && b.batch.id) merchantByDate[day].batchIds.add(b.batch.id);
    }
  }

  // POS side
  const posDays = await pgDb.getCardSalesByDateRange(userId, from, to, tz);
  const posByDate = {};
  for (const p of posDays) posByDate[p.date] = p;

  const allDates = [...new Set([...Object.keys(merchantByDate), ...Object.keys(posByDate)])].sort();
  const days = allDates.map(d => {
    const m = merchantByDate[d]?.total || 0;
    const p = posByDate[d]?.net_total || 0;
    const diff = Math.round((m - p) * 100) / 100;
    const matched = Math.abs(diff) < 0.01;
    const failed = merchantByDate[d]?.failed || 0;
    const overLimit = merchantByDate[d]?.over_limit || 0;
    let explanation = '';
    if (!matched) {
      explanation = diff > 0
        ? `Merchant settled $${money(diff)} MORE than the POS recorded — a card sale was likely processed on the terminal but not entered in the POS.`
        : `POS recorded $${money(Math.abs(diff))} MORE than the merchant settled — a POS card sale may not have batched/settled yet, or a terminal charge was voided/declined.`;
    }
    if (overLimit) {
      explanation = (explanation ? explanation + ' ' : '') + `${overLimit} over-limit transaction${overLimit === 1 ? '' : 's'} at the merchant (code 0238 — over the limit but funded; counted normally, flagged for awareness).`;
    }
    if (failed) {
      explanation = (explanation ? explanation + ' ' : '') + `${failed} failed/rejected transaction${failed === 1 ? '' : 's'} at the merchant (did not settle — excluded).`;
    }
    return {
      date: d,
      merchant_total: Math.round(m * 100) / 100,
      merchant_sales: Math.round((merchantByDate[d]?.sales || 0) * 100) / 100,
      merchant_credits: Math.round((merchantByDate[d]?.credits || 0) * 100) / 100,
      merchant_sale_count: merchantByDate[d]?.sale_count || 0,
      merchant_credit_count: merchantByDate[d]?.credit_count || 0,
      merchant_failed: merchantByDate[d]?.failed || 0,
      merchant_failed_amount: Math.round((merchantByDate[d]?.failed_amount || 0) * 100) / 100,
      merchant_over_limit: merchantByDate[d]?.over_limit || 0,
      merchant_over_limit_amount: Math.round((merchantByDate[d]?.over_limit_amount || 0) * 100) / 100,
      merchant_batches: merchantByDate[d]?.batchIds?.size || 0,
      merchant_txns: merchantByDate[d]?.txns || 0,
      pos_total: Math.round(p * 100) / 100,
      pos_sales: Math.round((posByDate[d]?.sales_total || 0) * 100) / 100,
      pos_returns: Math.round((posByDate[d]?.returns_total || 0) * 100) / 100,
      pos_sale_count: posByDate[d]?.sale_count || 0,
      pos_return_count: posByDate[d]?.return_count || 0,
      difference: diff,
      matched,
      explanation,
    };
  });

  const totals = days.reduce((a, d) => {
    a.merchant += d.merchant_total; a.pos += d.pos_total;
    a.merchant_sales += d.merchant_sales; a.merchant_credits += d.merchant_credits;
    a.pos_sales += d.pos_sales; a.pos_returns += d.pos_returns;
    if (!d.matched) a.mismatches += 1;
    return a;
  }, { merchant: 0, pos: 0, merchant_sales: 0, merchant_credits: 0, pos_sales: 0, pos_returns: 0, mismatches: 0 });
  totals.merchant = Math.round(totals.merchant * 100) / 100;
  totals.pos = Math.round(totals.pos * 100) / 100;
  totals.merchant_sales = Math.round(totals.merchant_sales * 100) / 100;
  totals.merchant_credits = Math.round(totals.merchant_credits * 100) / 100;
  totals.pos_sales = Math.round(totals.pos_sales * 100) / 100;
  totals.pos_returns = Math.round(totals.pos_returns * 100) / 100;
  totals.difference = Math.round((totals.merchant - totals.pos) * 100) / 100;
  totals.failed_count = failedRecords.length;
  totals.failed_amount = Math.round(failedRecords.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  totals.over_limit_count = overLimitRecords.length;
  totals.over_limit_amount = Math.round(overLimitRecords.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  // Diagnostic: raw record count + a sample object, so we can map Maverick's
  // actual amount field if the totals look wrong.
  const debug = {
    batch_count: totalRawCount,
    sample: sampleRecord,
  };

  // If the selected range has no records at all, probe recent batches (last
  // 5 days) to distinguish "wrong dates" from "no connection / no batches".
  if (totalRawCount === 0) {
    try {
      const probe = await fetchMaverickBatches(usedDbaId, null, null, token);
      if (probe.ok) {
        debug.recent_batch_count = probe.batches.length;
        debug.recent_sample = probe.batches[0] || null;
        const dates = probe.batches.map(b => batchDateOf(b, null)).filter(Boolean).sort();
        debug.recent_batch_dates = [...new Set(dates)];
      }
    } catch (_) { /* best effort */ }
  }

  res.json({ configured: true, from, to, days, totals, dba_id: usedDbaId, _debug: debug });
});

function last4Of(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.slice(-4);
}

// Drill-down for a single day: match the merchant's settled transactions to the
// POS's card transactions, so mismatches can be traced to specific records.
router.get('/reconciliation-day', async (req, res) => {
  const userId = req.session.userId;
  const settings = await pgDb.getSettings(userId);
  const dbaId = (settings.maverick_dba_id || '').trim();
  const token = (settings.maverick_token || '').trim();
  const tz = settings.timezone || 'America/Los_Angeles';
  if (!dbaId || !token) return res.json({ configured: false });

  const date = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) required' });

  // Fetch merchant settlements for a window around the day, so a charge that
  // settled a bit late (sales next-day, refunds often 2-3 days) still matches.
  let batches = [];
  try {
    const r = await fetchMaverickBatches(dbaId, dayShift(date, -DAY_WINDOW), dayShift(date, DAY_WINDOW), token);
    if (!r.ok) return res.json({ configured: true, date, error: r.error });
    batches = r.batches;
  } catch (e) {
    return res.json({ configured: true, date, error: e.message });
  }

  const toMerch = (b) => {
    const type = String(b.type || '').toLowerCase();
    const isCredit = /credit|refund|return|void|reversal/.test(type);
    return {
      amount: Math.abs(batchAmount(b)),
      dir: isCredit ? 'credit' : 'debit',
      last4: last4Of(b.card?.number),
      batch_id: b.batch?.id || null,
      brand: b.card?.bin?.brand || null,
      bdate: batchDateOf(b, date),
      failed: isRejected(b),
      over_limit: isOverLimit(b),
      reject: b.reject || null,
      matched: false,
    };
  };
  const merchAllRaw = batches.map(toMerch);
  // Failed/rejected records aren't in the settled batch total, so keep them out
  // of the matching pool. Over-limit (0238) records DID fund, so they stay in
  // the pool and match their POS sale like any other — we just list them
  // separately as well, so they can be flagged as "over limit".
  const merchAll = merchAllRaw.filter(m => !m.failed);
  const failedMerchant = merchAllRaw.filter(m => m.failed && m.bdate === date);
  const overLimitMerchant = merchAllRaw.filter(m => m.over_limit && m.bdate === date);
  const merchDay = merchAll.filter(m => m.bdate === date);
  const merchAdj = merchAll.filter(m => m.bdate !== date);

  const posRows = await pgDb.getCardTransactionsForDate(userId, date, tz);
  const pos = posRows.map(t => ({
    id: t.id,
    amount: Math.abs(Number(t.total) || 0),
    dir: t.type === 'return' ? 'credit' : 'debit',
    last4: last4Of(t.card_last4),
    receipt: t.receipt_number,
    customer: t.customer_name || '',
    employees: t.employee_names || '',
    type: t.type,
    matched: false,
  }));

  const TOL = 1.00; // $ tolerance for tax/rounding differences
  // If both sides have a recorded card number, it must match — a confirmed
  // different last-4 disqualifies the pair. If either side has no last-4 on
  // file (e.g. an imported transaction that never captured one), fall back
  // to amount+direction only, since there's nothing to check against.
  const cardOk = (p, m) => !p.last4 || !m.last4 || p.last4 === m.last4;

  // One-to-one exact/near match: same direction, amount within tolerance,
  // preferring a confirmed same-card candidate over an unknown-card one.
  const matchOne = (poolPos, poolMerch) => {
    for (const p of poolPos) {
      if (p.matched) continue;
      const cands = poolMerch.filter(m => !m.matched && m.dir === p.dir && Math.abs(m.amount - p.amount) <= TOL && cardOk(p, m));
      if (!cands.length) continue;
      const m = cands.find(c => p.last4 && c.last4 && c.last4 === p.last4) || cands[0];
      m.matched = true; p.matched = true; p.matched_date = m.bdate;
    }
  };
  // Split funding: one item equals the sum of 2-4 items on the other side, all on the same card.
  const findSubset = (candidates, target) => {
    const items = candidates.filter(x => !x.matched).sort((a, b) => b.amount - a.amount);
    if (items.length > 60) return null; // perf guard
    const dfs = (start, chosen, s) => {
      if (chosen.length >= 2 && Math.abs(s - target) <= TOL) return chosen.slice();
      if (chosen.length >= 4 || s - TOL > target) return null;
      for (let i = start; i < items.length; i++) {
        chosen.push(items[i]);
        const r = dfs(i + 1, chosen, s + items[i].amount);
        chosen.pop();
        if (r) return r;
      }
      return null;
    };
    return dfs(0, [], 0);
  };
  const matchSplit = (poolPos, poolMerch) => {
    for (const p of poolPos) {
      if (p.matched) continue;
      const combo = findSubset(poolMerch.filter(m => m.dir === p.dir && cardOk(p, m)), p.amount);
      if (combo) {
        combo.forEach(m => m.matched = true);
        p.matched = true;
        p.matched_date = [...new Set(combo.map(m => m.bdate))].join(', ');
      }
    }
    for (const m of poolMerch) {
      if (m.matched) continue;
      const combo = findSubset(poolPos.filter(p => p.dir === m.dir && cardOk(p, m)), m.amount);
      if (combo) { combo.forEach(p => { p.matched = true; p.matched_date = m.bdate; }); m.matched = true; }
    }
  };

  // Pass A: match against the same day's merchant settlements.
  matchOne(pos, merchDay);
  matchSplit(pos, merchDay);
  // Pass B: remaining POS against ±1 day (settlement cutoff timing). Tag
  // anything that only matches here so the UI can show it settled on a
  // different day instead of today's merchant batch — otherwise it reads
  // as a plain "matched" row even though it explains the day's totals not
  // adding up.
  const matchedAfterSameDay = new Set(pos.filter(p => p.matched));
  matchOne(pos, merchAdj);
  matchSplit(pos, merchAdj);
  for (const p of pos) {
    if (p.matched && !matchedAfterSameDay.has(p)) p.settled_adjacent_day = true;
  }

  // Pass C: a sale and a refund that both settled at the merchant for the same
  // amount but were never rung up in the POS at all (e.g. a customer bought
  // something and returned it right away, so staff didn't bother entering
  // either leg). They cancel each other out — $0 net effect on the day's
  // total — so pair them off instead of leaving both as alarming "unmatched"
  // rows. Only within the same day; a multi-day gap is left as a real
  // mismatch since that's not the "right away" pattern this covers.
  const offsetMerchant = [];
  for (const m of merchDay) {
    if (m.matched) continue;
    const wantDir = m.dir === 'credit' ? 'debit' : 'credit';
    const cands = merchDay.filter(x => !x.matched && x !== m && x.dir === wantDir && Math.abs(x.amount - m.amount) <= TOL && cardOk(x, m));
    if (!cands.length) continue;
    const pair = cands.find(c => c.last4 && m.last4 && c.last4 === m.last4) || cands[0];
    m.matched = true; m.offset = true;
    pair.matched = true; pair.offset = true;
    offsetMerchant.push(m, pair);
  }

  const unmatchedPos = pos.filter(p => !p.matched);
  const unmatchedMerchant = merchDay.filter(m => !m.matched); // only same-day merchant counts as "settled but not in POS"
  const settledAdjacent = merchAdj.filter(m => m.matched).length; // matched, but settled a day off

  const sum = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;
  res.json({
    configured: true,
    date,
    matched_count: pos.filter(p => p.matched).length,
    settled_adjacent_day: settledAdjacent,
    unmatched_pos: unmatchedPos,
    unmatched_merchant: unmatchedMerchant,
    unmatched_pos_total: sum(unmatchedPos, p => p.dir === 'credit' ? -p.amount : p.amount),
    unmatched_merchant_total: sum(unmatchedMerchant, m => m.dir === 'credit' ? -m.amount : m.amount),
    // Full per-transaction lists (with match status) so every individual
    // transaction can be confirmed, not just the mismatches.
    all_pos: pos,
    all_merchant_day: merchDay,
    failed_merchant: failedMerchant,
    over_limit_merchant: overLimitMerchant,
    offset_merchant: offsetMerchant,
    pos_sales_total: sum(pos.filter(p => p.dir === 'debit'), p => p.amount),
    pos_credits_total: sum(pos.filter(p => p.dir === 'credit'), p => p.amount),
    merchant_sales_total: sum(merchDay.filter(m => m.dir === 'debit'), m => m.amount),
    merchant_credits_total: sum(merchDay.filter(m => m.dir === 'credit'), m => m.amount),
    raw_merchant: batches.filter(b => batchDateOf(b, date) === date),
  });
});

module.exports = router;
