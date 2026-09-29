import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { prisma } from '../lib/db.js';

const waClient = new WhatsAppClient();

/**
 * Process inbound WhatsApp message:
 * WhatsApp Message → BullMQ Worker → Python AI Engine (POST /chat) → Send Response
 * 
 * Features:
 * - 5-second AbortController timeout protection
 * - Zero LLM routing in worker (handled deterministically by AI Engine)
 * - Multi-tenant isolation by shopId + customer_phone
 * - Never crashes the BullMQ worker process
 */
export async function processWhatsAppJob(job) {
  const { shopDomain, sessionId, payload } = job.data;
  let shopId = job.data.shopId;

  // payload is from WA-AKG webhook: { key: { id, remoteJid }, content, type, fileUrl }
  const jid = payload.key?.remoteJid;
  const messageType = payload.type;
  let messageText = payload.content || '';

  if (!jid || jid.includes('@g.us')) {
    // Ignore group messages or malformed payloads
    return { success: true, ignored: true };
  }

  console.log(`💬 [WhatsAppWorker] Processing message from ${jid} for shop ${shopDomain}`);

  try {
    // 1. Resolve shopId if missing from job payload
    if (!shopId && shopDomain) {
      const shop = await prisma.shop.findUnique({
        where: { domain: shopDomain }
      });
      if (shop) {
        shopId = shop.id;
      }
    }

    if (!shopId) {
      console.error(`❌ [WhatsAppWorker] Cannot resolve shopId for domain ${shopDomain}`);
      return { success: false, error: 'Shop ID not found' };
    }

    // 2. Extract customer phone from WhatsApp JID
    const phone = jid.split('@')[0];

    // Handle voice / audio notes by signaling voice message text
    if (messageType === 'audioMessage' || messageType === 'voice' || messageType === 'AUDIO') {
      if (!messageText) {
        messageText = "Assalam o Alaikum, main ne voice note bheja hai.";
      }
    }

    if (!messageText || messageText.trim() === '') {
      console.log(`ℹ️ [WhatsAppWorker] Empty message received from ${jid}, skipping.`);
      return { success: true, ignored: true };
    }

    // 3. Call AI Engine API Bridge with 5-second timeout protection
    const AI_ENGINE_URL = (process.env.AI_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const AI_ENGINE_API_KEY = process.env.AI_ENGINE_API_KEY || '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let textResponse = '';

    try {
      console.log(`🚀 [WhatsAppWorker] Calling AI Engine: ${AI_ENGINE_URL}/chat`);
      const response = await fetch(`${AI_ENGINE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AI_ENGINE_API_KEY ? { 'X-AI-ENGINE-KEY': AI_ENGINE_API_KEY } : {})
        },
        body: JSON.stringify({
          shop_id: shopId,
          customer_phone: phone,
          message: messageText
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        textResponse = data.response || '';
        console.log(`✅ [WhatsAppWorker] AI Engine responded: [${data.agent}/${data.intent}] (${data.confidence})`);
      } else {
        console.warn(`⚠️ [WhatsAppWorker] AI Engine returned status ${response.status}`);
        textResponse = "Jee, main aap ki madad ke liye hazir hoon. Aap apna sawal bata dein.";
      }
    } catch (apiErr) {
      clearTimeout(timeoutId);
      const isTimeout = apiErr.name === 'AbortError';
      console.error(`⚠️ [WhatsAppWorker] AI Engine bridge error (${isTimeout ? 'Timeout >5s' : apiErr.message})`);
      textResponse = "Jee, main aap ki madad ke liye hazir hoon. Baraye meherbani apna sawal dobara bhej dein.";
    }

    // 4. Send reply back to WhatsApp
    textResponse = textResponse.trim();
    if (textResponse) {
      console.log(`📤 [WhatsAppWorker] Sending text reply to ${jid}`);
      await waClient.sendMessage(jid, textResponse);
    }

    return { success: true };

  } catch (err) {
    // Catch-all to ensure the BullMQ worker process never crashes
    console.error('❌ [WhatsAppWorker] Fatal job error handled gracefully:', err.message);
    return { success: false, error: err.message };
  }
}
