/* __imports_rewritten__ */
import express from 'express';
import twilio from 'twilio';
import crypto from 'crypto';

import { shopify } from '../lib/shopify.js';
import { prisma } from '../lib/db.js';
import { verifyShopifyWebhook } from '../lib/webhookVerify.js';
import { webhookQueue, whatsappQueue } from '../lib/queues.js';
import { waLogger } from '../utils/waLogger.js';

// 📞 Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ===============================
// ✅ REGISTER WEBHOOKS
// ===============================
export async function registerWebhooksForShop({ shop, accessToken }) {
  const restClient = new shopify.clients.Rest({ session: { shop, accessToken } });

  const baseUrl = (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '');

  const webhooks = [
    { topic: 'orders/create', address: `${baseUrl}/webhooks/orders/create` },
    { topic: 'orders/updated', address: `${baseUrl}/webhooks/orders/updated` }
  ];

  for (const hook of webhooks) {
    try {
      await restClient.post({
        path: 'webhooks',
        data: {
          webhook: {
            topic: hook.topic,
            address: hook.address,
            format: 'json'
          }
        }
      });
    } catch (err) {
      console.log('⚠️ Webhook may already exist:', hook.topic);
    }
  }

  await prisma.complianceLog.create({
    data: {
      shopDomain: shop,
      event: 'Webhook registered',
      detail: `orders/create + orders/updated -> ${baseUrl}`
    }
  });
}

// ===============================
// ✅ ROUTER
// ===============================
export function webhooksRouter() {
  const router = express.Router();
  router.post('/orders/create', async (req, res) => {
    try {
      await handleOrderWebhook(req, res, 'orders/create');
    } catch (error) {
      console.error('❌ Webhook create error:', error);
      res.status(200).send('ok');
    }
  });

  router.post('/call-status', async (req, res) => {
    try {
      const { CallSid, CallStatus } = req.body;
      const orderId = req.query.orderId;

      console.log('📞 Twilio Status Callback');
      console.log('Call SID:', CallSid);
      console.log('Status:', CallStatus);
      console.log('Order:', orderId);

      if (orderId) {
        await prisma.call.updateMany({
          where: {
            orderId: orderId
          },
          data: {
            outcome: CallStatus
          }
        });
      }

      return res.status(200).send('ok');

    } catch (error) {
      console.error('❌ Call status callback error:', error);
      return res.status(200).send('ok');
    }
  });


    router.post('/orders/updated', async (req, res) => {
    console.log('🔔 orders/updated received, ignored for calling');
    return res.status(200).send('ok');
  });

  

  // WA-AKG Webhook Receiver
  router.post('/wa-akg', async (req, res) => {
    try {
      const rawBody = req.body ? req.body.toString('utf8') : '';
      const rawSig = req.get('x-webhook-signature') || req.get('X-Webhook-Signature');
      const secret = process.env.WA_AKG_WEBHOOK_SECRET;
      
      if (secret) {
        if (!rawSig) {
          console.warn('WA-AKG Webhook missing signature');
          return res.status(401).send('Unauthorized');
        }
        
        // Strip optional sha256= prefix for normalization
        const normalizedSig = rawSig.startsWith('sha256=') ? rawSig : `sha256=${rawSig}`;
        const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const sigBuffer = Buffer.from(normalizedSig);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          console.warn('WA-AKG Webhook signature mismatch');
          return res.status(401).send('Unauthorized');
        }
      }

      if (!rawBody) {
        return res.status(200).send('OK');
      }

      const payload = JSON.parse(rawBody);
      
      if (payload.event === 'message.received' && payload.data) {
        // 1. Ignore outbound echo messages sent by the bot itself
        if (payload.data.key?.fromMe) {
          return res.status(200).send('OK');
        }

        // 2. Ignore group chats
        if (payload.data.isGroup || payload.data.key?.remoteJid?.includes('@g.us')) {
          return res.status(200).send('OK');
        }

        const sessionId = payload.sessionId;
        if (!sessionId) {
          console.warn('WA-AKG Webhook missing sessionId');
          return res.status(200).send('OK');
        }

        const integration = await prisma.whatsAppIntegration.findUnique({
          where: {
            provider_sessionId: {
              provider: 'WA_AKG',
              sessionId: String(sessionId)
            }
          },
          include: {
            shop: true
          }
        });

        if (!integration || !integration.isActive || !integration.shop || !integration.shop.isActive) {
          console.warn(`WA-AKG Webhook rejected for unknown/inactive sessionId: ${sessionId}`);
          return res.status(200).send('OK');
        }

        const shopDomain = integration.shop.domain;
        const messageId = payload.data.key?.id;
        const traceId = messageId || crypto.randomUUID();

        waLogger.received(traceId, {
          shopId: integration.shop.id,
          shopDomain,
          sessionId: String(sessionId),
          remoteJid: payload.data.key?.remoteJid,
          type: payload.data.type || 'text'
        });

        await whatsappQueue.add('wa-message', {
          shopId: integration.shop.id,
          shopDomain: shopDomain,
          sessionId: String(sessionId),
          payload: payload.data,
          traceId
        }, {
          jobId: messageId || undefined
        });

        waLogger.queued(traceId, {
          jobId: messageId,
          queue: 'whatsappQueue'
        });
      }
      
      res.status(200).send('OK');
    } catch (error) {
      console.error('WA-AKG Webhook error:', error);
      res.status(200).send('OK');
    }
  });

