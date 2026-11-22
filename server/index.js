require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const store = require('./store');
const metrics = require('./metrics');

const app = express();
const PORT = process.env.PORT || 5050;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required.');
const TOKEN_TTL = '12h';

// API health/root response (keep this before static middleware).
app.get('/', (req, res) => {
  res.status(200).send('FoodFlow Backend is Running Successfully!');
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
  }
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const publicUser = (u) => {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
};

function sign(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await store.get('users', payload.sub);
    if (!user) return res.status(401).json({ error: 'Session no longer valid' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

const allow = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Your role cannot perform this action' });
  next();
};

function scoped(user, data) {
  if (user.role === 'salesman') {
    return {
      ...data,
      orders: data.orders.filter((o) => o.salesmanId === user.id),
      invoices: data.invoices.filter((i) => i.salesmanId === user.id)
    };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body || {};
    const validRoles = ['salesman']; // Privileged roles are provisioned by an owner, never self-selected.
    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ error: 'Please complete all required fields.' });
    }
    if (!validRoles.includes(role)) return res.status(403).json({ error: 'Self-registration is limited to Salesman accounts. Ask an Owner to create privileged accounts.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' });
    const users = await store.list('users');
    const normalizedUsername = String(username).trim().toLowerCase();
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Username must be 3–30 characters (letters, numbers, dot, underscore or hyphen).' });
    }
    if (users.some(u => String(u.username || '').toLowerCase() === normalizedUsername || String(u.email || '').toLowerCase() === normalizedEmail)) {
      return res.status(409).json({ error: 'That username or email is already registered.' });
    }
    const titles = {
      salesman: 'Sales Executive', admin: 'Administrator',
      production: 'Production Supervisor', accountant: 'Accounts Executive', owner: 'Owner'
    };
    const nameClean = String(name).trim();
    const user = {
      id: await store.nextSequence('users', 'u-', 5),
      username: normalizedUsername,
      email: normalizedEmail,
      name: nameClean,
      role,
      title: titles[role],
      region: 'Not specified',
      initials: nameClean.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(),
      passwordHash: bcrypt.hashSync(password, 12),
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    await store.insert('users', user);
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Unable to create account right now.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const users = await store.list('users');
  const user = users.find(
    (u) => String(u.username || '').toLowerCase() === String(username).trim().toLowerCase() || String(u.email || '').toLowerCase() === String(username).trim().toLowerCase()
  );
  if (!user) return res.status(401).json({ error: 'No account found with those credentials' });
  if (!bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'Incorrect password. Please try again.' });
  if (role && role !== user.role) {
    return res.status(403).json({ error: `This account is registered as ${user.role}. Please select the correct role.` });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'This account has been deactivated' });

  await store.update('users', user.id, { lastLogin: new Date().toISOString() });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/setup-owner', async (req, res) => {
  try {
    const setupKey = process.env.OWNER_SETUP_KEY;
    if (!setupKey || req.headers['x-owner-setup-key'] !== setupKey) return res.status(403).json({ error: 'Valid owner setup key required.' });
    if ((await store.list('users')).some(u => u.role === 'owner')) return res.status(409).json({ error: 'An Owner account already exists.' });
    const { name, username, email, password } = req.body || {};
    if (!name || !username || !email || !password || String(password).length < 12) return res.status(400).json({ error: 'Name, username, email and a password of at least 12 characters are required.' });
    const normalizedUsername = String(username).trim().toLowerCase(), normalizedEmail = String(email).trim().toLowerCase();
    const users = await store.list('users');
    if (users.some(u => u.username === normalizedUsername || u.email === normalizedEmail)) return res.status(409).json({ error: 'Username or email already exists.' });
    const cleanName = String(name).trim();
    const user = { id: await store.nextSequence('users','u-',5), username: normalizedUsername, email: normalizedEmail, name: cleanName, role: 'owner', title: 'Owner', region: '', initials: cleanName.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(), passwordHash: bcrypt.hashSync(password,12), status: 'active', createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
    await store.insert('users', user);
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch (e) { console.error('[auth/setup-owner]', e); res.status(500).json({ error: 'Unable to create owner account.' }); }
});


