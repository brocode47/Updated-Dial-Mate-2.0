import crypto from 'crypto';
import http from 'http';
import { prisma } from '../src/lib/db.js';

const TEST_PHONE = '923333255998';
const REMOTE_JID = `${TEST_PHONE}@s.whatsapp.net`;
const SESSION_ID = process.env.WA_AKG_SESSION_ID || '2cmrlo';
const WEBHOOK_SECRET = process.env.WA_AKG_WEBHOOK_SECRET;
const API_PORT = process.env.PORT || 8787;
const API_HOST = process.env.API_HOST || '127.0.0.1';

async function dispatchWebhook(messageText, isVoice = false) {
  const messageId = `VOICE_TEST_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const payloadData = isVoice ? {
    key: { id: messageId, remoteJid: REMOTE_JID, fromMe: false },
    type: 'media',
    mediaType: 'audio',
    mimetype: 'audio/ogg; codecs=opus',
    caption: messageText,
    content: messageText,
    promptText: messageText,
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
  await new Promise((resolve, reject) => {
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
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });

  return { messageId, startTime: t0 };
}

async function waitForSpecificReply(startTime, timeoutMs = 20000) {
  const pollStart = Date.now();
  while (Date.now() - pollStart < timeoutMs) {
    const msg = await prisma.message.findFirst({
      where: {
        sender: 'assistant',
        createdAt: { gte: new Date(startTime) }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (msg) {
      const log = await prisma.aIInteractionLog.findFirst({
        where: {
          conversationId: msg.conversationId,
          createdAt: { gte: new Date(startTime - 500) }
        },
        orderBy: { createdAt: 'desc' }
      });
      return { msg, log, elapsedMs: Date.now() - startTime };
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return null;
}

async function run() {
  console.log('--- CLEARING HUMAN TAKEOVER LOCK ---');
  await prisma.conversation.updateMany({
    where: { channel: 'WHATSAPP' },
    data: { isTakeover: false }
  });

  console.log('\n--- TESTING VOICE NOTE 1 (Urdu voice note simulated transcript) ---');
  const v1Text = 'Mera chair protection cover ka price batao aur delivery charges bhi batao.';
  const v1 = await dispatchWebhook(v1Text, true);
  const r1 = await waitForSpecificReply(v1.startTime);
  if (r1) {
    console.log(`✅ VOICE 1 Reply (${r1.elapsedMs}ms): "${r1.msg.text}"`);
    console.log(`   Intent: ${r1.log?.intent || 'N/A'} | Action: ${r1.log?.action || 'N/A'}`);
  } else {
    console.log('❌ VOICE 1 Timeout');
  }

  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- TESTING VOICE NOTE 2 (English/Urdu mixed simulated transcript) ---');
  const v2Text = 'Can you tell me iska total price delivery ke sath?';
  const v2 = await dispatchWebhook(v2Text, true);
  const r2 = await waitForSpecificReply(v2.startTime);
  if (r2) {
    console.log(`✅ VOICE 2 Reply (${r2.elapsedMs}ms): "${r2.msg.text}"`);
    console.log(`   Intent: ${r2.log?.intent || 'N/A'} | Action: ${r2.log?.action || 'N/A'}`);
  } else {
    console.log('❌ VOICE 2 Timeout');
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
