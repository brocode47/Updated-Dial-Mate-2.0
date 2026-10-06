/**
 * Dial Mate 2.0 — Controlled Live WhatsApp Verification Runner
 * 
 * Production Safety:
 * - Uses ONLY authorized test phone +923333255998
 * - Injects authentic HMAC-signed webhooks to /webhooks/wa-akg
 * - Monitors production BullMQ worker and persists real responses
 * - Zero new Shopify orders created
 * - Zero phone calls placed
 * - Zero unsolicited customer messages
 */

import crypto from 'crypto';
import http from 'http';

import { prisma } from '../src/lib/db.js';

const TEST_PHONE = '923333255998';
const REMOTE_JID = `${TEST_PHONE}@s.whatsapp.net`;
const SESSION_ID = process.env.WA_AKG_SESSION_ID || '2cmrlo';
const WEBHOOK_SECRET = process.env.WA_AKG_WEBHOOK_SECRET;
const API_PORT = process.env.PORT || 8787;
const API_HOST = process.env.API_HOST || '127.0.0.1';

if (!WEBHOOK_SECRET) {
  console.error('❌ WA_AKG_WEBHOOK_SECRET is required to sign webhook payloads.');
  process.exit(1);
}

const TEST_CASES = [
  { id: 'TEST_1', text: 'mera order kya hai?', type: 'text', description: 'Order summary / lookup' },
  { id: 'TEST_2', text: 'mera last order ka number batao', type: 'text', description: 'Latest order number' },
  { id: 'TEST_3', text: 'mere order ka status kya hai?', type: 'text', description: 'Order status check' },
  { id: 'TEST_4', text: 'chair protection cover', type: 'text', description: 'Product search / initial establishment' },
  { id: 'TEST_5', text: 'iski price batao', type: 'text', description: 'Contextual price resolution (iski)' },
  { id: 'TEST_6', text: 'delivery charges?', type: 'text', description: 'Delivery fee for active product' },
  { id: 'TEST_7', text: 'iska total kitna banega?', type: 'text', description: 'Total price calculation (product + shipping)' },
  { id: 'TEST_8', text: 'iska link bhejo', type: 'text', description: 'Product storefront URL resolution' },
  { id: 'TEST_9', text: 'aur products dikhao', type: 'text', description: 'Pagination / catalog browsing' },
  { id: 'TEST_10', text: 'mujhe kharaton se pareshani hoti hai', type: 'text', description: 'Semantic problem recommendation (snoring)' },
  { id: 'TEST_11', text: 'mujhse friendship karogy or not?', type: 'text', description: 'Social / persona chit-chat' },
  { id: 'TEST_12', text: 'Mujhe apne order status ke barey main information required hai', type: 'text', description: 'Formal mixed-language order status' },
  { id: 'TEST_13', text: 'parsal kab ayega?', type: 'text', description: 'Phonetic misspelling delivery inquiry (parsal)' },
  { id: 'TEST_14', text: 'delivry kb hogi?', type: 'text', description: 'SMS abbreviation shipping timing (delivry kb)' },
  { id: 'TEST_15', text: 'cnfrm krdo', type: 'text', description: 'Confirmation intent guard' },
  { id: 'TEST_16', text: 'cancel nahi karna', type: 'text', description: 'Negation guard against destructive cancel' },
  { id: 'TEST_17', text: 'mujhe real person se baat karni hai', type: 'text', description: 'Human escalation with owner WhatsApp alert' },
  // Phase 3 Voice Note simulation
  {
    id: 'VOICE_1',
    text: 'Mera chair protection cover ka price batao aur delivery charges bhi batao.',
    type: 'voice',
    description: 'Urdu voice note simulated transcript'
  },
  {
    id: 'VOICE_2',
    text: 'Can you tell me iska total price delivery ke sath?',
    type: 'voice',
    description: 'Mixed Urdu/English voice note simulated transcript'
  }
];

