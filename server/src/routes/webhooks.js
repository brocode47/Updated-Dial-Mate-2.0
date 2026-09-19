/* __imports_rewritten__ */
import express from 'express';
import twilio from 'twilio';

import { shopify } from '../lib/shopify.js';
import { prisma } from '../lib/db.js';
import { verifyShopifyWebhook } from '../lib/webhookVerify.js';
import { computeRiskScore } from '../lib/risk.js';

// 🔥 Twilio client
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

  router.post('/orders/updated', async (req, res) => {
    console.log('📦 orders/updated received, ignored for calling');
    return res.status(200).send('ok');
  });

  return router;
}

// ===============================
// ✅ MAIN HANDLER (FIXED)
// ===============================
async function handleOrderWebhook(req, res, topic) {
  console.log(`📦 Webhook received: ${topic}`);

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
      console.log(`📦 Webhook ${webhookId} already processed, skipping.`);
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
  const orderId = String(payload?.name || payload?.id);
  const shopifyOrderGid = payload?.admin_graphql_api_id;

  const riskScore = computeRiskScore(payload);

  await prisma.order.upsert({
    where: { id: orderId },
    update: {
      payload: rawBody,
      shopifyOrderGid,
      riskScore
    },
    create: {
      id: orderId,
      shopId: shopRecord.id,
      shopifyOrderGid,
      payload: rawBody,
      status: 'Pending Confirmation',
      tag: 'Retry',
      riskScore
    }
  });

  await prisma.complianceLog.create({
    data: {
      shopDomain: shop,
      event: 'Webhook verified',
      detail: `${topic} accepted for ${orderId}`
    }
  });

  // ===============================
  // 📞 TRIGGER CALL (NON-BLOCKING ✅)
  // ===============================
  try {
    const customerName =
      payload?.shipping_address?.name ||
      payload?.customer?.first_name ||
      'Customer';

    let phone =
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.customer?.phone;

    console.log('📱 RAW PHONE:', phone);

    if (!phone) {
      console.log('❌ No phone number found');
      return res.status(200).send('ok');
    }

    if (!phone.startsWith('+')) {
      phone = '+92' + phone.replace(/^0/, '');
    }

    console.log('📞 FORMATTED PHONE:', phone);

    const productName = payload?.line_items?.[0]?.title || 'your product';
    const productPrice = payload?.total_price || '0';

    console.log('📞 Calling:', phone);

    // 🚨 IMPORTANT: NO AWAIT (prevents 502)
setTimeout(async () => {
  try {
    await triggerCall({
      phone,
      customerName,
      productName,
      productPrice,
      orderId
    });
  } catch (err) {
    console.error('❌ Delayed triggerCall failed:', err.message);
  }
}, 100);

  } catch (err) {
    console.error('❌ Call trigger failed:', err.message);
  }

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
    const statusUrl = `${appUrl}/call-status?orderId=${encodeURIComponent(orderId || '')}`;

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

    console.log('🌐 Status URL:', statusUrl);
    console.log('🧾 Direct TwiML:', twiml);
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