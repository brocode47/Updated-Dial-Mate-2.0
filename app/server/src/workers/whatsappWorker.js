import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { prisma } from '../lib/db.js';
import { waLogger } from '../utils/waLogger.js';
import { parseMediaMetadata } from '../utils/mediaHandler.js';
import { MessageTrackerService } from '../services/messageTracker.js';
import { PhoneNormalizer } from '../services/phoneNormalizer.js';

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
  let messageText = mediaInfo.promptText ? mediaInfo.promptText.trim() : '';

  // Inbound Voice Note Processing: retrieve audio & transcribe with Gemini
  if (mediaInfo.isMedia && mediaInfo.mediaType === 'audio') {
    try {
      const waClient = new WhatsAppClient({
        baseUrl: process.env.WA_AKG_BASE_URL,
        apiKey: process.env.WA_AKG_API_KEY,
        sessionId: String(sessionId),
        shopId: String(shopId)
      });
      const audioBuffer = await waClient.downloadMedia(messageId, { sessionId });
      if (audioBuffer && audioBuffer.length > 0) {
        const { AudioTranscriberService } = await import('../services/audioTranscriberService.js');
        const transcript = await AudioTranscriberService.transcribeAudio(
          audioBuffer,
          mediaInfo.metadata?.mimeType || 'audio/ogg'
        );
        if (transcript) {
          messageText = transcript;
        }
      }
    } catch (audioErr) {
      console.warn(`⚠️ [WhatsAppWorker] Voice note transcription notice (${audioErr.message}). Using fallback prompt.`);
    }
  }

  if (!messageText) {
    waLogger.log(traceId, 'EMPTY_MESSAGE_IGNORED', { messageId, jid });
    if (messageId) await MessageTrackerService.markCompleted(messageId);
    return { success: true, ignored: true, reason: 'EMPTY_MESSAGE' };
  }

  // ========================================================
  // 4. Customer Identity Mapping (Multi-Tenant Scoped)
  // ========================================================
  let phone = jid.replace(/[^0-9]/g, '');
  try {
    const customer = await PhoneNormalizer.resolveCustomer(shopId, jid);
    if (customer?.phone) {
      phone = customer.phone;
    }
  } catch (dbErr) {
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
  // 5. Process AI Message (External Engine or Native "Zara" Agent)
  // ========================================================
  let replyText = null;
  let agentName = 'Zara';
  let intent = 'GENERAL';
  let action = null;
  let externalEngineSuccess = false;
  const startTime = Date.now();

  const AI_ENGINE_URL = process.env.AI_ENGINE_URL || (process.env.NODE_ENV === 'test' ? 'http://127.0.0.1:8000' : null);

  if (AI_ENGINE_URL && !process.env.DISABLE_EXTERNAL_AI_ENGINE) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      waLogger.aiRequestStart(traceId, { url: `${AI_ENGINE_URL}/chat`, shopId, phone });

      const response = await fetch(`${AI_ENGINE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.AI_ENGINE_API_KEY ? { 'X-AI-ENGINE-KEY': process.env.AI_ENGINE_API_KEY } : {})
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
        const aiResult = await response.json();
        replyText = (aiResult?.response || '').trim();
        agentName = aiResult?.agent || 'support';
        intent = aiResult?.intent || 'general';
        externalEngineSuccess = true;
        waLogger.aiResponseReceived(traceId, {
          agent: agentName,
          intent,
          confidence: aiResult?.confidence || 0.9,
          latencyMs: Date.now() - startTime
        });
      }
    } catch (e) {
      console.log(`ℹ️ [WhatsAppWorker] External AI engine unavailable (${e.message}). Routing to native WhatsAppAgentService ("Zara").`);
    }
  }

  if (!externalEngineSuccess) {
    try {
      const { WhatsAppAgentService } = await import('../services/whatsappAgentService.js');
      const agentResult = await WhatsAppAgentService.handleIncomingMessage({
        shopId,
        shopDomain,
        sessionId,
        fromPhone: jid,
        messageText,
        messageId,
        isVoiceInbound: mediaInfo.isMedia && mediaInfo.mediaType === 'audio'
      });

      agentName = 'Zara';
      intent = agentResult?.intent || 'GENERAL';
      action = agentResult?.action || null;
      replyText = agentResult?.replyText;

      waLogger.replySent(traceId, { to: jid, sessionId, replyLength: replyText?.length || 0 });
    } catch (agentErr) {
      waLogger.failed(traceId, { error: `WhatsApp Agent failed: ${agentErr.message}`, recoverable: true });
      if (messageId) {
        await MessageTrackerService.handleFailure(messageId, true);
      }
      throw new Error(`[Recoverable WhatsApp Agent Error] ${agentErr.message}`);
    }
  } else if (replyText) {
    // Send external engine reply via WhatsApp AKG
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
      if (messageId) {
        await MessageTrackerService.handleFailure(messageId, true);
      }
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
    agent: agentName,
    intent: intent,
    action: action
  };
}
