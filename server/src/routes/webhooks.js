/* __imports_rewritten__ */
import express from 'express';
import twilio from 'twilio';

import { shopify } from '../lib/shopify.js';
import { initDb, getDb, now, uid } from '../lib/db.js';
import { verifyShopifyWebhook } from '../lib/webhookVerify.js';
import { computeRiskScore } from '../lib/risk.js';

// 🔥 Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Registers webhooks with Shopify after OAuth.
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

  await initDb();
  const db = getDb();
  await db.run(
    'INSERT INTO compliance_logs(id, shop, event, detail, createdAt) VALUES(?,?,?,?,?)',
    [uid('log'), shop, 'Webhook registered', `orders/create + orders/updated -> ${baseUrl}`, now()]
  );
}

export function webhooksRouter() {
  const router = express.Router();

  router.post('/orders/create', async (req, res) => {
    try {
      await handleOrderWebhook(req, res, 'orders/create');
    } catch (error) {
      console.error('❌ Webhook create error:', error);
      res.status(500).send(error?.message || String(error));
    }
  });

  router.post('/orders/updated', async (req, res) => {
    try {
      await handleOrderWebhook(req, res, 'orders/updated');
    } catch (error) {
      console.error('❌ Webhook update error:', error);
      res.status(500).send(error?.message || String(error));
    }
  });

  return router;
}

async function handleOrderWebhook(req, res, topic) {
  console.log(`📦 Webhook received: ${topic}`);

  const shop = req.get('X-Shopify-Shop-Domain');
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret) {
    console.log('❌ Missing webhook secret');
    return res.status(500).send('Webhook secret not configured');
  }

  const rawBody = req.body.toString('utf8');

  const ok = verifyShopifyWebhook({
    rawBody,
    hmacHeader: hmac,
    secret
  });

  if (!ok) {
    console.log('❌ HMAC verification failed');
    return res.status(401).send('Invalid webhook signature');
  }

  console.log('✅ Webhook verified');

  const payload = JSON.parse(rawBody);
  console.log('📦 FULL PAYLOAD:', JSON.stringify(payload, null, 2));

  const orderId = String(payload?.name || payload?.id);

  await initDb();
  const db = getDb();

  const riskScore = computeRiskScore(payload);

  await db.run(
    `INSERT INTO orders(id, shop, payload, createdAt, updatedAt, status, tag, riskScore)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updatedAt=excluded.updatedAt, riskScore=excluded.riskScore`,
    [orderId, shop, rawBody, now(), now(), 'Pending Confirmation', 'Retry', riskScore]
  );

  await db.run(
    'INSERT INTO compliance_logs(id, shop, event, detail, createdAt) VALUES(?,?,?,?,?)',
    [uid('log'), shop, 'Webhook verified', `${topic} accepted for ${orderId}`, now()]
  );

  // ===============================
  // 📞 TRIGGER CALL
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
      console.log('❌ No phone number found in order');
      return res.status(200).send('ok');
    }

    // ✅ Format Pakistani number
    if (!phone.startsWith('+')) {
      phone = '+92' + phone.replace(/^0/, '');
    }

    console.log('📞 FORMATTED PHONE:', phone);

    const productName = payload?.line_items?.[0]?.title || 'your product';
    const productPrice = payload?.total_price || '0';

    console.log('📞 Calling:', phone);

    await triggerCall({
      phone,
      customerName,
      productName,
      productPrice
    });

  } catch (err) {
    console.error('❌ Call trigger failed:', err.message);
  }

  return res.status(200).send('ok');
}

// ===============================
// 📞 TWILIO CALL
// ===============================
async function triggerCall({ phone, customerName, productName, productPrice }) {
  try {
    const voiceUrl =
      `${process.env.APP_URL}/voice?name=${encodeURIComponent(customerName)}&product=${encodeURIComponent(productName)}&price=${encodeURIComponent(productPrice)}`;

    console.log('🌐 Voice URL:', voiceUrl);

    const call = await client.calls.create({
      to: phone,
      from: process.env.TWILIO_FROM_NUMBER,
      url: voiceUrl
    });

    console.log('✅ Call initiated:', call.sid);

  } catch (err) {
    console.error('❌ Twilio call failed:', err.message);
  }
}