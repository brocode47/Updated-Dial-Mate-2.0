import dotenv from 'dotenv';
dotenv.config();

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const dbUrl = 'postgresql://dialmate:dialmatepassword@localhost:5432/dialmate';
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function check() {
  const rawNums = process.env.ADMIN_TEST_NUMBERS || '';
  const nums = rawNums.split(',').map(s => s.trim()).filter(Boolean);
  console.log('Total whitelisted test numbers in ADMIN_TEST_NUMBERS:', nums.length);

  for (const num of nums) {
    const masked = num.length > 4 ? '*'.repeat(num.length - 4) + num.slice(-4) : '***';
    const cust = await prisma.customer.findFirst({ where: { phone: num } });
    const ord = await prisma.order.findFirst({
      where: {
        customer: { phone: num }
      },
      include: { customer: true }
    });
    console.log(`Number ${masked} -> Customer: ${cust ? cust.id : 'NONE'}, Order: ${ord ? ord.orderNumber : 'NONE'}`);
    if (ord) {
      console.log('Order Details:', {
        id: ord.id,
        orderNumber: ord.orderNumber,
        status: ord.status,
        callStatus: ord.callStatus,
        totalAmount: ord.totalAmount
      });
    }
  }
  await prisma.$disconnect();
}

check();
