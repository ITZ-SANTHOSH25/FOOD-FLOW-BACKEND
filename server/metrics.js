/**
 * All business calculations live here, on the server, so the UI only renders.
 */

const OPEN_STATUSES = ['pending', 'confirmed', 'in_production', 'packed', 'dispatched'];

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthlySeries(orders, months = 6) {
  const now = new Date('2026-01-17T00:00:00+05:30');
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: monthKey(d),
      label: d.toLocaleString('en-IN', { month: 'short' }),
      year: d.getFullYear(),
      revenue: 0,
      orders: 0,
      units: 0
    });
  }
  const index = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const b = index[monthKey(o.createdAt)];
    if (!b) continue;
    b.revenue += o.total;
    b.orders += 1;
    b.units += o.items.reduce((s, it) => s + it.qty, 0);
  }
  return buckets.map((b) => ({ ...b, revenue: Math.round(b.revenue) }));
}

function computeKpis(orders, inventory, batches, audits, invoices) {
  const valid = orders.filter((o) => o.status !== 'cancelled');
  const revenue = valid.reduce((s, o) => s + o.total, 0);
  const openOrders = orders.filter((o) => OPEN_STATUSES.includes(o.status));
  const delivered = orders.filter((o) => o.status === 'delivered');
  const onTime = delivered.filter((o) => new Date(o.dueDate) >= new Date(o.createdAt)).length;
  const lowStock = inventory.filter((i) => ['low', 'critical', 'out'].includes(i.status));
  const activeBatches = batches.filter((b) => b.status === 'in_progress');
  const completedBatches = batches.filter((b) => b.status === 'completed');
  const avgYield = completedBatches.length
    ? completedBatches.reduce((s, b) => s + b.yieldPct, 0) / completedBatches.length
    : 0;
  const varianceAlerts = batches.filter((b) => Math.abs(b.variancePct) > 8 || b.status === 'on_hold');
  const receivables = invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amount, 0);
  const overdue = invoices.filter((i) => i.status === 'overdue');
  const avgAudit = audits.length ? audits.reduce((s, a) => s + a.score, 0) / audits.length : 0;

  return {
    revenue: Math.round(revenue),
    orderCount: orders.length,
    openOrders: openOrders.length,
    deliveredCount: delivered.length,
    avgOrderValue: valid.length ? Math.round(revenue / valid.length) : 0,
    onTimePct: delivered.length ? Math.round((onTime / delivered.length) * 100) : 0,
    lowStockCount: lowStock.length,
    criticalStockCount: inventory.filter((i) => ['critical', 'out'].includes(i.status)).length,
    activeBatches: activeBatches.length,
    avgYield: Math.round(avgYield * 10) / 10,
    varianceAlerts: varianceAlerts.length,
    receivables: Math.round(receivables),
    overdueCount: overdue.length,
    overdueAmount: Math.round(overdue.reduce((s, i) => s + i.amount, 0)),
    avgAuditScore: Math.round(avgAudit * 10) / 10,
    openAudits: audits.filter((a) => a.status === 'in_progress').length,
    inventoryValue: Math.round(inventory.reduce((s, i) => s + i.stock * i.unitCost, 0))
  };
}

function statusBreakdown(orders) {
  const keys = ['pending', 'confirmed', 'in_production', 'packed', 'dispatched', 'delivered', 'cancelled'];
  return keys.map((k) => ({ key: k, count: orders.filter((o) => o.status === k).length }));
}

function categoryMix(orders, products) {
  const byProduct = Object.fromEntries(products.map((p) => [p.id, p]));
  const map = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const it of o.items) {
      const cat = byProduct[it.productId]?.category || 'Other';
      map[cat] = (map[cat] || 0) + it.lineTotal;
    }
  }
  return Object.entries(map)
    .map(([category, value]) => ({ category, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
}

function topProducts(orders, products, limit = 6) {
  const map = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const it of o.items) {
      if (!map[it.productId]) map[it.productId] = { productId: it.productId, name: it.name, sku: it.sku, qty: 0, revenue: 0 };
      map[it.productId].qty += it.qty;
      map[it.productId].revenue += it.lineTotal;
    }
  }
  return Object.values(map)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map((p) => ({ ...p, revenue: Math.round(p.revenue) }));
}

function regionSales(orders) {
  const map = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    map[o.region] = (map[o.region] || 0) + o.total;
  }
  return Object.entries(map)
    .map(([region, value]) => ({ region, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
}

function productionTrend(batches) {
  return batches
    .filter((b) => b.status === 'completed')
    .slice(0, 10)
    .reverse()
    .map((b) => ({
      label: b.batchNo.replace('BATCH-', ''),
      planned: b.plannedQty,
      actual: b.actualQty,
      variance: b.variancePct
    }));
}

function notifications(orders, inventory, batches, audits, invoices) {
  const out = [];
  for (const i of inventory.filter((x) => ['critical', 'out'].includes(x.status)).slice(0, 4)) {
    out.push({
      id: `n-${i.id}`,
      tone: 'danger',
      title: 'Stock below safety level',
      text: `${i.name} — ${i.stock} ${i.unit} left at ${i.warehouse}`,
      at: i.updatedAt
    });
  }
  for (const b of batches.filter((x) => Math.abs(x.variancePct) > 8).slice(0, 3)) {
    out.push({
      id: `n-${b.id}`,
      tone: 'warn',
      title: 'Production variance flagged',
      text: `${b.batchNo} · ${b.productName} at ${b.variancePct}% vs plan`,
      at: b.startDate
    });
  }
  for (const a of audits.filter((x) => x.status === 'in_progress').slice(0, 3)) {
    out.push({ id: `n-${a.id}`, tone: 'info', title: 'Audit in progress', text: `${a.auditNo} · ${a.scope}`, at: a.date });
  }
  for (const i of invoices.filter((x) => x.status === 'overdue').slice(0, 3)) {
    out.push({
      id: `n-${i.id}`,
      tone: 'danger',
      title: 'Invoice overdue',
      text: `${i.invoiceNo} · ${i.customer} · ₹${Math.round(i.amount).toLocaleString('en-IN')}`,
      at: i.dueDate
    });
  }
  for (const o of orders.filter((x) => x.status === 'pending').slice(0, 3)) {
    out.push({ id: `n-${o.id}`, tone: 'info', title: 'Order awaiting confirmation', text: `${o.orderNo} · ${o.customer}`, at: o.createdAt });
  }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
}

module.exports = {
  buildMonthlySeries,
  computeKpis,
  statusBreakdown,
  categoryMix,
  topProducts,
  regionSales,
  productionTrend,
  notifications
};
