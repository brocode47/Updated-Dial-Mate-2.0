import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function cleanup() {
  try {
    // Delete integration
    await prisma.whatsAppIntegration.deleteMany({
      where: { sessionId: 'e2e-test-session' }
    });
    console.log('Deleted test integration');

    // Delete shop
    await prisma.shop.deleteMany({
      where: { domain: 'e2e-test-shop.myshopify.com' }
    });
    console.log('Deleted test shop');

    // Delete org
    await prisma.organization.deleteMany({
      where: { name: 'E2E Test Org' }
    });
    console.log('Deleted test org');
  } catch (err) {
    console.error('Cleanup error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
