import pkg from '@prisma/client';
const { PrismaClient } = pkg;

export const prisma = new PrismaClient();

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