router.get('/gather', async (req, res) => {
  const { Digits, orderId } = req.query;

  console.log('📞 Gather received');
  console.log('Order:', orderId);
  console.log('Digits:', Digits);

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  if (Digits === '1') {
    response.say('Shukriya. Aap ka order confirm kar diya gaya hai. Allah Hafiz.');

    await prisma.order.updateMany({
      where: { id: orderId },
      data: {
        status: 'Confirmed',
        callStatus: 'confirmed'
      }
    });

  } else if (Digits === '2') {
    response.say('Aap ka order cancel kar diya gaya hai. Allah Hafiz.');

    await prisma.order.updateMany({
      where: { id: orderId },
      data: {
        status: 'Cancelled',
        callStatus: 'cancelled'
      }
    });

  } else {
    response.say('Invalid choice. Allah Hafiz.');
  }

  res.type('text/xml');
  res.send(response.toString());
});

  return router;
}

// ===============================
// ✅ MAIN HANDLER (FIXED)
// ===============================
async function handleOrderWebhook(req, res, topic) {
  console.log(`🔔 Webhook received: ${topic}`);

  const shop = req.get('X-Shopify-Shop-Domain');
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const webhookId = req.get('X-Shopify-Webhook-Id');
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret) {
    console.log('❌ Missing webhook secret');
    return res.status(200).send('ok');
  }

  const rawBody = req.body.toString('utf8');

  const ok = verifyShopifyWebhook({
    rawBody,
    hmacHeader: hmac,
    secret
  });

  if (!ok) {
    console.log('❌ HMAC verification failed');
    return res.status(200).send('ok');
  }

  console.log('✅ Webhook verified');

  const shopRecord = await prisma.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) {
    console.log('❌ Unknown shop');
    return res.status(200).send('ok');
  }

  if (webhookId) {
    // Idempotency check
    const existingHook = await prisma.webhookEvent.findUnique({
      where: { id: webhookId }
    });
    if (existingHook) {
      console.log(`🔔 Webhook ${webhookId} already processed, skipping.`);
      return res.status(200).send('ok');
    }

    // Register webhook event
    await prisma.webhookEvent.create({
      data: {
        id: webhookId,
        shopId: shopRecord.id,
        topic,
        payload: rawBody,
        processed: true
      }
    });
  }

  const payload = JSON.parse(rawBody);

  // Enqueue job to webhookWorker
  await webhookQueue.add('process-order', {
    topic,
    payload,
    shopId: shopRecord.id,
    webhookId
  }, {
    jobId: webhookId // Idempotency fallback in BullMQ
  });

  await prisma.complianceLog.create({
    data: {
      shopDomain: shop,
      event: 'Webhook queued',
      detail: `${topic} queued for processing`
    }
  });

  // ✅ ALWAYS respond immediately
  return res.status(200).send('ok');
}

// ===============================
// 📞 TWILIO CALL
// ===============================
export async function triggerCall({ phone, customerName, productName, productPrice, orderId }) {
  try {
    const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    const fromNumber = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

    const clean = (value, fallback = '') =>
      String(value || fallback)
        .replace(/&/g, 'and')
        .replace(/</g, '')
        .replace(/>/g, '')
        .replace(/"/g, '')
        .replace(/'/g, '');

    if (!appUrl) {
      console.log('❌ Missing APP_URL in .env');
      return;
    }

    if (!fromNumber) {
      console.log('❌ Missing TWILIO_FROM_NUMBER or TWILIO_PHONE_NUMBER in .env');
      return;
    }

    if (!phone) {
      console.log('❌ Missing customer phone');
      return;
    }

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    const gatherUrl = `${appUrl}/gather?orderId=${encodeURIComponent(orderId || '')}`;
    const statusUrl = `${appUrl}/webhooks/call-status?orderId=${encodeURIComponent(orderId || '')}`;

    const gather = response.gather({
      numDigits: 1,
      action: gatherUrl,
      method: 'GET',
      timeout: 10
    });

    gather.say(
      `Assalam o Alaikum ${clean(customerName, 'Customer')}. ` +
      `Aap ne ${clean(productName, 'your product')} order kiya hai. ` +
      `Iski qeemat ${clean(productPrice, '0')} rupay hai. ` +
      `Confirm karne ke liye 1 dabayein. ` +
      `Cancel karne ke liye 2 dabayein.`
    );

    response.say('Koi jawab nahi mila. Allah Hafiz.');

    const twiml = response.toString();

    console.log('🔗 Status URL:', statusUrl);
    console.log('📄 Direct TwiML:', twiml);
    console.log('📞 Creating Twilio call...');

    const call = await client.calls.create({
      to: phone,
      from: fromNumber,
      twiml,
      statusCallback: statusUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    console.log('✅ Call initiated:', call.sid);
  } catch (err) {
    console.error('❌ Twilio call failed:', err.message);
    console.error('❌ Twilio code:', err.code);
    console.error('❌ Twilio status:', err.status);
    console.error('❌ Twilio more info:', err.moreInfo);
  }
}
