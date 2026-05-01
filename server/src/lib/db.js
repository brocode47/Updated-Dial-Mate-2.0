/* __imports_rewritten__ */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

export async function initDb() {
  if (db) return db;

  db = await open({
    filename: './data.sqlite',
    driver: sqlite3.Database
  });

  // ===============================
  // 📦 ORDERS TABLE
  // ===============================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      shop TEXT,
      shopifyOrderGid TEXT,
      payload TEXT,
      status TEXT,
      tag TEXT,
      riskScore REAL,
      retryCount INTEGER DEFAULT 0,
      callStatus TEXT DEFAULT 'pending',
      callSid TEXT,
      lastCallAt INTEGER,
      createdAt INTEGER,
      updatedAt INTEGER
    )
  `);

  // ✅ Add missing columns safely for old database
  // ✅ Add missing columns safely for old database
try {
  await db.exec(`ALTER TABLE orders ADD COLUMN callStatus TEXT DEFAULT 'pending'`);
} catch (err) {}

try {
  await db.exec(`ALTER TABLE orders ADD COLUMN callSid TEXT`);
} catch (err) {}



try {
await db.exec(`ALTER TABLE orders ADD COLUMN shopifyOrderGid TEXT`);
} catch (err) {}

  // ===============================
  // 📞 CALLS TABLE
  // ===============================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      shop TEXT,
      orderId TEXT,
      outcome TEXT,
      intent TEXT,
      sentiment TEXT,
      durationSec INTEGER,
      recordingUrl TEXT,
      transcript TEXT,
      providerCallSid TEXT,
      createdAt INTEGER
    )
  `);

  // ===============================
  // 🛡️ COMPLIANCE LOGS
  // ===============================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_logs (
      id TEXT PRIMARY KEY,
      shop TEXT,
      event TEXT,
      detail TEXT,
      createdAt INTEGER
    )
  `);

  // ===============================
  // 🏪 SHOPS TABLE
  // ===============================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      shop TEXT PRIMARY KEY,
      accessToken TEXT,
      installedAt INTEGER
    )
  `);


  console.log('✅ Database initialized');

  return db;
}

// ===============================
// 📦 GET DB
// ===============================
export function getDb() {
  if (!db) {
    throw new Error('DB not initialized. Call initDb() first.');
  }
  return db;
}

// ===============================
// ⏱️ TIME HELPER
// ===============================
export function now() {
  return Date.now();
}

// ===============================
// 🆔 ID GENERATOR
// ===============================
export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}