/* ------------------------------------------------------------------ */
/* Bootstrap — one payload for the whole dashboard shell               */
/* ------------------------------------------------------------------ */
app.get('/api/bootstrap', requireAuth, async (req, res) => {
  const [users, products, orders, inventory, batches, audits, invoices, activity, boms, purchases, stockMovements, payments] = await Promise.all([
    store.list('users'), store.list('products'), store.list('orders'), store.list('inventory'),
    store.list('batches'), store.list('audits'), store.list('invoices'), store.list('activity'),
    store.list('boms'), store.list('purchases'), store.list('stockMovements'), store.list('payments')
  ]);

  const data = scoped(req.user, { users: users.map(publicUser), products, orders, inventory, batches, audits, invoices, activity, boms, purchases, stockMovements, payments });
  const kpis = metrics.computeKpis(data.orders, data.inventory, data.batches, data.audits, data.invoices);

  res.json({
    user: publicUser(req.user),
    storeMode: store.mode,
    asOf: new Date().toISOString(),
    kpis,
    monthly: metrics.buildMonthlySeries(data.orders),
    statusBreakdown: metrics.statusBreakdown(data.orders),
    categoryMix: metrics.categoryMix(data.orders, products),
    topProducts: metrics.topProducts(data.orders, products),
    regionSales: metrics.regionSales(data.orders),
    productionTrend: metrics.productionTrend(data.batches),
    notifications: metrics.notifications(data.orders, data.inventory, data.batches, data.audits, data.invoices),
    ...data
  });
});

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */
app.get('/api/orders', requireAuth, async (req, res) => {
  const { status, q, salesmanId } = req.query;
  let rows = await store.list('orders');
  if (req.user.role === 'salesman') rows = rows.filter((o) => o.salesmanId === req.user.id);
  if (status && status !== 'all') rows = rows.filter((o) => o.status === status);
  if (salesmanId) rows = rows.filter((o) => o.salesmanId === salesmanId);
  if (q) {
    const term = String(q).toLowerCase();
    rows = rows.filter((o) => o.orderNo.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term) || o.city.toLowerCase().includes(term));
  }
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders: rows });
});

