/**
 * Deterministic demo dataset for FOODFLOW.
 * A South Indian food manufacturer: masalas, podis, chutney mixes,
 * filter coffee, ready-to-cook pastes and traditional snacks.
 */

/* Small deterministic PRNG so the demo data is stable across restarts */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260117);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));
const money = (n) => Math.round(n * 100) / 100;

const iso = (d) => new Date(d).toISOString();
const REF_DATE = new Date('2026-01-17T09:30:00+05:30');
const daysAgo = (n) => {
  const d = new Date(REF_DATE);
  d.setDate(d.getDate() - n);
  return d;
};

const PRODUCTS = [
  { sku: 'FF-MAS-001', name: 'Ghee Roast Masala', category: 'Masala Blends', unit: '500 g pouch', price: 185, shelfLife: 12, line: 'Blending Line A' },
  { sku: 'FF-MAS-002', name: 'Sambar Powder — Family Pack', category: 'Masala Blends', unit: '1 kg pouch', price: 240, shelfLife: 12, line: 'Blending Line A' },
  { sku: 'FF-MAS-003', name: 'Rasam Powder', category: 'Masala Blends', unit: '500 g pouch', price: 165, shelfLife: 12, line: 'Blending Line A' },
  { sku: 'FF-MAS-004', name: 'Madras Curry Masala', category: 'Masala Blends', unit: '250 g box', price: 110, shelfLife: 12, line: 'Blending Line B' },
  { sku: 'FF-POD-001', name: 'Idli Milagai Podi', category: 'Podis & Chutneys', unit: '250 g jar', price: 125, shelfLife: 9, line: 'Filling Line C' },
  { sku: 'FF-POD-002', name: 'Coconut Chutney Mix', category: 'Podis & Chutneys', unit: '200 g pouch', price: 98, shelfLife: 9, line: 'Filling Line C' },
  { sku: 'FF-POD-003', name: 'Kara Chutney Podi', category: 'Podis & Chutneys', unit: '250 g jar', price: 132, shelfLife: 9, line: 'Filling Line C' },
  { sku: 'FF-COF-001', name: 'Filter Coffee Powder — 80:20', category: 'Coffee', unit: '500 g pack', price: 310, shelfLife: 6, line: 'Roasting Line D' },
  { sku: 'FF-COF-002', name: 'Instant Filter Coffee Decoction', category: 'Coffee', unit: '200 ml bottle', price: 145, shelfLife: 3, line: 'Liquid Line E' },
  { sku: 'FF-RTC-001', name: 'Tamarind Rice Paste', category: 'Ready-to-Cook', unit: '200 g pouch', price: 88, shelfLife: 6, line: 'Liquid Line E' },
  { sku: 'FF-RTC-002', name: 'Lemon Rice Mix', category: 'Ready-to-Cook', unit: '200 g pouch', price: 82, shelfLife: 6, line: 'Liquid Line E' },
  { sku: 'FF-RTC-003', name: 'Chettinad Chicken Masala', category: 'Ready-to-Cook', unit: '100 g box', price: 95, shelfLife: 9, line: 'Blending Line B' },
  { sku: 'FF-SNK-001', name: 'Appalam — Urad Dal', category: 'Traditional Snacks', unit: '200 g pack', price: 76, shelfLife: 6, line: 'Packing Line F' },
  { sku: 'FF-SNK-002', name: 'Vathal — Sundakkai', category: 'Traditional Snacks', unit: '150 g pack', price: 68, shelfLife: 9, line: 'Packing Line F' },
  { sku: 'FF-SNK-003', name: 'Banana Chips — Pepper', category: 'Traditional Snacks', unit: '250 g pack', price: 118, shelfLife: 4, line: 'Frying Line G' },
  { sku: 'FF-SWT-001', name: 'Adhirasam Mix', category: 'Sweets & Mixes', unit: '500 g box', price: 155, shelfLife: 6, line: 'Blending Line B' },
  { sku: 'FF-SWT-002', name: 'Payasam Mix — Semiya', category: 'Sweets & Mixes', unit: '200 g pouch', price: 92, shelfLife: 9, line: 'Packing Line F' },
  { sku: 'FF-OIL-001', name: 'Cold-Pressed Sesame Oil', category: 'Oils', unit: '1 L bottle', price: 285, shelfLife: 18, line: 'Liquid Line E' }
];

