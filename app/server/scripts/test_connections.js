import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/lib/db.js';
import Redis from 'ioredis';

async function testAll() {
  console.log('Testing infrastructure connections...');

  // 1. PostgreSQL via Prisma
  try {
    const dbResult = await prisma.$queryRaw`SELECT 1 as test_val`;
    console.log('✅ PostgreSQL connected successfully via Prisma:', dbResult);
  } catch (err) {
    console.error('❌ PostgreSQL connection error with DATABASE_URL:', err.message);
    
    // If failed because host 'db' is unreachable outside Docker, test localhost
    const localDbUrl = process.env.DATABASE_URL?.replace('@db:', '@localhost:').replace('${POSTGRES_USER}', process.env.POSTGRES_USER || 'dialmate').replace('${POSTGRES_PASSWORD}', process.env.POSTGRES_PASSWORD || 'dialmatepassword').replace('${POSTGRES_DB}', process.env.POSTGRES_DB || 'dialmate');
    console.log('Testing fallback to localhost...');
    try {
      const { PrismaClient } = await import('@prisma/client');
      const localPrisma = new PrismaClient({
        datasources: { db: { url: localDbUrl } }
      });
      const localRes = await localPrisma.$queryRaw`SELECT 1 as test_val`;
      console.log('✅ PostgreSQL connected on localhost:', localRes);
      await localPrisma.$disconnect();
    } catch (e2) {
      console.error('❌ Fallback to localhost also failed:', e2.message);
    }
  } finally {
    await prisma.$disconnect();
  }

  // 2. Redis
  const redisHost = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log('Connecting to Redis using:', redisHost.replace(/\/\/.*@/, '//***@'));
  const client = new Redis(redisHost.includes('redis:') ? redisHost.replace('redis:6379', 'localhost:6379') : redisHost);
  try {
    const pong = await client.ping();
    console.log('✅ Redis connected successfully. PING ->', pong);
  } catch (err) {
    console.error('❌ Redis connection error:', err.message);
  } finally {
    client.disconnect();
  }
}

testAll().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
