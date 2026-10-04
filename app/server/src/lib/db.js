import pkg from '@prisma/client';
const { PrismaClient } = pkg;

let dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  dbUrl = dbUrl
    .replace('${POSTGRES_USER}', process.env.POSTGRES_USER || 'dialmate')
    .replace('${POSTGRES_PASSWORD}', process.env.POSTGRES_PASSWORD || 'dialmatepassword')
    .replace('${POSTGRES_DB}', process.env.POSTGRES_DB || 'dialmate');

  if (dbUrl.includes('@db:5432')) {
    dbUrl = dbUrl.replace('@db:5432', '@localhost:5432');
  }
}

export const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);

// Backwards compatibility layer while migrating
let isInitialized = false;

export async function initDb() {
  if (isInitialized) return prisma;
  await prisma.$connect();
  isInitialized = true;
  console.log('✅ PostgreSQL Database connected via Prisma');
  return prisma;
}

export function getDb() {
  if (!isInitialized) {
    console.warn('DB not initialized. Initializing automatically...');
    // We can't make this async if old code expects sync, but old code shouldn't strictly require it 
    // unless they do `await getDb().run(...)` which we'll handle by exposing prisma.
  }
  return prisma;
}

export function now() {
  return Date.now();
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}