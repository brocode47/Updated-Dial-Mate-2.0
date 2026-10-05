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
    // Twilio will execute <Connect> and block.

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
    let gracefulHangupTimer = null;

    const clearHangupTimer = () => {
      if (gracefulHangupTimer) {
        clearTimeout(gracefulHangupTimer);
        gracefulHangupTimer = null;
      }
    };

    const scheduleGracefulHangup = (delayMs = 8000) => {
      clearHangupTimer();
      gracefulHangupTimer = setTimeout(() => {
        if (ws.readyState === 1 /* OPEN */) {
          console.log('⏳ Graceful hangup timer expired after terminal action.');
          ws.close();
        }
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
              context: { eventId: msg.start.streamSid, orderId: order.id }, // streamSid & orderId for tenant-isolated tool calls
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
              onClear: () => {
                // Interruption / barge-in triggered:
                // 1. Reset codec resampler buffers to eliminate stale audio
                codec.reset();
                // 2. Inform Twilio to clear its queued audio buffer
                if (ws.readyState === 1 /* OPEN */) {
                  ws.send(JSON.stringify({ event: 'clear', streamSid: streamSid }));
                }
                // 3. If customer barges in, cancel pending hangup timer
                clearHangupTimer();
              },
              onTurnComplete: () => {
                // If a terminal action took place and Zara finished speaking the farewell/acknowledgement,
                // schedule graceful hangup allowing customer an 8s window to ask a follow-up or say goodbye.
                if (terminalToolExecuted) {
                  scheduleGracefulHangup(8000);
                }
              },
              onClose: async (err) => {
                console.log('🛑 Gemini Session Closed', err ? err.message : '');
                clearHangupTimer();
                try {
                  const finalOrder = await prisma.order.findUnique({ where: { id: orderId } });
                  if (finalOrder && finalOrder.status === 'Human Transfer') {
                    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                    await twilioClient.calls(callSid).update({
                      twiml: '<Response><Say>Transferring you to a human agent.</Say><Dial>+923000000000</Dial></Response>'
                    });
                  } else if (finalOrder && finalOrder.status !== 'Confirmed' && finalOrder.status !== 'Cancelled') {
                    // Unexpected drop or error, fallback to TwiML
                    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                    await twilioClient.calls(callSid).update({
                      twiml: '<Response><Say>We are experiencing technical difficulties. We will call you back later.</Say><Hangup/></Response>'
                    });
                  }
                } catch (e) {
                  console.error('Error in Twilio fallback:', e.message);
                }
              },
              onToolExecuted: (toolName, result) => {
                console.log(`🔧 Tool executed in active call: ${toolName}`, result);
                if (['request_human_transfer', 'confirm_order', 'cancel_order', 'schedule_callback'].includes(toolName)) {
                  terminalToolExecuted = toolName;
                  // Fallback safety hangup after 15s if turnComplete is delayed
                  scheduleGracefulHangup(15000);
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
                // Customer is speaking: clear any pending hangup timer
                clearHangupTimer();
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

  return router;
}
