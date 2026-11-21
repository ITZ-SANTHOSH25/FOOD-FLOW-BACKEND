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
    const validRoles = ['salesman', 'admin', 'production', 'accountant', 'owner'];
    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ error: 'Please complete all required fields.' });
    }
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Please choose a valid workspace role.' });
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

/* ------------------------------------------------------------------ */
/* Bootstrap — one payload for the whole dashboard shell               */
/* ------------------------------------------------------------------ */
app.get('/api/bootstrap', requireAuth, async (req, res) => {
  const [users, products, orders, inventory, batches, audits, invoices, activity] = await Promise.all([
    store.list('users'), store.list('products'), store.list('orders'), store.list('inventory'),
    store.list('batches'), store.list('audits'), store.list('invoices'), store.list('activity')
  ]);

  const data = scoped(req.user, { users: users.map(publicUser), products, orders, inventory, batches, audits, invoices, activity });
  const kpis = metrics.computeKpis(data.orders, data.inventory, data.batches, data.audits, data.invoices);

  res.json({
    user: publicUser(req.user),
    storeMode: store.mode,
    asOf: '2026-01-17T09:30:00+05:30',
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
  if (!customer || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer and at least one line item are required' });
  }
  const products = await store.list('products');
  const priced = items.map((it) => {
    const product = products.find((p) => p.id === it.productId);
    if (!product) throw new Error(`Unknown product: ${it.productId}`);
    const qty = Math.max(1, Number(it.qty) || 0);
    return { productId: product.id, sku: product.sku, name: product.name, qty, unitPrice: product.price, lineTotal: Math.round(qty * product.price * 100) / 100 };
  });
  const subtotal = Math.round(priced.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
  const tax = Math.round(subtotal * 0.12 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const seq = (await store.list('orders')).length + 1040;
  const due = dueDate || new Date(Date.now() + 7 * 86400000).toISOString();

  const order = {
    id: await store.nextSequence('orders', 'o-'),
    orderNo: `FF-2026-${seq + 1}`,
    customer,
    customerType: req.body.customerType || 'Restaurant Chain',
    city: city || 'Chennai',
    region: region || 'Tamil Nadu',
    salesmanId: req.user.role === 'salesman' ? req.user.id : req.body.salesmanId || 'u-sales-1',
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
  const order = await store.get('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role === 'salesman' && order.salesmanId !== req.user.id) {
    return res.status(403).json({ error: 'You can only update your own orders' });
  }
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
  const seq = (await store.list('batches')).length + 120;
  const batch = {
    id: await store.nextSequence('batches', 'b-'),
    batchNo: `BATCH-26${seq + 1}`,
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
  const updated = await store.update('invoices', invoice.id, { status: 'paid', paidAt: new Date().toISOString(), method: req.body.method || invoice.method });
  const order = await store.get('orders', invoice.orderId);
  if (order) await store.update('orders', order.id, { payment: 'paid' });
  await store.insert('activity', {
    id: await store.nextSequence('activity', 'act-'),
    type: 'finance',
    text: `${invoice.invoiceNo} marked paid · ₹${Math.round(invoice.amount).toLocaleString('en-IN')}`,
    at: new Date().toISOString(),
    actor: req.user.name
  });
  res.json({ invoice: updated });
});

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */
app.get('/api/users', requireAuth, allow('admin', 'owner'), async (req, res) => {
  const users = await store.list('users');
  res.json({ users: users.map(publicUser) });
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

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

store.init().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`FOODFLOW running on http://0.0.0.0:${PORT} (store: ${store.mode})`));
});
