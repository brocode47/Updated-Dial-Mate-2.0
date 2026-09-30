import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { prisma } from '../lib/db.js';
import { waLogger } from '../utils/waLogger.js';
import { parseMediaMetadata } from '../utils/mediaHandler.js';
import { MessageTrackerService } from '../services/messageTracker.js';

/**
 * Hardened WhatsApp BullMQ Worker
 * 
 * Production Guarantees:
 * - Multi-tenant isolation: every operation scoped strictly by shopId + sessionId
 * - Idempotency: message_id tracking prevents duplicate processing and duplicate replies
 * - Media preparation: extracts image, voice note, and document metadata
 * - BullMQ retry policy:
 *     - Recoverable errors (AI Engine unavailable/timeout, WA-AKG network failure) throw to trigger retries
 *     - Unrecoverable errors (invalid payload, group chat, empty content) complete gracefully
 * - Structured lifecycle observability with traceId
 */
export async function processWhatsAppJob(job) {
  const { shopDomain, payload } = job.data;
  let shopId = job.data.shopId;
  const sessionId = job.data.sessionId;
  const traceId = job.data.traceId || payload?.key?.id || `trace-${Date.now()}`;

  // ========================================================
  // 1. Unrecoverable Validation & Filtering
  // ========================================================
  if (!payload || !payload.key) {
    waLogger.failed(traceId, { reason: 'INVALID_PAYLOAD' });
    return { success: true, ignored: true, reason: 'INVALID_PAYLOAD' };
  }

  // Filter bot's own outbound messages (echoes)
  if (payload.key.fromMe) {
    return { success: true, ignored: true, reason: 'FROM_ME_ECHO' };
  }

  // Filter group messages
  const jid = payload.key.remoteJid;
  if (!jid || jid.includes('@g.us') || payload.isGroup) {
    return { success: true, ignored: true, reason: 'GROUP_MESSAGE' };
  }

  // Resolve shopId if missing
  if (!shopId && shopDomain) {
    try {
      if (prisma.shop?.findUnique) {
        const shop = await prisma.shop.findUnique({
          where: { domain: shopDomain }
        });
        if (shop) shopId = shop.id;
      }
    } catch (e) {
      console.warn(`⚠️ [WhatsAppWorker] Shop lookup error:`, e.message);
    }
    if (!shopId) shopId = shopDomain;
  }

  if (!shopId || !sessionId) {
    waLogger.failed(traceId, { reason: 'MISSING_TENANT_OR_SESSION', shopId, sessionId });
    return { success: false, ignored: true, reason: 'MISSING_TENANT_OR_SESSION' };
  }

  const messageId = payload.key.id;

  // ========================================================
  // 2. Database-safe Message Deduplication
  // ========================================================
  if (messageId) {
    const alreadyProcessed = await MessageTrackerService.isAlreadyProcessed(messageId);
    if (alreadyProcessed) {
      waLogger.log(traceId, 'DUPLICATE_SKIPPED', { messageId, shopId, sessionId });
      return { success: true, duplicate: true, messageId };
    }
    // Mark processing
    await MessageTrackerService.markProcessing(messageId, { shopId, sessionId });
  }

  // ========================================================
  // 3. Media Metadata Preparation & Prompt Resolution
  // ========================================================
  const mediaInfo = parseMediaMetadata(payload);
  const messageText = mediaInfo.promptText ? mediaInfo.promptText.trim() : '';

  if (!messageText) {
    waLogger.log(traceId, 'EMPTY_MESSAGE_IGNORED', { messageId, jid });
    if (messageId) await MessageTrackerService.markCompleted(messageId);
    return { success: true, ignored: true, reason: 'EMPTY_MESSAGE' };
  }

  // ========================================================
  // 4. Customer Identity Mapping (Multi-Tenant Scoped)
  // ========================================================
  const phone = jid.replace(/[^0-9]/g, '');
  try {
    const existingCustomer = await prisma.customer.findFirst({
      where: { shopId, phone }
    });
    if (!existingCustomer) {
      await prisma.customer.create({
        data: { shopId, phone }
      }).catch(() => {});
    }
  } catch (dbErr) {
    // Non-fatal warning; Python AI Engine also verifies/creates customer context
    console.warn(`[WhatsAppWorker] Customer identity map notice:`, dbErr.message);
  }

  waLogger.received(traceId, {
    shopId,
    shopDomain,
    sessionId,
    phone,
    isMedia: mediaInfo.isMedia,
    mediaType: mediaInfo.mediaType
  });

  // ========================================================
  // 5. Call Python AI Engine (5-Second Timeout Protection)
  // ========================================================
  const AI_ENGINE_URL = (process.env.AI_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const AI_ENGINE_API_KEY = process.env.AI_ENGINE_API_KEY || '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  let aiResult = null;
  const startTime = Date.now();

  try {
    waLogger.aiRequestStart(traceId, { url: `${AI_ENGINE_URL}/chat`, shopId, phone });

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
      aiResult = await response.json();
      const latencyMs = Date.now() - startTime;
      waLogger.aiResponseReceived(traceId, {
        agent: aiResult.agent,
        intent: aiResult.intent,
        confidence: aiResult.confidence,
        latencyMs
      });
    } else {
      // HTTP 5xx or server failure from AI engine is a recoverable error
      throw new Error(`AI Engine HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (apiErr) {
    clearTimeout(timeoutId);
    const isTimeout = apiErr.name === 'AbortError';
    const errMessage = isTimeout ? 'AI Engine timeout exceeded 5000ms' : apiErr.message;
    waLogger.failed(traceId, { error: errMessage, recoverable: true });

    // Release message lock so retry attempt can execute
    if (messageId) {
      await MessageTrackerService.handleFailure(messageId, true);
    }

    // Recoverable error: throw so BullMQ applies exponential backoff retry policy
    throw new Error(`[Recoverable AI Error] ${errMessage}`);
  }

  // ========================================================
  // 6. Send Reply via WhatsApp AKG (Tenant-Scoped Session)
  // ========================================================
  const replyText = (aiResult?.response || '').trim();
  if (replyText) {
    // Multi-tenant client instantiated strictly with the tenant's sessionId
    const waClient = new WhatsAppClient({
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY,
      sessionId: String(sessionId),
      shopId: String(shopId)
    });

    try {
      await waClient.sendMessage(jid, replyText, {
        quotedMessageId: messageId || undefined
      });
      waLogger.replySent(traceId, { to: jid, sessionId, replyLength: replyText.length });
    } catch (waErr) {
      waLogger.failed(traceId, { error: `WA-AKG delivery failed: ${waErr.message}`, recoverable: true });

      // Release message lock so retry attempt can execute
      if (messageId) {
        await MessageTrackerService.handleFailure(messageId, true);
      }

      // Recoverable error: throw so BullMQ retries
      throw new Error(`[Recoverable WA-AKG Error] ${waErr.message}`);
    }
  }

  // ========================================================
  // 7. Mark Message Completed
  // ========================================================
  if (messageId) {
    await MessageTrackerService.markCompleted(messageId, { shopId, sessionId });
  }

  return {
    success: true,
    messageId,
    traceId,
    agent: aiResult?.agent,
    intent: aiResult?.intent
  };
}
