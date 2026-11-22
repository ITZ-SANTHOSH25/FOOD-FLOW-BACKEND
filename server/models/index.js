const mongoose = require('mongoose');

/**
 * Flexible schemas: the domain documents are stored with a stable string `id`
 * so the same API contract works whether we are on MongoDB or the local
 * file-backed fallback store.
 */
const options = { strict: false, timestamps: true, versionKey: false };

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  username: { type: String, unique: true, index: true },
  passwordHash: String,
  name: String,
  role: { type: String, index: true },
  title: String,
  region: String,
  email: String,
  phone: String,
  initials: String,
  status: String,
  lastLogin: String
}, options);

const orderSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  orderNo: { type: String, index: true },
  customer: String,
  city: String,
  region: String,
  salesmanId: { type: String, index: true },
  items: Array,
  subtotal: Number,
  tax: Number,
  total: Number,
  status: { type: String, index: true },
  priority: String,
  payment: String,
  createdAt: String,
  dueDate: String,
  notes: String
}, options);

const productSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  sku: { type: String, index: true },
  name: String,
  category: String,
  unit: String,
  price: Number,
  shelfLife: Number,
  line: String,
  gst: Number,
  status: String
}, options);

const inventorySchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  productId: { type: String, index: true },
  sku: String,
  name: String,
  category: String,
  unit: String,
  stock: Number,
  reorderLevel: Number,
  batch: String,
  warehouse: String,
  expiry: String,
  unitCost: Number,
  status: { type: String, index: true },
  updatedAt: String
}, options);

const batchSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  batchNo: { type: String, index: true },
  productId: String,
  productName: String,
  sku: String,
  line: String,
  plannedQty: Number,
  actualQty: Number,
  wastageQty: Number,
  variancePct: Number,
  yieldPct: Number,
  supervisor: String,
  status: { type: String, index: true },
  shift: String,
  startDate: String,
  endDate: String,
  qcStatus: String
}, options);

const auditSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  auditNo: { type: String, index: true },
  type: String,
  scope: String,
  auditor: String,
  date: String,
  score: Number,
  findings: Number,
  criticalFindings: Number,
  status: String,
  result: String,
  notes: String
}, options);

const invoiceSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  invoiceNo: { type: String, index: true },
  orderId: String,
  orderNo: String,
  customer: String,
  city: String,
  amount: Number,
  gst: Number,
  issuedAt: String,
  dueDate: String,
  status: { type: String, index: true },
  method: String,
  salesmanId: String
}, options);

const activitySchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true }, type: String, text: String, at: String, actor: String
}, options);
const bomSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true }, productId: { type: String, index: true },
  productName: String, batchSize: Number, expectedOutput: Number, lines: Array, updatedAt: String, createdAt: String
}, options);
const purchaseSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true }, purchaseNo: { type: String, index: true },
  supplier: String, date: String, lines: Array, subtotal: Number, notes: String, createdBy: String, createdAt: String
}, options);
const stockMovementSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true }, itemId: { type: String, index: true }, productId: String,
  itemName: String, unit: String, movement: String, quantity: Number, balanceAfter: Number,
  referenceType: String, referenceId: String, referenceNo: String, unitCost: Number, note: String, actor: String, at: String
}, options);
const paymentSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true }, invoiceId: { type: String, index: true }, orderId: String,
  customer: String, amount: Number, method: String, reference: String, receivedAt: String, receivedBy: String
}, options);

module.exports = {
  User: mongoose.model('User', userSchema),
  Order: mongoose.model('Order', orderSchema),
  Product: mongoose.model('Product', productSchema),
  Inventory: mongoose.model('Inventory', inventorySchema),
  Batch: mongoose.model('Batch', batchSchema),
  Audit: mongoose.model('Audit', auditSchema),
  Invoice: mongoose.model('Invoice', invoiceSchema),
  Activity: mongoose.model('Activity', activitySchema),
  Bom: mongoose.model('Bom', bomSchema),
  Purchase: mongoose.model('Purchase', purchaseSchema),
  StockMovement: mongoose.model('StockMovement', stockMovementSchema),
  Payment: mongoose.model('Payment', paymentSchema)
};