async function dispatchWebhook(messageText, isVoice = false) {
  const messageId = `PROD_LIVE_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  const payloadData = isVoice ? {
    key: { id: messageId, remoteJid: REMOTE_JID, fromMe: false },
    type: 'media',
    mediaType: 'audio',
    mimetype: 'audio/ogg; codecs=opus',
    caption: '',
    promptText: messageText,
    content: messageText,
    message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } }
  } : {
    key: { id: messageId, remoteJid: REMOTE_JID, fromMe: false },
    type: 'conversation',
    content: messageText,
    message: { conversation: messageText }
  };

  const payload = {
    event: 'message.received',
    sessionId: SESSION_ID,
    data: payloadData
  };

  const rawBody = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

  const t0 = Date.now();

  const webhookAck = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: '/webhooks/wa-akg',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        'x-webhook-signature': signature
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, latencyMs: Date.now() - t0 }));
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });

  return { messageId, webhookAck, startTime: t0 };
}

async function waitForReply(messageText, startTime, convId, timeoutMs = 25000) {
  const pollStart = Date.now();
  while (Date.now() - pollStart < timeoutMs) {
    const msg = await prisma.message.findFirst({
      where: {
        ...(convId ? { conversationId: convId } : {}),
        sender: 'assistant',
        createdAt: { gte: new Date(startTime - 2000) }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (msg) {
      const log = await prisma.aIInteractionLog.findFirst({
        where: {
          conversationId: msg.conversationId,
          createdAt: { gte: new Date(startTime - 2000) }
        },
        orderBy: { createdAt: 'desc' }
      });
      return { log: log || {}, msg, elapsedMs: Date.now() - startTime };
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return null;
}

async function run() {
  console.log('========================================================================');
  console.log('🚀 DIAL MATE 2.0 — CONTROLLED LIVE PRODUCTION VERIFICATION');
  console.log(`Target Phone: +${TEST_PHONE} | Session: ${SESSION_ID}`);
  console.log('========================================================================\n');

  // Resolve customer and conversation, clear any stale human takeover
  const customer = await prisma.customer.findFirst({
    where: { phone: { contains: TEST_PHONE } }
  });
  let conv = await prisma.conversation.findFirst({
    where: {
      channel: 'WHATSAPP',
      ...(customer?.id ? { customerId: customer.id } : {})
    }
  });

  if (conv) {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { isTakeover: false }
    });
    console.log(`ℹ️ Cleared stale human takeover for conversation ${conv.id}\n`);
  }

  const results = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`------------------------------------------------------------------------`);
    console.log(`▶ [${tc.id}] ${tc.description}`);
    console.log(`  Customer: "${tc.text}" [Type: ${tc.type}]`);

    try {
      const { messageId, webhookAck, startTime } = await dispatchWebhook(tc.text, tc.type === 'voice');
      if (webhookAck.statusCode !== 200) {
        console.error(`  ❌ Webhook failed: HTTP ${webhookAck.statusCode}`);
        results.push({ ...tc, status: 'FAIL', reason: `HTTP ${webhookAck.statusCode}` });
        continue;
      }

      const reply = await waitForReply(tc.text, startTime, conv?.id);
      if (!reply) {
        console.error(`  ❌ Timeout waiting for reply (${tc.id})`);
        results.push({ ...tc, status: 'TIMEOUT' });
        continue;
      }

      console.log(`  🤖 Zara Reply (${reply.elapsedMs}ms total, AI: ${reply.log.responseTimeMs || 0}ms):`);
      console.log(`     "${reply.msg.text.replace(/\\n/g, '\n     ')}"`);
      console.log(`  Intent: ${reply.log.intent || 'N/A'} | Action: ${reply.log.action || 'N/A'} | Model: ${reply.log.modelUsed || 'N/A'}`);

      results.push({
        ...tc,
        status: 'PASS',
        replyText: reply.msg.text,
        intent: reply.log.intent || 'N/A',
        action: reply.log.action || 'N/A',
        totalLatencyMs: reply.elapsedMs,
        aiLatencyMs: reply.log.responseTimeMs || 0
      });

      // If this was human escalation test, reset takeover flag so next tests can proceed
      if (tc.id === 'TEST_17' && conv) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { isTakeover: false }
        });
        console.log(`  ℹ️ Released human takeover for subsequent tests.`);
      }

    } catch (err) {
      console.error(`  ❌ Error executing ${tc.id}:`, err.message);
      results.push({ ...tc, status: 'ERROR', error: err.message });
    }

    // Brief pause between conversational turns to maintain order
    await new Promise(r => setTimeout(r, 1200));
  }


  console.log('\n========================================================================');
  console.log('📊 VERIFICATION RUN SUMMARY');
  console.log('========================================================================\n');

  console.log(JSON.stringify(results, null, 2));

  return results;
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
