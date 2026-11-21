const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const models = require('./models');
const { buildSeed } = require('./seed-data');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = ['users', 'products', 'orders', 'inventory', 'batches', 'audits', 'invoices', 'activity'];
const MODEL_MAP = {
  users: models.User,
  products: models.Product,
  orders: models.Order,
  inventory: models.Inventory,
  batches: models.Batch,
  audits: models.Audit,
  invoices: models.Invoice,
  activity: models.Activity
};

let mode = 'file';
let cache = null;
let writeTimer = null;

function loadFile() {
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.warn('[store] Could not parse db.json, reseeding:', e.message);
      cache = null;
    }
  }
  if (!cache) {
    cache = buildSeed();
    persist();
  }
  for (const c of COLLECTIONS) if (!Array.isArray(cache[c])) cache[c] = [];
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
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required. Configure it in Render.');
  }

  // Do not silently fall back to a temporary local file store on Render.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  mode = 'mongo';
  console.log('[store] Connected to MongoDB');

  // Ensure the application starts with its operational reference data, but
  // never create demo login identities. Users must register their own accounts.
  const count = await models.Product.countDocuments();
  if (count === 0) {
    const seed = buildSeed();
    for (const c of COLLECTIONS) {
      if (c !== 'users' && seed[c] && seed[c].length) {
        await MODEL_MAP[c].insertMany(seed[c]);
      }
    }
    console.log('[store] Seeded MongoDB with operational reference data (no demo users)');
  }
  return mode;
}

async function list(collection) {
  if (mode === 'mongo') return MODEL_MAP[collection].find({}).lean();
  return [...loadFile()[collection]];
}

async function get(collection, id) {
  if (mode === 'mongo') return MODEL_MAP[collection].findOne({ id }).lean();
  return loadFile()[collection].find((d) => d.id === id) || null;
}

async function insert(collection, doc) {
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
  if (mode === 'mongo') {
    return MODEL_MAP[collection].findOneAndUpdate({ id }, { $set: patch }, { new: true }).lean();
  }
  const db = loadFile();
  const idx = db[collection].findIndex((d) => d.id === id);
  if (idx === -1) return null;
  db[collection][idx] = { ...db[collection][idx], ...patch };
  persist();
  return db[collection][idx];
}

async function remove(collection, id) {
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
  for (const r of rows) {
    const m = String(r.id || '').match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

module.exports = { init, list, get, insert, update, remove, nextSequence, get mode() { return mode; } };