const CUSTOMERS = [
  { name: 'Annalakshmi Restaurant', city: 'Chennai', type: 'Restaurant Chain' },
  { name: 'Saravana Bhavan Franchise', city: 'Chennai', type: 'Restaurant Chain' },
  { name: 'Murugan Idli Shop', city: 'Madurai', type: 'Restaurant Chain' },
  { name: 'Sri Krishna Stores', city: 'Coimbatore', type: 'Retail Grocery' },
  { name: 'Thanjavur Provision Mart', city: 'Thanjavur', type: 'Retail Grocery' },
  { name: 'Trichy Fresh Foods', city: 'Tiruchirappalli', type: 'Distributor' },
  { name: 'Nilgiri Supermarket', city: 'Coimbatore', type: 'Modern Trade' },
  { name: 'Kaveri Catering Services', city: 'Salem', type: 'Catering' },
  { name: 'Bengaluru Tiffin House', city: 'Bengaluru', type: 'Restaurant Chain' },
  { name: 'Mysore Iyengar Bakery', city: 'Mysuru', type: 'Bakery & Snacks' },
  { name: 'Kochi Spice Traders', city: 'Kochi', type: 'Distributor' },
  { name: 'Trivandrum Home Foods', city: 'Thiruvananthapuram', type: 'Retail Grocery' },
  { name: 'Hyderabad Deccan Foods', city: 'Hyderabad', type: 'Distributor' },
  { name: 'Vijayawada Annapurna Stores', city: 'Vijayawada', type: 'Retail Grocery' },
  { name: 'Puducherry Cafe Bleu', city: 'Puducherry', type: 'Cafe' },
  { name: 'Vellore Sangeetha Veg', city: 'Vellore', type: 'Restaurant Chain' }
];

const AUDIT_TYPES = ['Pre-Production', 'In-Process', 'Final Dispatch', 'Inventory', 'Financial'];