app.post('/api/orders', requireAuth, allow('salesman', 'admin', 'owner'), async (req, res) => {
  const { customer, city, region, items, priority, notes, dueDate } = req.body || {};
  if (!customer || !String(city || '').trim() || !String(region || '').trim() || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer, city, region and at least one line item are required' });
  }
  const products = await store.list('products');
  if (items.some(it => !Number.isInteger(Number(it.qty)) || Number(it.qty) <= 0)) return res.status(400).json({ error: 'Every order quantity must be a positive whole number.' });
  if (items.some(it => !products.some(p => p.id === it.productId))) return res.status(400).json({ error: 'One or more selected products do not exist.' });
  const priced = items.map((it) => {
    const product = products.find((p) => p.id === it.productId);
    if (!product) return null;
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Quantity for ${product.name} must be a positive whole number.`);
    return { productId: product.id, sku: product.sku, name: product.name, qty, unitPrice: product.price, lineTotal: Math.round(qty * product.price * 100) / 100 };
  });
  const subtotal = Math.round(priced.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
  const taxRate = priced.reduce((sum, item) => { const p = products.find(x => x.id === item.productId); return sum + (Number(p.gst) || 0) * item.lineTotal; }, 0) / Math.max(subtotal, 1);
  const tax = Math.round(subtotal * taxRate / 100 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const seq = (await store.nextSequence('orders', 'FF-2026-', 4)).replace('FF-2026-', '');
  const due = dueDate || null;

  const order = {
    id: await store.nextSequence('orders', 'o-'),
    orderNo: `FF-${new Date().getFullYear()}-${String(Number(seq)).padStart(4, '0')}`, 
    customer,
    customerType: req.body.customerType || '',
    city: String(city || '').trim(),
    region: String(region || '').trim(),
    salesmanId: req.user.role === 'salesman' ? req.user.id : (req.body.salesmanId || req.user.id),
    items: priced,
    subtotal, tax, total,
    status: 'pending',
    priority: priority || 'normal',
    payment: 'pending',
    createdAt: new Date().toISOString(),
    dueDate: due,
    notes: notes || ''
  };
  await store.insert('orders', order);
  await store.insert('activity', {
    id: await store.nextSequence('activity', 'act-'),
    type: 'order',
    text: `Order ${order.orderNo} created for ${order.customer}`,
    at: order.createdAt,
    actor: req.user.name
  });
  res.status(201).json({ order });
});

app.patch('/api/orders/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  const valid = ['pending', 'confirmed', 'in_production', 'packed', 'dispatched', 'delivered', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid order status' });
  if (['confirmed', 'dispatched'].includes(status)) return res.status(400).json({ error: 'Use the dedicated approval or dispatch action so stock and invoices remain consistent.' });
  if (status === 'delivered' && req.user.role !== 'admin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only Admin or Owner can mark delivery.' });
  const order = await store.get('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!['admin','owner','production'].includes(req.user.role)) return res.status(403).json({ error: 'Only operations roles can update order status.' });
  const updated = await store.update('orders', order.id, { status });
  await store.insert('activity', {
    id: await store.nextSequence('activity', 'act-'),
    type: 'order',
    text: `${order.orderNo} moved to ${status.replace(/_/g, ' ')}`,
    at: new Date().toISOString(),
    actor: req.user.name
  });
  res.json({ order: updated });
});

/* ------------------------------------------------------------------ */
/* Production                                                          */
/* ------------------------------------------------------------------ */
app.patch('/api/batches/:id', requireAuth, allow('production', 'admin', 'owner'), async (req, res) => {
  const batch = await store.get('batches', req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const allowed = ['status', 'actualQty', 'wastageQty', 'qcStatus', 'endDate'];
  if (req.body.status === 'completed') return res.status(400).json({ error: 'Use the production completion endpoint so BOM consumption and stock movements are recorded.' });
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (patch.actualQty !== undefined && patch.plannedQty === undefined) {
    patch.variancePct = Math.round(((patch.actualQty - batch.plannedQty) / batch.plannedQty) * 10000) / 100;
    patch.yieldPct = Math.round((patch.actualQty / batch.plannedQty) * 1000) / 10;
  }
  if (patch.status === 'completed' && !batch.endDate) patch.endDate = new Date().toISOString();
  const updated = await store.update('batches', batch.id, patch);
  res.json({ batch: updated });
});

app.post('/api/batches', requireAuth, allow('production', 'admin', 'owner'), async (req, res) => {
  const { productId, plannedQty, line, shift, supervisor } = req.body || {};
  const products = await store.list('products');
  const product = products.find((p) => p.id === productId);
  if (!product || !plannedQty) return res.status(400).json({ error: 'A valid product and planned quantity are required' });
  const batch = {
    id: await store.nextSequence('batches', 'b-'),
    batchNo: `BATCH-${new Date().getFullYear()}-${(await store.nextSequence('batches', 'b-', 4)).slice(2)}`, 
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    line: line || product.line,
    plannedQty: Number(plannedQty),
    actualQty: 0,
    wastageQty: 0,
    variancePct: 0,
    yieldPct: 0,
    supervisor: supervisor || req.user.name,
    status: 'in_progress',
    shift: shift || 'Morning',
    startDate: new Date().toISOString(),
    endDate: null,
    qcStatus: 'pending'
  };
  await store.insert('batches', batch);
  res.status(201).json({ batch });
});

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */
function stockStatus(stock, reorder) {
  if (stock <= 0) return 'out';
  if (stock <= reorder * 0.55) return 'critical';
  if (stock <= reorder) return 'low';
  return 'healthy';
}
// CREATE INVENTORY ITEM
app.post('/api/inventory', requireAuth, allow('admin', 'owner'), async (req, res) => {
  try {
    const {
      productId,
      warehouse,
      stock,
      reorderLevel,
      batch,
      expiry,
      unitCost
    } = req.body || {};

    if (!productId || !warehouse || !batch || !expiry || unitCost === '' || unitCost == null || !Number.isFinite(Number(unitCost)) || Number(unitCost) < 0) {
      return res.status(400).json({
        error: 'Please fill all required fields'
      });
    }

    const product = await store.get('products', productId);

    if (!product) {
      return res.status(404).json({
        error: 'Product not found'
      });
    }

    const existing = await store.list('inventory');

    const duplicate = existing.some(item =>
      item.productId === productId &&
      item.warehouse === warehouse &&
      item.batch === batch
    );

    if (duplicate) {
      return res.status(409).json({
        error: 'This inventory batch already exists'
      });
    }

    const quantity = Number(stock);
    const reorder = Number(reorderLevel);

    if (!Number.isFinite(quantity) || quantity < 0 ||
        !Number.isFinite(reorder) || reorder < 0) {
      return res.status(400).json({
        error: 'Invalid stock quantity'
      });
    }

    const item = {
      id: await store.nextSequence('inventory', 'inv-', 5),
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      stock: quantity,
      reorderLevel: reorder,
      batch: String(batch).trim(),
      warehouse: String(warehouse).trim(),
      expiry: String(expiry),
      unitCost: Number(unitCost),
      status: stockStatus(quantity, reorder),
      updatedAt: new Date().toISOString()
    };

    await store.insert('inventory', item);
    await store.insert('stockMovements', { id: await store.nextSequence('stockMovements', 'sm-', 5), itemId: item.id, productId: item.productId, itemName: item.name, unit: item.unit, movement: 'opening', quantity, balanceAfter: quantity, referenceType: 'opening_stock', referenceId: item.id, referenceNo: item.batch, unitCost: item.unitCost, actor: req.user.name, at: item.updatedAt });

    res.status(201).json({ item });

  } catch (error) {
    console.error('Inventory creation error:', error);

    res.status(500).json({
      error: 'Unable to create inventory item'
    });
  }
});
app.patch('/api/inventory/:id', requireAuth, allow('admin', 'production', 'owner'), async (req, res) => {
  const item = await store.get('inventory', req.params.id);
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });
  const patch = {};
  if (req.body.stock !== undefined) {
    patch.stock = Math.max(0, Number(req.body.stock));
    patch.status = stockStatus(patch.stock, item.reorderLevel);
  }
  if (req.body.reorderLevel !== undefined) {
    patch.reorderLevel = Math.max(0, Number(req.body.reorderLevel));
    patch.status = stockStatus(patch.stock !== undefined ? patch.stock : item.stock, patch.reorderLevel);
  }
  patch.updatedAt = new Date().toISOString();
  const updated = await store.update('inventory', item.id, patch);
  if (patch.stock !== undefined && patch.stock !== item.stock) {
    await store.insert('stockMovements', { id: await store.nextSequence('stockMovements', 'sm-', 5), itemId: item.id, productId: item.productId, itemName: item.name, unit: item.unit, movement: 'adjustment', quantity: patch.stock - item.stock, balanceAfter: patch.stock, referenceType: 'manual_adjustment', referenceId: item.id, referenceNo: item.batch, unitCost: item.unitCost, actor: req.user.name, at: new Date().toISOString() });
  }
  res.json({ item: updated });
});

/* ------------------------------------------------------------------ */
/* Audits                                                              */
/* ------------------------------------------------------------------ */
app.post('/api/audits', requireAuth, allow('accountant', 'admin', 'owner'), async (req, res) => {
  const { type, scope, score, findings, criticalFindings, notes } = req.body || {};
  const seq = (await store.list('audits')).length + 210;
  const numericScore = Math.min(100, Math.max(0, Number(score) || 0));
  const audit = {
    id: await store.nextSequence('audits', 'a-'),
    auditNo: `AUD-26-${seq + 1}`,
    type: type || 'In-Process',
    scope: scope || 'Production floor & hygiene',
    auditor: req.user.name,
    date: new Date().toISOString(),
    score: numericScore,
    findings: Number(findings) || 0,
    criticalFindings: Number(criticalFindings) || 0,
    status: 'in_progress',
    result: numericScore >= 90 ? 'excellent' : numericScore >= 80 ? 'compliant' : 'needs_attention',
    notes: notes || ''
  };
  await store.insert('audits', audit);
  res.status(201).json({ audit });
});

app.patch('/api/audits/:id', requireAuth, allow('accountant', 'admin', 'owner'), async (req, res) => {
  const audit = await store.get('audits', req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  const patch = {};
  for (const k of ['status', 'score', 'findings', 'criticalFindings', 'notes']) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (patch.score !== undefined) {
    patch.score = Math.min(100, Math.max(0, Number(patch.score)));
    patch.result = patch.score >= 90 ? 'excellent' : patch.score >= 80 ? 'compliant' : 'needs_attention';
  }
  const updated = await store.update('audits', audit.id, patch);
  res.json({ audit: updated });
});

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */
app.patch('/api/invoices/:id/pay', requireAuth, allow('accountant', 'admin', 'owner'), async (req, res) => {
  const invoice = await store.get('invoices', req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const remaining = round2(Number(invoice.amount) - Number(invoice.paidAmount || 0));
  if (remaining <= 0) return res.status(409).json({ error: 'Invoice is already settled.' });
  const payment = { id: await store.nextSequence('payments', 'pay-', 5), invoiceId: invoice.id, orderId: invoice.orderId, customer: invoice.customer, amount: remaining, method: req.body.method || 'Bank Transfer', reference: req.body.reference || '', receivedAt: new Date().toISOString(), receivedBy: req.user.name };
  await store.insert('payments', payment);
  const updated = await store.update('invoices', invoice.id, { paidAmount: Number(invoice.amount), balance: 0, status: 'paid', paidAt: new Date().toISOString(), method: payment.method });
  const order = await store.get('orders', invoice.orderId);
  if (order) await store.update('orders', order.id, { payment: 'paid' });
  res.json({ invoice: updated, payment });
});

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */
app.get('/api/users', requireAuth, allow('admin', 'owner'), async (req, res) => {
  const users = await store.list('users');
  res.json({ users: users.map(publicUser) });
});

app.post('/api/users', requireAuth, allow('owner', 'admin'), async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body || {};
    const roles = ['salesman','admin','production','accountant'];
    if (!name || !username || !email || !password || !roles.includes(role) || String(password).length < 8) return res.status(400).json({ error: 'Name, username, email, valid role and password (at least 8 characters) are required.' });
    const normalizedUsername=String(username).trim().toLowerCase(), normalizedEmail=String(email).trim().toLowerCase();
    const users=await store.list('users');
    if(users.some(u=>u.username===normalizedUsername||u.email===normalizedEmail)) return res.status(409).json({error:'Username or email already exists.'});
    const cleanName=String(name).trim();
    const titles={salesman:'Sales Executive',admin:'Administrator',production:'Production Supervisor',accountant:'Accounts Executive'};
    const user={id:await store.nextSequence('users','u-',5),username:normalizedUsername,email:normalizedEmail,name:cleanName,role,title:titles[role],region:String(req.body.region||''),initials:cleanName.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(),passwordHash:bcrypt.hashSync(password,12),status:'active',createdAt:new Date().toISOString(),lastLogin:null};
    await store.insert('users',user);
    res.status(201).json({user:publicUser(user)});
  } catch(e) { console.error('[users/create]',e); res.status(500).json({error:'Unable to create user.'}); }
});

app.patch('/api/users/:id', requireAuth, allow('admin', 'owner'), async (req, res) => {
  const user = await store.get('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const patch = {};
  for (const k of ['status', 'title', 'region', 'phone']) if (req.body[k] !== undefined) patch[k] = req.body[k];
  const updated = await store.update('users', user.id, patch);
  res.json({ user: publicUser(updated) });
});

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */
app.get('/api/reports/summary', requireAuth, allow('owner', 'accountant', 'admin'), async (req, res) => {
  const [orders, inventory, batches, audits, invoices, products] = await Promise.all([
    store.list('orders'), store.list('inventory'), store.list('batches'), store.list('audits'), store.list('invoices'), store.list('products')
  ]);
  res.json({
    kpis: metrics.computeKpis(orders, inventory, batches, audits, invoices),
    monthly: metrics.buildMonthlySeries(orders),
    regions: metrics.regionSales(orders),
    categories: metrics.categoryMix(orders, products),
    topProducts: metrics.topProducts(orders, products, 10),
    productionTrend: metrics.productionTrend(batches)
  });
});

/* ------------------------------------------------------------------ */
/* SPA fallbacks                                                       */
/* ------------------------------------------------------------------ */
app.get(['/login', '/app'], (req, res) => {
  const file = req.path === '/login' ? 'login.html' : 'app.html';
  res.sendFile(path.join(__dirname, '..', 'public', file));
});

app.get('/api/health', (req, res) => res.json({ ok: true, mode: store.mode, time: new Date().toISOString() }));
app.get('/api/version', (req, res) => {
  res.json({
    version: '1.1.0',
    status: 'updated',
    productsEndpoint: 'POST /api/products'
  });
});

// GET ALL PRODUCTS
app.get('/api/products', requireAuth, allow('admin', 'owner'), async (req, res) => {
  try {
    const products = await store.list('products');
    res.json({ products });
  } catch (error) {
    console.error('Product fetch error:', error);
    res.status(500).json({ error: 'Unable to fetch products' });
  }
});
// CREATE NEW PRODUCT
app.post('/api/products', requireAuth, allow('admin', 'owner'), async (req, res) => {
  try {
    const { sku, name, category, unit, price, shelfLife, line, gst } = req.body || {};

    const cleanSku = String(sku ?? '').trim().toUpperCase();
    const cleanName = String(name ?? '').trim();
    const cleanCategory = String(category ?? '').trim();
    const cleanUnit = String(unit ?? '').trim();
    const amount = price === '' || price == null ? NaN : Number(price);

    if (!cleanSku || !cleanName || !cleanCategory || !cleanUnit || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({
        error: 'SKU, product name, category, unit, and a valid non-negative price are required.'
      });
    }

    const parsedShelfLife = shelfLife === '' || shelfLife == null ? 0 : Number(shelfLife);
    const parsedGst = gst === '' || gst == null ? 0 : Number(gst);

    if (!Number.isFinite(parsedShelfLife) || parsedShelfLife < 0) {
      return res.status(400).json({ error: 'Shelf life must be a valid non-negative number.' });
    }

    if (!Number.isFinite(parsedGst) || parsedGst < 0 || parsedGst > 100) {
      return res.status(400).json({ error: 'GST must be a valid percentage between 0 and 100.' });
    }

    const products = await store.list('products');
    if (products.some(p => String(p.sku ?? '').trim().toUpperCase() === cleanSku)) {
      return res.status(409).json({ error: 'A product with this SKU already exists.' });
    }

    const product = {
      id: await store.nextSequence('products', 'p-', 5),
      sku: cleanSku,
      name: cleanName,
      category: cleanCategory,
      unit: cleanUnit,
      price: Math.round((amount + Number.EPSILON) * 100) / 100,
      shelfLife: Math.floor(parsedShelfLife),
      line: String(line ?? '').trim() || 'General',
      gst: Math.round((parsedGst + Number.EPSILON) * 100) / 100,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    await store.insert('products', product);
    return res.status(201).json({ product });
  } catch (err) {
    console.error('[products/create]', err);
    return res.status(500).json({ error: 'Unable to create product right now.' });
  }
});

/* ------------------------------------------------------------------ */
/* Purchasing, BOM, production consumption, dispatch and collections  */
/* ------------------------------------------------------------------ */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function stockState(qty, reorder) {
  if (qty <= 0) return 'out';
  if (qty <= reorder * 0.55) return 'critical';
  if (qty <= reorder) return 'low';
  return 'healthy';
}
async function recordMovement(item, movement, quantity, referenceType, referenceId, referenceNo, actor, note = '') {
  return store.insert('stockMovements', {
    id: await store.nextSequence('stockMovements', 'sm-', 5), itemId: item.id, productId: item.productId,
    itemName: item.name, unit: item.unit, movement, quantity: round2(quantity), balanceAfter: item.stock,
    referenceType, referenceId, referenceNo, unitCost: item.unitCost, note, actor, at: new Date().toISOString()
  });
}

app.get('/api/bom', requireAuth, async (req, res) => {
  const rows = await store.list('boms');
  const productId = req.query.productId;
  res.json({ boms: productId ? rows.filter(x => x.productId === productId) : rows });
});
app.post('/api/bom', requireAuth, allow('admin', 'owner', 'production'), async (req, res) => {
  const { productId, batchSize, expectedOutput, lines } = req.body || {};
  if (!productId || !(Number(batchSize) > 0) || !(Number(expectedOutput) > 0) || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'Product, batch size, expected output and at least one material line are required.' });
  const product = await store.get('products', productId);
  if (!product) return res.status(404).json({ error: 'Finished product not found.' });
  const inventory = await store.list('inventory');
  const cleanLines = [];
  if (new Set(lines.map(x=>x.inventoryId)).size !== lines.length) return res.status(400).json({ error: 'Each inventory item may appear only once in a BOM.' });
  for (const line of lines) {
    const item = inventory.find(x => x.id === line.inventoryId);
    const qty = Number(line.quantity);
    if (!item || !Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Every BOM line must reference an existing inventory item and a positive quantity.' });
    cleanLines.push({ inventoryId: item.id, productId: item.productId, itemName: item.name, unit: item.unit, quantity: qty });
  }
  const existing = (await store.list('boms')).find(x => x.productId === productId);
  const now = new Date().toISOString();
  const bom = { id: existing?.id || await store.nextSequence('boms', 'bom-', 5), productId, productName: product.name, batchSize: Number(batchSize), expectedOutput: Number(expectedOutput), lines: cleanLines, updatedAt: now, createdAt: existing?.createdAt || now };
  if (existing) await store.update('boms', existing.id, bom); else await store.insert('boms', bom);
  res.status(existing ? 200 : 201).json({ bom });
});

app.get('/api/purchases', requireAuth, allow('admin', 'owner', 'accountant'), async (req, res) => res.json({ purchases: (await store.list('purchases')).sort((a,b) => new Date(b.date)-new Date(a.date)) }));
app.post('/api/purchases', requireAuth, allow('admin', 'owner', 'accountant'), async (req, res) => {
  const { supplier, date, lines, notes } = req.body || {};
  if (!supplier || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'Supplier and at least one purchase line are required.' });
  const inventory = await store.list('inventory');
  const clean = [];
  for (const line of lines) {
    const item = inventory.find(x => x.id === line.inventoryId);
    const qty = Number(line.quantity), rate = Number(line.unitCost);
    if (!item || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'Each line needs an existing stock item, positive quantity and valid rate.' });
    clean.push({ inventoryId: item.id, productId: item.productId, itemName: item.name, unit: item.unit, quantity: qty, unitCost: rate, lineTotal: round2(qty * rate) });
  }
  const purchase = { id: await store.nextSequence('purchases', 'pur-', 5), purchaseNo: `PUR-${new Date().getFullYear()}-${String((await store.nextSequence('purchases','pur-',4)).slice(4)).padStart(4,'0')}`, supplier: String(supplier).trim(), date: date || new Date().toISOString(), lines: clean, subtotal: round2(clean.reduce((s,x)=>s+x.lineTotal,0)), notes: notes || '', createdBy: req.user.name, createdAt: new Date().toISOString() };
  await store.insert('purchases', purchase);
  for (const line of clean) {
    const item = await store.get('inventory', line.inventoryId);
    const newStock = round2(item.stock + line.quantity);
    const updated = await store.update('inventory', item.id, { stock: newStock, unitCost: line.unitCost, status: stockState(newStock, item.reorderLevel), updatedAt: new Date().toISOString() });
    await recordMovement(updated, 'purchase_in', line.quantity, 'purchase', purchase.id, purchase.purchaseNo, req.user.name);
  }
  res.status(201).json({ purchase });
});

app.post('/api/batches/:id/complete', requireAuth, allow('production', 'admin', 'owner'), async (req, res) => {
  const batch = await store.get('batches', req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  if (batch.status === 'completed') return res.status(409).json({ error: 'This batch is already completed.' });
  const bom = (await store.list('boms')).find(x => x.productId === batch.productId);
  if (!bom) return res.status(400).json({ error: 'Create a BOM for this product before completing production.' });
  const actualOutput = Number(req.body.actualOutput);
  if (!Number.isFinite(actualOutput) || actualOutput <= 0) return res.status(400).json({ error: 'Enter an actual good output greater than zero.' });
  if (Number(req.body.wastageQty || 0) < 0 || Number(req.body.labourCost || 0) < 0 || Number(req.body.overheadCost || 0) < 0) return res.status(400).json({ error: 'Wastage, labour and overhead values cannot be negative.' });
  const actualMaterials = Array.isArray(req.body.materials) ? req.body.materials : [];
  const inventory = await store.list('inventory');
  const finished = inventory.find(x => x.productId === batch.productId);
  if (!finished) return res.status(400).json({ error: 'Create a finished-goods inventory record for this product before completing production.' });
  if (actualMaterials.length !== bom.lines.length || bom.lines.some(line => !actualMaterials.some(x => x.inventoryId === line.inventoryId))) return res.status(400).json({ error: 'Enter actual consumption for every material in the BOM.' });
  const materialUsage = [];
  for (const standard of bom.lines) {
    const actualLine = actualMaterials.find(x => x.inventoryId === standard.inventoryId);
    const used = Number(actualLine.quantity);
    if (!Number.isFinite(used) || used < 0) return res.status(400).json({ error: `Invalid actual usage for ${standard.itemName}.` });
    const stock = await store.get('inventory', standard.inventoryId);
    if (!stock) return res.status(409).json({ error: `Inventory item missing: ${standard.itemName}.` });
    if (stock.stock < used) return res.status(409).json({ error: `Insufficient ${stock.name} stock. Available ${stock.stock} ${stock.unit}, required ${used} ${stock.unit}.` });
    materialUsage.push({ inventoryId: stock.id, itemName: stock.name, unit: stock.unit, standardQty: round2(standard.quantity * (batch.plannedQty / bom.expectedOutput)), actualQty: used, variancePct: standard.quantity ? round2(((used - standard.quantity * (batch.plannedQty / bom.expectedOutput)) / (standard.quantity * (batch.plannedQty / bom.expectedOutput))) * 100) : 0 });
  }
  for (const usage of materialUsage) {
    const stock = await store.get('inventory', usage.inventoryId);
    const next = round2(stock.stock - usage.actualQty);
    const updated = await store.update('inventory', stock.id, { stock: next, status: stockState(next, stock.reorderLevel), updatedAt: new Date().toISOString() });
    await recordMovement(updated, 'production_issue', -usage.actualQty, 'production', batch.id, batch.batchNo, req.user.name);
  }
  const finishedNext = round2(finished.stock + actualOutput);
  const finishedUpdated = await store.update('inventory', finished.id, { stock: finishedNext, status: stockState(finishedNext, finished.reorderLevel), updatedAt: new Date().toISOString() });
  await recordMovement(finishedUpdated, 'production_output', actualOutput, 'production', batch.id, batch.batchNo, req.user.name);
  const variancePct = batch.plannedQty ? round2(((actualOutput - batch.plannedQty) / batch.plannedQty) * 100) : 0;
  const costMaterial = materialUsage.reduce((sum, u) => { const st = inventory.find(x => x.id === u.inventoryId); return sum + u.actualQty * (Number(st?.unitCost) || 0); }, 0);
  const updatedBatch = await store.update('batches', batch.id, { actualQty: actualOutput, wastageQty: Number(req.body.wastageQty) || 0, variancePct, yieldPct: batch.plannedQty ? round2(actualOutput / batch.plannedQty * 100) : 0, materialUsage, labourCost: Number(req.body.labourCost) || 0, overheadCost: Number(req.body.overheadCost) || 0, materialCost: round2(costMaterial), costPerPacket: actualOutput ? round2((costMaterial + (Number(req.body.labourCost)||0) + (Number(req.body.overheadCost)||0)) / actualOutput) : 0, status: 'completed', qcStatus: req.body.qcStatus || 'pending', endDate: new Date().toISOString() });
  res.json({ batch: updatedBatch, materialUsage, finishedGoods: finishedUpdated, alerts: { yieldVariance: Math.abs(variancePct) >= 5, materialVariance: materialUsage.filter(x => Math.abs(x.variancePct) >= 5) } });
});

app.post('/api/orders/:id/approve', requireAuth, allow('admin', 'owner'), async (req, res) => {
  const order = await store.get('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!['pending'].includes(order.status)) return res.status(409).json({ error: 'Only pending orders can be approved.' });
  const inventory = await store.list('inventory');
  for (const line of order.items) {
    const available = inventory.filter(x => x.productId === line.productId).reduce((sum,x)=>sum+Number(x.stock||0),0);
    if (available < line.qty) return res.status(409).json({ error: `Insufficient stock for ${line.name}. Available ${available}, requested ${line.qty}. Shortage: ${round2(line.qty-available)}.` });
  }
  const productRows = await store.list('products');
  const taxLines = order.items.map(line => { const product = productRows.find(p=>p.id===line.productId); return { ...line, gstRate: Number(product?.gst)||0, gstAmount: round2(line.lineTotal * (Number(product?.gst)||0) / 100) }; });
  const gst = round2(taxLines.reduce((s,x)=>s+x.gstAmount,0));
  const interstate = !/tamil nadu/i.test(order.region || '');
  const invoice = { id: await store.nextSequence('invoices','inv-',5), invoiceNo: `INV-${new Date().getFullYear()}-${String((await store.nextSequence('invoices','inv-',4)).slice(4)).padStart(4,'0')}`, orderId: order.id, orderNo: order.orderNo, customer: order.customer, city: order.city, region: order.region, subtotal: order.subtotal, gst, cgst: interstate ? 0 : round2(gst/2), sgst: interstate ? 0 : round2(gst/2), igst: interstate ? gst : 0, amount: round2(order.subtotal+gst), paidAmount: 0, balance: round2(order.subtotal+gst), issuedAt: new Date().toISOString(), dueDate: order.dueDate, status: 'unpaid', method: null, salesmanId: order.salesmanId, lines: taxLines };
  await store.insert('invoices', invoice);
  const updatedOrder = await store.update('orders', order.id, { status: 'confirmed', invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, tax: gst, total: invoice.amount, approvedAt: new Date().toISOString() });
  res.json({ order: updatedOrder, invoice });
});

app.post('/api/orders/:id/dispatch', requireAuth, allow('admin', 'owner'), async (req, res) => {
  const order = await store.get('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!['confirmed','packed'].includes(order.status)) return res.status(409).json({ error: 'Approve and pack the order before dispatch.' });
  const rows = await store.list('inventory');
  for (const line of order.items) {
    const available = rows.filter(x=>x.productId===line.productId).reduce((sum,x)=>sum+Number(x.stock||0),0);
    if (available < line.qty) return res.status(409).json({ error: `Insufficient finished stock for ${line.name}. Available ${available}, requested ${line.qty}.` });
  }
  for (const line of order.items) {
    let remaining = line.qty;
    for (const item of rows.filter(x=>x.productId===line.productId && x.stock>0)) {
      if (remaining <= 0) break;
      const taken = Math.min(Number(item.stock), remaining), next = round2(item.stock-taken);
      const updated = await store.update('inventory', item.id, { stock: next, status: stockState(next,item.reorderLevel), updatedAt: new Date().toISOString() });
      await recordMovement(updated,'dispatch_out',-taken,'order',order.id,order.orderNo,req.user.name);
      remaining = round2(remaining-taken);
    }
  }
  const updatedOrder = await store.update('orders', order.id, { status: 'dispatched', dispatchedAt: new Date().toISOString() });
  res.json({ order: updatedOrder });
});

app.get('/api/invoices', requireAuth, allow('admin','owner','accountant'), async (req,res) => res.json({ invoices: await store.list('invoices') }));
app.post('/api/invoices/:id/payments', requireAuth, allow('admin','owner','accountant'), async (req,res) => {
  const invoice = await store.get('invoices',req.params.id);
  if (!invoice) return res.status(404).json({error:'Invoice not found.'});
  const amount = Number(req.body.amount);
  const balance = round2(Number(invoice.amount)-Number(invoice.paidAmount||0));
  if (!Number.isFinite(amount) || amount <= 0 || amount > balance) return res.status(400).json({error:`Payment must be greater than zero and not exceed outstanding balance ₹${balance}.`});
  const payment = { id: await store.nextSequence('payments','pay-',5), invoiceId: invoice.id, orderId: invoice.orderId, customer: invoice.customer, amount: round2(amount), method: req.body.method || 'Bank Transfer', reference: req.body.reference || '', receivedAt: new Date().toISOString(), receivedBy: req.user.name };
  await store.insert('payments',payment);
  const paidAmount = round2(Number(invoice.paidAmount||0)+amount), nextBalance = round2(Number(invoice.amount)-paidAmount);
  const updatedInvoice = await store.update('invoices',invoice.id,{paidAmount,balance:nextBalance,status:nextBalance===0?'paid':'part_paid',paidAt:nextBalance===0?new Date().toISOString():null});
  const order = await store.get('orders',invoice.orderId);
  if (order) await store.update('orders',order.id,{payment:nextBalance===0?'paid':'part_paid'});
  res.status(201).json({payment,invoice:updatedInvoice});
});
app.get('/api/payments', requireAuth, allow('admin','owner','accountant'), async (req,res)=>res.json({payments:await store.list('payments')}));
app.get('/api/stock-ledger', requireAuth, allow('admin','owner','production','accountant'), async (req,res)=>{
  let rows=await store.list('stockMovements');
  if(req.query.itemId) rows=rows.filter(x=>x.itemId===req.query.itemId);
  rows.sort((a,b)=>new Date(b.at)-new Date(a.at));
  res.json({movements:rows});
});
app.get('/api/reports/monthly', requireAuth, allow('admin','owner','accountant'), async (req,res)=>{
  const [orders,invoices,purchases,batches,inventory,payments,movements]=await Promise.all(['orders','invoices','purchases','batches','inventory','payments','stockMovements'].map(x=>store.list(x)));
  res.json({orders,invoices,purchases,batches,inventory,payments,movements,generatedAt:new Date().toISOString()});
});
app.get('/api/reports/export/:type', requireAuth, allow('admin','owner','accountant'), async (req,res)=>{
  const map={orders:'orders',invoices:'invoices',inventory:'inventory',production:'batches',purchases:'purchases',payments:'payments',ledger:'stockMovements'};
  const collection=map[req.params.type]; if(!collection) return res.status(400).json({error:'Unsupported report type.'});
  const rows=await store.list(collection); const fields=[...new Set(rows.flatMap(x=>Object.keys(x)))];
  const csvCell=v=>{const value=Array.isArray(v)|| (v&&typeof v==='object')?JSON.stringify(v):String(v??'');return '"'+value.replace(/"/g,'""')+'"';};
  const csv=[fields.map(csvCell).join(','),...rows.map(row=>fields.map(f=>csvCell(row[f])).join(','))].join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="foodflow-${req.params.type}-${new Date().toISOString().slice(0,10)}.csv"`); res.send(csv);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

store.init().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`FOODFLOW running on http://0.0.0.0:${PORT} (store: ${store.mode})`));
});
