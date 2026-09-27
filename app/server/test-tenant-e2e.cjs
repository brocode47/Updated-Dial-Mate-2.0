const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function setup() {
  const org = await prisma.organization.upsert({
    where: { id: 'org-e2e' },
    update: {},
    create: { id: 'org-e2e', name: 'E2E Org' }
  });
  
  const shop = await prisma.shop.upsert({
    where: { domain: 'e2e-test-shop.myshopify.com' },
    update: { isActive: true },
    create: {
      domain: 'e2e-test-shop.myshopify.com',
      isActive: true,
      organizationId: org.id
    }
  });

  const integration = await prisma.whatsAppIntegration.findFirst({
    where: { sessionId: 'e2e-test-session' }
  });

  if (!integration) {
    await prisma.whatsAppIntegration.create({
      data: {
        shopId: shop.id,
        sessionId: 'e2e-test-session',
        provider: 'WA_AKG',
        isActive: true
      }
    });
    console.log('Integration seeded');
  } else {
    await prisma.whatsAppIntegration.update({
      where: { id: integration.id },
      data: { isActive: true, provider: 'WA_AKG' }
    });
    console.log('Integration updated');
  }
}
setup().catch(console.error).finally(() => prisma.$disconnect());