function buildSeed() {
  const users = [];

  const products = PRODUCTS.map((p, i) => ({
    id: `p-${String(i + 1).padStart(3, '0')}`,
    ...p,
    gst: 12,
    status: 'active'
  }));

  /* ---------- Orders across the last ~170 days ---------- */
  const orders = [];
  for (let i = 0; i < 64; i++) {
    const cust = CUSTOMERS[i % CUSTOMERS.length];
    const created = daysAgo(between(0, 170));
    const itemCount = between(1, 4);
    const items = [];
    const used = new Set();
    for (let j = 0; j < itemCount; j++) {
      const prod = pick(products);
      if (used.has(prod.id)) continue;
      used.add(prod.id);
      const qty = between(6, 60);
      items.push({
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        qty,
        unitPrice: prod.price,
        lineTotal: money(qty * prod.price)
      });
    }
    const subtotal = money(items.reduce((s, it) => s + it.lineTotal, 0));
    const tax = money(subtotal * 0.12);
    const total = money(subtotal + tax);

    let status;
    const age = Math.round((REF_DATE.getTime() - created.getTime()) / 86400000);
    if (age > 25) status = rnd() > 0.12 ? 'delivered' : 'cancelled';
    else if (age > 14) status = pick(['delivered', 'dispatched', 'delivered']);
    else if (age > 8) status = pick(['dispatched', 'packed', 'in_production']);
    else if (age > 3) status = pick(['in_production', 'confirmed', 'packed']);
    else status = pick(['pending', 'confirmed', 'in_production']);

    const due = new Date(created); due.setDate(due.getDate() + between(4, 12));
    orders.push({
      id: `o-${String(i + 1).padStart(4, '0')}`,
      orderNo: `FF-2026-${String(1040 + i)}`,
      customer: cust.name,
      customerType: cust.type,
      city: cust.city,
      region: ['Chennai', 'Madurai', 'Coimbatore', 'Tiruchirappalli', 'Salem', 'Vellore', 'Puducherry'].includes(cust.city) ? 'Tamil Nadu' : ['Bengaluru', 'Mysuru'].includes(cust.city) ? 'Karnataka' : ['Kochi', 'Thiruvananthapuram'].includes(cust.city) ? 'Kerala' : 'Andhra & Telangana',
      salesmanId: i % 3 === 0 ? 'u-sales-2' : 'u-sales-1',
      items,
      subtotal, tax, total,
      status,
      priority: rnd() > 0.82 ? 'high' : rnd() > 0.4 ? 'normal' : 'low',
      payment: pick(['paid', 'paid', 'pending', 'credit']),
      createdAt: iso(created),
      dueDate: iso(due),
      notes: ''
    });
  }
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  /* Guarantee a live pipeline on the board: the newest ten orders sit at
     realistic stages between capture and dispatch. */
  const openPlan = ['pending', 'confirmed', 'in_production', 'confirmed', 'packed',
    'in_production', 'dispatched', 'confirmed', 'pending', 'in_production'];
  orders.slice(0, openPlan.length).forEach((o, i) => { o.status = openPlan[i]; });

  /* ---------- Inventory ---------- */
  const warehouses = ['Unit I — Trichy', 'Unit II — Thanjavur', 'Cold Store — Chennai'];
  const inventory = products.map((p, i) => {
    const reorder = between(80, 240);
    let stock = between(20, 620);
    if (i % 7 === 0) stock = between(10, Math.floor(reorder * 0.55));
    const exp = daysAgo(-between(4, 300));
    return {
      id: `inv-${String(i + 1).padStart(3, '0')}`,
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      stock,
      reorderLevel: reorder,
      batch: `B26-${String(between(100, 999))}`,
      warehouse: warehouses[i % warehouses.length],
      expiry: iso(exp),
      unitCost: money(p.price * 0.62),
      status: stock === 0 ? 'out' : stock <= reorder * 0.55 ? 'critical' : stock <= reorder ? 'low' : 'healthy',
      updatedAt: iso(daysAgo(between(0, 2)))
    };
  });

  /* ---------- Production batches ---------- */
  const batches = [];
  const supervisors = ['Priya Subramanian', 'M. Selvaraj', 'R. Anandhi'];
  for (let i = 0; i < 26; i++) {
    const prod = products[i % products.length];
    const planned = between(400, 2400);
    const actual = Math.round(planned * (0.86 + rnd() * 0.18));
    const wastage = Math.round(planned * (0.005 + rnd() * 0.045));
    const variancePct = money(((actual - planned) / planned) * 100);
    const start = daysAgo(between(0, 45));
    const status = i < 3 ? 'in_progress' : i === 3 ? 'on_hold' : 'completed';
    batches.push({
      id: `b-${String(i + 1).padStart(3, '0')}`,
      batchNo: `BATCH-26${String(120 + i)}`,
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      line: prod.line,
      plannedQty: planned,
      actualQty: status === 'in_progress' ? Math.round(planned * rnd() * 0.8) : actual,
      wastageQty: wastage,
      variancePct,
      yieldPct: money((actual / planned) * 100),
      supervisor: supervisors[i % supervisors.length],
      status,
      shift: pick(['Morning', 'Afternoon', 'Night']),
      startDate: iso(start),
      endDate: status === 'completed' ? iso(new Date(start.getTime() + between(1, 3) * 86400000)) : null,
      qcStatus: status === 'completed' ? (rnd() > 0.12 ? 'passed' : 'rework') : 'pending'
    });
  }

  /* ---------- Audits ---------- */
  const audits = [];
  for (let i = 0; i < 18; i++) {
    const type = AUDIT_TYPES[i % AUDIT_TYPES.length];
    const score = between(72, 99);
    audits.push({
      id: `a-${String(i + 1).padStart(3, '0')}`,
      auditNo: `AUD-26-${String(210 + i)}`,
      type,
      scope: type === 'Financial' ? 'Invoices & reconciliation' : type === 'Inventory' ? 'Warehouse stock accuracy' : 'Production floor & hygiene',
      auditor: i % 2 ? 'Karthik Iyer' : 'S. Meenakshi (External)',
      date: iso(daysAgo(between(0, 120))),
      score,
      findings: score > 92 ? 1 : score > 84 ? between(2, 4) : between(5, 8),
      criticalFindings: score < 80 ? between(1, 2) : 0,
      status: i < 3 ? 'in_progress' : 'closed',
      result: score >= 90 ? 'excellent' : score >= 80 ? 'compliant' : 'needs_attention',
      notes: score >= 90 ? 'Documentation complete; no major non-conformities.' : 'Corrective action plan issued to department head.'
    });
  }

  /* ---------- Invoices ---------- */
  const invoices = orders.filter((o) => ['packed', 'dispatched', 'delivered'].includes(o.status)).slice(0, 46).map((o, i) => {
    const due = new Date(o.createdAt); due.setDate(due.getDate() + 30);
    const overdue = due < new Date('2026-01-17') && o.payment !== 'paid';
    return {
      id: `inv-${String(i + 1).padStart(3, '0')}`,
      invoiceNo: `INV-26-${String(3100 + i)}`,
      orderId: o.id,
      orderNo: o.orderNo,
      customer: o.customer,
      city: o.city,
      amount: o.total,
      gst: o.tax,
      issuedAt: o.createdAt,
      dueDate: iso(due),
      status: o.payment === 'paid' ? 'paid' : overdue ? 'overdue' : 'pending',
      method: pick(['NEFT', 'UPI', 'Cheque', 'Credit 30']),
      salesmanId: o.salesmanId
    };
  });

  const activity = [
    { id: 'act-1', type: 'order', text: 'Order FF-2026-1103 confirmed by Arjun Raghavan', at: iso(daysAgo(0)), actor: 'Arjun Raghavan' },
    { id: 'act-2', type: 'production', text: 'Batch BATCH-26142 completed with 98.2% yield', at: iso(daysAgo(0)), actor: 'Priya Subramanian' },
    { id: 'act-3', type: 'audit', text: 'Final dispatch audit AUD-26-227 closed — score 94', at: iso(daysAgo(1)), actor: 'Karthik Iyer' },
    { id: 'act-4', type: 'inventory', text: 'Coconut Chutney Mix below reorder level at Unit II', at: iso(daysAgo(1)), actor: 'System' },
    { id: 'act-5', type: 'finance', text: 'Invoice INV-26-3112 marked paid via NEFT', at: iso(daysAgo(2)), actor: 'Karthik Iyer' }
  ];

  return { users: [], products, orders, inventory, batches, audits, invoices, activity };
}

module.exports = { buildSeed };
