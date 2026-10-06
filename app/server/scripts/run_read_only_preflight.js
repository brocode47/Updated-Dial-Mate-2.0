/**
 * Phase 1 Read-Only Pre-flight Inspection Script
 * 
 * Inspects all 18 items strictly read-only:
 * - Does NOT modify any DB record
 * - Does NOT make outbound calls or send WhatsApp messages
 * - Does NOT create or delete orders
 * - Does NOT log or expose any credentials/secrets
 */

import { prisma } from '../src/lib/db.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { callQueue, webhookQueue, whatsappQueue, whatsappDeadLetterQueue } from '../src/lib/queues.js';

async function runPreflight() {
  console.log('================================================================');
  console.log('🔍 PHASE 1 — READ-ONLY PRE-FLIGHT AUDIT');
  console.log('================================================================\n');

  const targetTestNumber = '+923333255998';
  const cleanTestDigits = targetTestNumber.replace(/[^0-9]/g, ''); // 923333255998
  const report = {};

  // 1. Environment & Mode
  const rawMode = process.env.AI_WHATSAPP_MODE;
  report.aiWhatsAppMode = rawMode || 'NOT_SET';
  
  const rawAdminNumbers = process.env.ADMIN_TEST_NUMBERS || '';
  const adminList = rawAdminNumbers.split(',').map(n => n.trim()).filter(Boolean);
  const isAuthorized = adminList.some(n => {
    const digits = n.replace(/[^0-9]/g, '');
    return digits === cleanTestDigits || digits.endsWith(cleanTestDigits.slice(-10));
  });
  report.testNumberAuthorized = isAuthorized;
  report.configuredAdminCount = adminList.length;

  // 2. Database & Shop Integrations
  const shops = await prisma.shop.findMany({
    select: { id: true, domain: true, name: true, isActive: true }
  });
  report.shops = shops;

  const targetShop = shops.find(s => s.domain === '0qwck2-s1.myshopify.com') || shops[0];
  report.targetShopDomain = targetShop?.domain || 'NOT_FOUND';
  report.targetShopActive = targetShop?.isActive || false;

  const integrations = await prisma.whatsAppIntegration.findMany({
    include: { shop: { select: { domain: true, isActive: true } } }
  });
  report.whatsAppIntegrations = integrations.map(i => ({
    id: i.id,
    sessionId: i.sessionId,
    shopDomain: i.shop?.domain,
    isActive: i.shop?.isActive ?? true
  }));

  const targetIntegration = integrations.find(i => i.sessionId === '2cmrlo');
  report.hasTargetIntegration = !!targetIntegration;

  // 3. WA-AKG Session Status
  const waClient = new WhatsAppClient();
  let sessionStatusRes = null;
  try {
    sessionStatusRes = await waClient.checkSessionStatus('2cmrlo');
    const isConnected = sessionStatusRes.status === 'CONNECTED' || sessionStatusRes.data?.status === 'CONNECTED';
    report.waSessionStatus = sessionStatusRes.status || 'UNKNOWN';
    report.waSessionConnected = isConnected;
    report.waSessionJid = sessionStatusRes.data?.me?.id || sessionStatusRes.me?.id || 'NOT_FOUND';
    report.webhooksConfigured = sessionStatusRes.data?.webhooks?.map(w => ({
      name: w.name,
      url: w.url,
      events: w.events,
      isActive: w.isActive
    })) || [];
  } catch (err) {
    report.waSessionConnected = false;
    report.waSessionError = err.message;
  }

  // 4. Customer, Order, and Takeover State for Test Number
  const customer = await prisma.customer.findFirst({
    where: {
      phone: { contains: cleanTestDigits.slice(-10) }
    },
    include: {
      conversations: {
        where: { channel: 'WHATSAPP' },
        orderBy: { createdAt: 'desc' },
        take: 1
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 3
      }
    }
  });

  report.customerRecord = {
    exists: !!customer,
    id: customer?.id || null,
    phone: customer?.phone || null,
    shopId: customer?.shopId || null
  };

  const activeConv = customer?.conversations?.[0] || null;
  report.conversationState = {
    exists: !!activeConv,
    id: activeConv?.id || null,
    status: activeConv?.status || null,
    isTakeover: activeConv?.isTakeover || false
  };

  report.recentOrders = (customer?.orders || []).map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    totalAmount: o.totalAmount,
    createdAt: o.createdAt
  }));

  // 5. Queues and Pending Jobs Check
  try {
    const queueMap = {
      whatsappQueue,
      webhookQueue,
      callQueue,
      whatsappDeadLetterQueue
    };
    report.queueStats = {};
    for (const [qName, q] of Object.entries(queueMap)) {
      const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'paused');
      report.queueStats[qName] = counts;
    }
  } catch (err) {
    report.queueError = err.message;
  }

  // 6. Architecture & Flow Specifications (Static Route / Worker Analysis)
  report.architecture = {
    outboundEndpoint: `${waClient.baseUrl}/api/messages/{sessionId}/send`,
    inboundWebhookRoute: '/webhooks/wa-akg (POST with x-hub-signature-256 HMAC)',
    workerQueue: 'whatsappQueue -> WhatsAppAgentService.handleIncomingMessage',
    aiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    aiPersona: 'Zara (Roman Urdu & English)'
  };

  console.log(JSON.stringify(report, null, 2));
}

runPreflight()
  .catch(err => {
    console.error('Fatal preflight error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
