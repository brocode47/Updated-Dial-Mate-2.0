import express from 'express';
import twilio from 'twilio';
import crypto from 'crypto';
import { prisma } from '../lib/db.js';
import { CallStateService } from '../services/callState.js';
import { callQueue } from '../lib/queues.js';
import { AudioCodec } from '../utils/audioCodec.js';

export function twilioRouter() {
  const router = express.Router();

  const clean = (value, fallback = '') =>
    String(value || fallback)
      .replace(/&/g, 'and')
      .replace(/</g, '')
      .replace(/>/g, '')
      .replace(/"/g, '')
      .replace(/'/g, '');

  // Helper to generate a secure token for WS verification
  const generateWSToken = (orderId, callSid) => {
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    return crypto.createHmac('sha256', secret).update(`${orderId}:${callSid}`).digest('hex');
  };

  const verifyWSToken = (orderId, callSid, token) => {
    return generateWSToken(orderId, callSid) === token;
  };

  router.all('/voice', async (req, res) => {
    console.log('🎧 /twilio/voice HIT');

    const VoiceResponse = twilio.twiml.VoiceResponse;    const customerName = clean(req.query.name, 'Customer');
    const productName = clean(req.query.product, 'your product');
    const productPrice = clean(req.query.price, '0');
    const orderNumber = clean(req.query.orderNumber, '');
    const orderId = req.query.orderId || '';
    const callId = req.query.callId || req.body?.callId || '';
    const callSid = req.body?.CallSid || req.query?.CallSid;

    const host = req.headers.host;
    const wsUrl = `wss://${host}/twilio/media`;

    const response = new VoiceResponse();

    // Start a stream and pass the context as parameters
    const connect = response.connect();
    const stream = connect.stream({ url: wsUrl });
    stream.parameter({ name: 'orderId', value: orderId });
    stream.parameter({ name: 'callId', value: callId });
    stream.parameter({ name: 'callSid', value: callSid });
    stream.parameter({ name: 'token', value: generateWSToken(orderId, callSid) });
    stream.parameter({ name: 'customerName', value: customerName });
    stream.parameter({ name: 'productName', value: productName });
    stream.parameter({ name: 'productPrice', value: productPrice });
    stream.parameter({ name: 'orderNumber', value: orderNumber });

    // Optional initial message before connecting stream, but the stream itself is bidirectional.
    // Twilio will execute <Connect> and block. When stream closes, execute Hangup.
    response.hangup();

    res.type('text/xml');
    res.send(response.toString());
  });

  // WebSocket endpoint for Media Streams
  router.ws('/media', (ws, req) => {
    console.log('🔌 Twilio Media WebSocket Connected');

    let streamSid = null;
    let callSid = null;
    let orderId = null;
    let callId = null;
    let agent = null;
    let codec = new AudioCodec();
    let terminalToolExecuted = null;
    let isHangupAuthorized = false;
    let gracefulHangupTimer = null;
    let explicitHangupRequested = false;

    const clearHangupTimer = () => {
      if (gracefulHangupTimer) {
        clearTimeout(gracefulHangupTimer);
        gracefulHangupTimer = null;
      }
    };

    const triggerCarrierHangup = async () => {
      clearHangupTimer();
      if (callSid) {
        try {
          const { CallWorkflowService } = await import('../services/callWorkflowService.js');
          const twilioClient = CallWorkflowService.getTwilioClient();
          if (twilioClient) {
            console.log(`📞 [Twilio:Media] Explicitly terminating Twilio carrier call ${callSid}`);
            await twilioClient.calls(callSid).update({ status: 'completed' });
          }
        } catch (e) {
          console.warn(`⚠️ [Twilio:Media] Notice on carrier call termination: ${e.message}`);
        }
      }
      if (ws.readyState === 1 /* OPEN */) {
        ws.close();
      }
    };

    const scheduleGracefulHangup = (delayMs = 3000) => {
      clearHangupTimer();
      isHangupAuthorized = true;
      console.log(`⏳ [Twilio:Media] Graceful hangup scheduled in ${delayMs}ms`);
      gracefulHangupTimer = setTimeout(() => {
        console.log('⏳ Graceful hangup timer expired. Terminating call.');
        triggerCarrierHangup();
      }, delayMs);
    };

    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);

        switch (msg.event) {
          case 'connected':
            console.log('🔌 Twilio Media Stream Connected');
            break;

          case 'start':
            streamSid = msg.start.streamSid;
            const params = msg.start.customParameters || {};

            orderId = params.orderId;
            callId = params.callId || null;
            callSid = params.callSid;

            if (!verifyWSToken(orderId, callSid, params.token)) {
              console.error('❌ Unauthorized WebSocket connection attempt');
              ws.close();
              return;
            }

            console.log(`🚀 Starting Live Session for Order: ${orderId} (CallId: ${callId})`);

            const order = await prisma.order.findUnique({
              where: { id: orderId },
              include: { shop: true, customer: true }
            });
            if (!order) {
              console.error('❌ Order not found');
              ws.close();
              return;
            }

            const { BusinessGroundingService } = await import('../services/businessGroundingService.js');
            const { CallScriptEngine } = await import('../services/callScriptEngine.js');

            // Build factual business context and strictly sanitize for tenant domain
            const rawContext = BusinessGroundingService.buildBusinessContext({
              order,
              shop: order.shop,
              customer: order.customer
            });

            const sanitizedContext = BusinessGroundingService.sanitizeBusinessContext(rawContext, {
              tenantDomain: order.shop.domain
            });

            // Override customerName / orderNumber if passed explicitly in parameters
            if (params.customerName) sanitizedContext.customerName = params.customerName;
            if (params.orderNumber) sanitizedContext.orderNumber = params.orderNumber;

            const systemInstruction = CallScriptEngine.compileGeminiSystemInstruction({
              agentName: 'Zara',
              ...sanitizedContext
            });

            const { Agent } = await import('../integrations/ai/agent.js');
            agent = new Agent({
              shopDomain: order.shop.domain,
              systemInstruction: systemInstruction,
              context: { eventId: msg.start.streamSid, orderId: order.id, callId }, // streamSid & orderId for tenant-isolated tool calls
              onAudioOut: (pcm16) => {
                if (ws.readyState === 1 /* OPEN */) {
                  const ulawBase64 = codec.geminiToTwilio(pcm16);
                  if (ulawBase64) {
                    ws.send(JSON.stringify({
                      event: 'media',
                      streamSid: streamSid,
                      media: { payload: ulawBase64 }
                    }));
                  }
                }
              },
              onUserTranscription: (text) => {
                const clean = String(text || '').trim().toLowerCase();
                if (!clean) return;

                // Explicit customer demand to cut the call
                if (/\b(cut the call|call cut|call end|band kar do|band karo|hang up|disconnect|phone rakho|phone kaat do)\b/i.test(clean)) {
                  console.log(`🛑 [Twilio:Media] Customer demanded call disconnect: "${clean}"`);
                  explicitHangupRequested = true;
                  isHangupAuthorized = true;
                  scheduleGracefulHangup(1500);
                  return;
                }

                // Check if customer is saying farewell vs continuing conversation
                const isFarewell = /\b(allah hafiz|bye|goodbye|auf wiedersehen|tkl office)\b/i.test(clean);
                const hasContinuationIntent = /\b(ek aur|suno|wait|ruko|question|sawal|poochna|lekin|aur|price|kya|kyun|kaise)\b/i.test(clean);

                if (isHangupAuthorized) {
                  if (hasContinuationIntent) {
                    // Customer genuinely re-opens conversation!
                    console.log(`🗣️ [Twilio:Media] Genuine conversation continuation detected: "${clean}". Resuming conversation.`);
                    isHangupAuthorized = false;
                    explicitHangupRequested = false;
                    terminalToolExecuted = null;
                    clearHangupTimer();
                  } else if (isFarewell) {
                    console.log(`👋 [Twilio:Media] Farewell exchanged: "${clean}". Finalizing hangup.`);
                    scheduleGracefulHangup(1500);
                  }
                }
              },
              onAssistantTranscription: (text) => {
                const clean = String(text || '').toLowerCase();
                if (/\b(allah hafiz|goodbye)\b/i.test(clean)) {
                  // Zara expressed farewell
                  isHangupAuthorized = true;
                }
              },
              onClear: () => {
                // Interruption / barge-in triggered:
                // 1. Reset codec resampler buffers to eliminate stale audio
                codec.reset();
                // 2. Inform Twilio to clear its queued audio buffer
                if (ws.readyState === 1 /* OPEN */) {
                  ws.send(JSON.stringify({ event: 'clear', streamSid: streamSid }));
                }
                // 3. If customer barges in before hangup was authorized, clear hangup timer
                if (!isHangupAuthorized) {
                  clearHangupTimer();
                }
              },
              onTurnComplete: () => {
                // If a terminal action took place or hangup is authorized and Zara finished speaking,
                // schedule graceful hangup allowing customer an appropriate window
                if (isHangupAuthorized || terminalToolExecuted) {
                  const delay = explicitHangupRequested ? 1500 : 3000;
                  scheduleGracefulHangup(delay);
                }
              },
              onClose: async (err) => {
                console.log('🛑 Gemini Session Closed', err ? err.message : '');
                clearHangupTimer();
              },
              onToolExecuted: (toolName, result) => {
                console.log(`🔧 Tool executed in active call: ${toolName}`, result);
                if (['request_human_transfer', 'confirm_order', 'cancel_order', 'schedule_callback', 'end_call'].includes(toolName)) {
                  terminalToolExecuted = toolName;
                  isHangupAuthorized = true;
                  if (toolName === 'end_call') {
                    scheduleGracefulHangup(2500);
                  } else {
                    // Fallback safety hangup after 8s if turnComplete is delayed
                    scheduleGracefulHangup(8000);
                  }
                }
              }
            });

            const customerName = sanitizedContext.customerName;
            const shopName = sanitizedContext.shopName;
            const productName = sanitizedContext.productName;
            const productPrice = sanitizedContext.totalPrice;

            const initialContext = `Order ID: ${orderId}, Customer: ${customerName}, Product: ${productName}, Price: ${productPrice}`;
            await agent.connect(initialContext);
            agent.startConversation(`The customer ${customerName} has answered the phone call. Please speak your opening greeting naturally in Roman Urdu as Zara from ${shopName}.`);
            break;

          case 'media':
            if (agent) {
              const pcm16 = codec.twilioToGemini(msg.media.payload);
              if (pcm16) {
                // Stream audio chunk to Gemini Live (note: raw RTP media packets do NOT clear hangup timer)
                agent.sendAudio(pcm16);
              }
            }
            break;

          case 'stop':
            console.log('🛑 Twilio Media Stream Stopped');
            clearHangupTimer();
            if (agent) agent.close();
            break;
        }
      } catch (err) {
        console.error('❌ WS message error:', err);
      }
    });

    ws.on('close', async () => {
      console.log('🔌 Twilio Media WebSocket Disconnected');
      clearHangupTimer();
      if (agent) {
        try {
          const finalTranscript = agent.getFormattedTranscript?.() || '';
          if (finalTranscript && callId) {
            await prisma.call.update({
              where: { id: callId },
              data: { transcript: finalTranscript }
            });
            console.log(`📝 Live Gemini transcript saved to Call ${callId} (${finalTranscript.length} chars)`);
          }
        } catch (e) {
          console.warn('Could not persist final transcript on ws close:', e.message);
        }
        agent.close();
      }
    });
  });

  router.all('/gather', async (req, res) => {
    const { Digits, orderId, callId } = req.query;
    console.log('📞 /twilio/gather received:', { orderId, Digits });

    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: String(orderId) },
        include: { shop: true }
      });

      if (order && order.shop) {
        const { CallWorkflowService } = await import('../services/callWorkflowService.js');
        await CallWorkflowService.handleCallResult({
          orderId: order.id,
          shopDomain: order.shop.domain,
          callId,
          digits: Digits
        });
      }
    }

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    if (Digits === '1') {
      response.say('Shukriya. Aap ka order confirm kar diya gaya hai. Allah Hafiz.');
    } else if (Digits === '2') {
      response.say('Aap ka order cancel kar diya gaya hai. Allah Hafiz.');
    } else {
      response.say('Koi jawab nahi mila. Allah Hafiz.');
    }
    res.type('text/xml');
    res.send(response.toString());
  });

  router.all('/status', async (req, res) => {
    console.log('✅ /twilio/status HIT');

    const orderId = req.query.orderId;
    const callId = req.query.callId;
    const callSid = req.body?.CallSid || req.query.CallSid || '';
    const callStatus = req.body?.CallStatus || req.query.CallStatus || 'unknown';
    const durationSec = parseInt(req.body?.CallDuration || req.query?.CallDuration || '0', 10);
    const recordingUrl = req.body?.RecordingUrl || req.query?.RecordingUrl || null;

    const normalizedStatus = String(callStatus).trim().toLowerCase().replace(/_/g, '-');
    const nonTerminalStatuses = ['initiated', 'ringing', 'queued', 'in-progress'];
    const terminalStatuses = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];

    // Update telemetry: link providerCallSid to call record if available
    if (callId && callSid) {
      await prisma.call.update({
        where: { id: callId },
        data: { providerCallSid: callSid }
      }).catch(() => {});
    }

    if (nonTerminalStatuses.includes(normalizedStatus) || !terminalStatuses.includes(normalizedStatus)) {
      console.log(`ℹ️ [TwilioStatus] Intermediate status [${callStatus}] for Order ${orderId || 'N/A'}. Skipping terminal outcome handling.`);
      return res.sendStatus(200);
    }

    try {
      if (orderId) {
        const order = await prisma.order.findUnique({
          where: { id: String(orderId) },
          include: { shop: true }
        });

        if (order && order.shop) {
          let callTranscript = null;
          if (callId) {
            const callRecord = await prisma.call.findUnique({ where: { id: callId } });
            callTranscript = callRecord?.transcript;
          }

          const { CallWorkflowService } = await import('../services/callWorkflowService.js');
          await CallWorkflowService.handleCallResult({
            orderId: order.id,
            shopDomain: order.shop.domain,
            callId,
            callStatus: normalizedStatus,
            durationSec,
            recordingUrl,
            transcript: callTranscript || undefined
          });
        }
      }
    } catch (err) {
      console.error('❌ Call status processing failed:', err.message);
    }

    return res.sendStatus(200);
  });

  router.all('/recording-status', async (req, res) => {
    console.log('🎙️ /twilio/recording-status HIT');

    const orderId = req.query.orderId || req.body?.orderId;
    const callId = req.query.callId || req.body?.callId;
    const callSid = req.body?.CallSid || req.query?.CallSid;
    const recordingUrl = req.body?.RecordingUrl || req.query?.RecordingUrl;
    const recordingSid = req.body?.RecordingSid || req.query?.RecordingSid;
    const recordingStatus = req.body?.RecordingStatus || req.query?.RecordingStatus;

    console.log(`🎙️ [Twilio:Recording] Status: ${recordingStatus}, Sid: ${recordingSid}, Url: ${recordingUrl}, CallId: ${callId}, CallSid: ${callSid}`);

    const effectiveRecordingUrl = recordingUrl || (recordingSid && process.env.TWILIO_ACCOUNT_SID
      ? `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}`
      : null);

    if (effectiveRecordingUrl) {
      try {
        let call = null;
        if (callId) {
          call = await prisma.call.findUnique({ where: { id: String(callId) } });
        }
        if (!call && callSid) {
          call = await prisma.call.findFirst({
            where: { providerCallSid: String(callSid) },
            orderBy: { createdAt: 'desc' }
          });
        }

        if (call) {
          await prisma.call.update({
            where: { id: call.id },
            data: { recordingUrl: effectiveRecordingUrl }
          });

          const { CallRecordingRetentionService } = await import('../services/callRecordingRetentionService.js');
          await CallRecordingRetentionService.enforceRetention({ shopId: call.shopId });
        }
      } catch (err) {
        console.error('❌ [Twilio:Recording] Failed to process recording status:', err.message);
      }
    }

    return res.sendStatus(200);
  });

  return router;
}
