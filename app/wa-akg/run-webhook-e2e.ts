import { PrismaClient } from '@prisma/client';
import { dispatchWebhook, onMessageReceived } from './src/lib/webhook';
import { resolveToPhoneJidBySessionId as resolveToPhoneJid } from './src/lib/jid-utils';

const prisma = new PrismaClient();

async function runTest() {
  console.log('Starting WA-AKG E2E Webhook Test...');

  // 1. Create a dummy user and session if it doesn't exist
  let user = await prisma.user.findFirst({ where: { email: 'e2e@test.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'e2e@test.com',
        name: 'E2E Test User',
        password: 'password123'
      }
    });
  }

  let session = await prisma.session.findUnique({ where: { sessionId: 'e2e-test-session' } });
  if (!session) {
    session = await prisma.session.create({
      data: {
        sessionId: 'e2e-test-session',
        name: 'E2E Test Session',
        status: 'CONNECTED',
        userId: user.id,
      }
    });
  }

  // 2. Register the webhook pointing to Dial Mate
  let webhook = await prisma.webhook.findFirst({
    where: { sessionId: session.id, url: 'http://localhost:8787/webhooks/wa-akg' }
  });
  if (!webhook) {
    webhook = await prisma.webhook.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        name: 'E2E Test Webhook',
        url: 'http://localhost:8787/webhooks/wa-akg',
        secret: 'e2esecret',
        events: ['message.received'],
        isActive: true
      }
    });
  } else {
    // ensure it's active and has right secret
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: { secret: 'e2esecret', isActive: true, events: ['message.received'] }
    });
  }

  console.log('Webhook registered:', webhook.id);

  // 3. Create a synthetic Baileys message object
  const syntheticMessage = {
    key: {
      remoteJid: '923000000000@s.whatsapp.net',
      fromMe: false,
      id: 'E2E_TEST_MSG_TEXT_002'
    },
    message: {
      conversation: 'What is the price of the test product?'
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Test Sender'
  };

  // 4. Trigger onMessageReceived which will normalize and call dispatchWebhook
  console.log('Dispatching synthetic text message...');
  
  await onMessageReceived('e2e-test-session', syntheticMessage);
  
  console.log('Message dispatched to webhook mechanism.');
  console.log('Waiting 3 seconds for async fetch to complete...');
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('Done.');
}

runTest()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
