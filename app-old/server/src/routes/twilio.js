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

            const { Agent } = await import('../integrations/ai/agent.js');
            agent = new Agent({
              shopDomain: order.shop.domain,
              context: { eventId: msg.start.streamSid }, // streamSid serves as a unique eventId for this active session
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

            const initialContext = `Order ID: ${orderId}, Customer: ${params.customerName}, Product: ${params.productName}, Price: ${params.productPrice}`;
            await agent.connect(initialContext);
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

  router.all('/status', async (req, res) => {
    console.log('✅ /twilio/status HIT');

    const orderId = req.query.orderId;
    const callSid = req.body?.CallSid || req.query.CallSid || '';
    const callStatus = req.body?.CallStatus || req.query.CallStatus || 'unknown';

    try {
      if (orderId && callStatus) {
        await prisma.order.update({
          where: { id: orderId },
          data: { callStatus, callSid }
        });

        const order = await prisma.order.findUnique({
          where: { id: orderId }
        });

        if (!order) return res.sendStatus(200);

        if (order.status === 'Confirmed' || order.status === 'Cancelled' || order.status === 'Human Transfer') {
          return res.sendStatus(200);
        }

        const failedStatuses = ['busy', 'failed', 'no-answer'];
        // Note: For live streams, 'completed' without confirmation might also be a drop.
        const shouldRetry =
          failedStatuses.includes(callStatus) ||
          (callStatus === 'completed' && order.status === 'Pending Confirmation');

        if (shouldRetry) {
          const retryCount = order.retryCount || 0;

          if (retryCount >= 2) {
            await prisma.order.update({
              where: { id: orderId },
              data: { tag: 'Max Retries Reached' }
            });
            return res.sendStatus(200);
          }

          await prisma.order.update({
            where: { id: orderId },
            data: { retryCount: retryCount + 1, tag: 'Retry' }
          });

          const payload = JSON.parse(order.payload || '{}');
          const customerName = payload?.shipping_address?.name || payload?.customer?.first_name || 'Customer';
          let phone = payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone || payload?.billing_address?.phone;

          if (phone) {
            if (!phone.startsWith('+')) phone = '+92' + phone.replace(/^0/, '');

            const productName = payload?.line_items?.[0]?.title || 'your product';
            const productPrice = payload?.total_price || '0';

            console.log(`⏳ Enqueueing retry call for ${orderId} in 60 seconds...`);
            await callQueue.add('retry-call', {
              phone,
              customerName,
              productName,
              productPrice,
              orderId
            }, {
              delay: 60 * 1000,
              jobId: `retry-${orderId}-${retryCount}`
            });
          }
        }
      }
    } catch (err) {
      console.error('❌ Call status save failed:', err.message);
    }

    return res.sendStatus(200);
  });

  return router;
}
