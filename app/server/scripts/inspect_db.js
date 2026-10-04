import dotenv from 'dotenv';
dotenv.config();

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

let dbUrl = process.env.DATABASE_URL || 'postgresql://dialmate:dialmatepassword@localhost:5432/dialmate';
dbUrl = dbUrl
  .replace('${POSTGRES_USER}', process.env.POSTGRES_USER || 'dialmate')
  .replace('${POSTGRES_PASSWORD}', process.env.POSTGRES_PASSWORD || 'dialmatepassword')
  .replace('${POSTGRES_DB}', process.env.POSTGRES_DB || 'dialmate')
  .replace('@db:', '@localhost:');

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

async function inspectDb() {
  try {
    const shops = await prisma.shop.findMany();
    console.log(`Shops:`, shops.map(s => ({ id: s.id, domain: s.domain, name: s.name })));

    const testNumber = process.env.ADMIN_TEST_NUMBERS?.trim();
    console.log('ADMIN_TEST_NUMBERS configured:', !!testNumber);

    const customers = await prisma.customer.findMany();
    console.log(`Customers count:`, customers.length);

    const orders = await prisma.order.findMany({
      include: { customer: true, calls: true }
    });
    console.log(`Orders count:`, orders.length);

    const calls = await prisma.call.findMany();
    console.log(`Calls count:`, calls.length);
  } catch (err) {
    console.error('Database query error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

inspectDb();
