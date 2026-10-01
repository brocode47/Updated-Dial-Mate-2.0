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

    const VoiceResponse = twilio.twiml.VoiceResponse;

    const customerName = clean(req.query.name, 'Customer');
    const productName = clean(req.query.product, 'your product');
    const productPrice = clean(req.query.price, '0');
    const orderNumber = clean(req.query.orderNumber, '');
    const orderId = req.query.orderId || '';
    const callSid = req.body?.CallSid || req.query?.CallSid;

    const host = req.headers.host;
    const wsUrl = `wss://${host}/twilio/media`;

    const response = new VoiceResponse();

    // Start a stream and pass the context as parameters
    const connect = response.connect();
    const stream = connect.stream({ url: wsUrl });
    stream.parameter({ name: 'orderId', value: orderId });
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
    let agent = null;
    let codec = new AudioCodec();

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
            callSid = params.callSid;

            if (!verifyWSToken(orderId, callSid, params.token)) {
              console.error('❌ Unauthorized WebSocket connection attempt');
              ws.close();
              return;
            }

            console.log(`🚀 Starting Live Session for Order: ${orderId}`);

            const order = await prisma.order.findUnique({ where: { id: orderId }, include: { shop: true } });
            if (!order) {
              console.error('❌ Order not found');
              ws.close();
              return;
            }

            const { CallScriptEngine } = await import('../services/callScriptEngine.js');
            const shopName = order.shop.name || order.shop.domain.replace('.myshopify.com', '');
            const customerName = params.customerName || (order.customerFirstName ? `${order.customerFirstName} ${order.customerLastName || ''}`.trim() : 'Customer');
            const productName = params.productName || order.lineItemsSummary || 'Store Items';
            const productPrice = params.productPrice || (order.totalPrice ? String(order.totalPrice) : '0');
            const orderNumber = params.orderNumber || order.orderNumber || '';

            const systemInstruction = CallScriptEngine.compileGeminiSystemInstruction({
              agentName: 'Zara',
              shopName,
              customerName,
              orderNumber,
              productName,
              productPrice
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
                if (ws.readyState === 1 /* OPEN */) {
                  ws.send(JSON.stringify({ event: 'clear', streamSid: streamSid }));
                }
              },
              onClose: async (err) => {
                console.log('🛑 Gemini Session Closed', err ? err.message : '');
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
                // If a terminal action occurred, allow Gemini a few seconds to speak, then hang up
                if (['request_human_transfer', 'confirm_order', 'cancel_order'].includes(toolName)) {
                  setTimeout(() => {
                    if (ws.readyState === 1 /* OPEN */) {
                      ws.close();
                    }
                  }, 4000); // 4 seconds for goodbye message
                }
              }
            });

            const initialContext = `Order ID: ${orderId}, Customer: ${customerName}, Product: ${productName}, Price: ${productPrice}`;
            await agent.connect(initialContext);
            agent.startConversation(`The customer ${customerName} has answered the phone call. Please speak your opening greeting now in Roman Urdu according to Step 1.`);
            break;

          case 'media':
            if (agent) {
              const pcm16 = codec.twilioToGemini(msg.media.payload);
              if (pcm16) {
                agent.sendAudio(pcm16);
              }
            }
            break;

          case 'stop':
            console.log('🛑 Twilio Media Stream Stopped');
            if (agent) agent.close();
            break;
        }
      } catch (err) {
        console.error('❌ WS message error:', err);
      }
    });

    ws.on('close', () => {
      console.log('🔌 Twilio Media WebSocket Disconnected');
      if (agent) agent.close();
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

    try {
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
            callStatus,
            durationSec,
            recordingUrl
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
