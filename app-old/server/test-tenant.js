import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    // Ensure test organization
    let org = await prisma.organization.findFirst({ where: { name: 'E2E Test Org' } });
    if (!org) {
      org = await prisma.organization.create({
        data: { name: 'E2E Test Org' }
      });
      console.log('Created test organization:', org.name);
    } else {
      console.log('Found existing test organization');
    }

    // Check if test shop exists
    let shop = await prisma.shop.findUnique({ where: { domain: 'e2e-test-shop.myshopify.com' } });
    
    if (!shop) {
      shop = await prisma.shop.create({
        data: {
          domain: 'e2e-test-shop.myshopify.com',
          accessToken: 'fake-token',
          isActive: true,
          organizationId: org.id
        }
      });
      console.log('Created test shop:', shop.domain);
    } else {
      console.log('Found existing test shop:', shop.domain);
    }

    // Check if WhatsApp integration exists
    let integration = await prisma.whatsAppIntegration.findUnique({
      where: {
        provider_sessionId: {
          provider: 'WA_AKG',
          sessionId: 'e2e-test-session'
        }
      }
    });

    if (!integration) {
      integration = await prisma.whatsAppIntegration.create({
        data: {
          shopId: shop.id,
          provider: 'WA_AKG',
          sessionId: 'e2e-test-session',
          isActive: true
        }
      });
      console.log('Created test integration:', integration.sessionId);
    } else {
      console.log('Found existing test integration:', integration.sessionId);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
