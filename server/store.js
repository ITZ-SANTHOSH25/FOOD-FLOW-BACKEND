const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const models = require('./models');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = ['users', 'products', 'orders', 'inventory', 'batches', 'audits', 'invoices', 'activity', 'boms', 'purchases', 'stockMovements', 'payments'];
const MODEL_MAP = {
  users: models.User,
  products: models.Product,
  orders: models.Order,
  inventory: models.Inventory,
  batches: models.Batch,
  audits: models.Audit,
  invoices: models.Invoice,
  activity: models.Activity,
  boms: models.Bom,
  purchases: models.Purchase,
  stockMovements: models.StockMovement,
  payments: models.Payment
};

let mode = 'file';
let cache = null;
let writeTimer = null;

// A new installation always starts with empty collections. No demo or seed data is generated.
function loadFile() {
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.warn('[store] Could not parse db.json; starting with empty collections:', e.message);
      cache = null;
    }
  }
  if (!cache || typeof cache !== 'object') {
    cache = Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
    persist();
  }
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(cache[collection])) cache[collection] = [];
  }
  return cache;
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
      console.error('[store] persist failed:', e.message);
    }
  }, 60);
}

async function init() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is required. Configure it in Render.');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  mode = 'mongo';
  console.log('[store] Connected to MongoDB. Existing records are preserved; no demo data is inserted.');
  return mode;
}

async function list(collection) {
  if (!MODEL_MAP[collection]) throw new Error(`Unknown collection: ${collection}`);
  if (mode === 'mongo') return MODEL_MAP[collection].find({}).lean();
  return [...loadFile()[collection]];
}

async function get(collection, id) {
  if (!MODEL_MAP[collection]) throw new Error(`Unknown collection: ${collection}`);
  if (mode === 'mongo') return MODEL_MAP[collection].findOne({ id }).lean();
  return loadFile()[collection].find((d) => d.id === id) || null;
}

async function insert(collection, doc) {
  if (!MODEL_MAP[collection]) throw new Error(`Unknown collection: ${collection}`);
  if (mode === 'mongo') {
    const created = await MODEL_MAP[collection].create(doc);
    return created.toObject();
  }
  const db = loadFile();
  db[collection].push(doc);
  persist();
  return doc;
}

async function update(collection, id, patch) {
  if (!MODEL_MAP[collection]) throw new Error(`Unknown collection: ${collection}`);
  if (mode === 'mongo') return MODEL_MAP[collection].findOneAndUpdate({ id }, { $set: patch }, { new: true }).lean();
  const db = loadFile();
  const idx = db[collection].findIndex((d) => d.id === id);
  if (idx === -1) return null;
  db[collection][idx] = { ...db[collection][idx], ...patch };
  persist();
  return db[collection][idx];
}

async function remove(collection, id) {
  if (!MODEL_MAP[collection]) throw new Error(`Unknown collection: ${collection}`);
  if (mode === 'mongo') {
    const res = await MODEL_MAP[collection].findOneAndDelete({ id });
    return !!res;
  }
  const db = loadFile();
  const before = db[collection].length;
  db[collection] = db[collection].filter((d) => d.id !== id);
  persist();
  return db[collection].length < before;
}

async function nextSequence(collection, prefix, width = 4) {
  const rows = await list(collection);
  let max = 0;
  for (const row of rows) {
    const match = String(row.id || '').match(/(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

module.exports = { init, list, get, insert, update, remove, nextSequence, get mode() { return mode; } };
