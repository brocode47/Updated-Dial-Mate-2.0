import 'dotenv/config';

import twilio from 'twilio';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { shopify } from './lib/shopify.js';
import { initDb } from './lib/db.js';
import { authRouter } from './routes/auth.js';
import { webhooksRouter, triggerCall } from './routes/webhooks.js';
import { apiRouter } from './routes/api.js';

const PORT = Number(process.env.PORT || 8787);

const app = express();

app.use((req, res, next) => {
  console.log('🌐 INCOMING REQUEST:', req.method, req.url);
  next();
});

app.disable('x-powered-by');

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

app.options('*', cors());

app.use(morgan('tiny'));

// Required for Twilio form posts
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => {
  res.send('Dial Mate Backend Running ✅');
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Shopify webhooks raw body
app.use('/webhooks', express.raw({ type: 'application/json' }));

app.use('/webhooks', webhooksRouter());
app.use('/auth', authRouter());
app.use('/api', apiRouter());

// ===============================
// SHOPIFY TAG UPDATE
// ===============================
async function addShopifyOrderTag(orderId, tag) {
  try {
    const db = (await import('./lib/db.js')).getDb();

    const order = await db.get(
      'SELECT shop, shopifyOrderGid FROM orders WHERE id=?',
      [orderId]
    );

    console.log('🔎 Tag lookup order:', order);

    if (!order || !order.shop || !order.shopifyOrderGid) {
      console.log('⚠️ Shopify tag skipped. Missing shop or shopifyOrderGid.');
      return;
    }

    const shopRow = await db.get(
      'SELECT accessToken FROM shops WHERE shop=?',
      [order.shop]
    );

    console.log('🔎 Shop lookup result:', shopRow);
    console.log('🔎 Looking for shop:', order.shop);

    if (!shopRow || !shopRow.accessToken) {
      const allShops = await db.all('SELECT shop, installedAt FROM shops');
      console.log('🔎 All shops in DB:', allShops);
      console.log('⚠️ Shopify tag skipped. Missing access token.');
      return;
    }

    const client = new shopify.clients.Graphql({
      session: {
        shop: order.shop,
        accessToken: shopRow.accessToken
      }
    });

    const mutation = `
      mutation tagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            message
          }
        }
      }
    `;

    const response = await client.query({
      data: {
        query: mutation,
        variables: {
          id: order.shopifyOrderGid,
          tags: [tag]
        }
      }
    });

    const errors = response?.body?.data?.tagsAdd?.userErrors || [];

    if (errors.length) {
      console.log('❌ Shopify tag errors:', errors);
      return;
    }

    console.log(`🏷️ Shopify tag added: ${tag} for ${orderId}`);
  } catch (err) {
    console.error('❌ Shopify tag failed:', err.message);
  }
}

// ===============================
// TWILIO IVR VOICE ROUTE
// ===============================
app.all('/voice', (req, res) => {
  console.log('🎧 /voice HIT');

  const VoiceResponse = twilio.twiml.VoiceResponse;

  const clean = (value, fallback = '') =>
    String(value || fallback)
      .replace(/&/g, 'and')
      .replace(/</g, '')
      .replace(/>/g, '')
      .replace(/"/g, '')
      .replace(/'/g, '');

  const customerName = clean(req.query.name, 'Customer');
  const productName = clean(req.query.product, 'your product');
  const productPrice = clean(req.query.price, '0');
  const orderId = req.query.orderId || '';

  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const gatherUrl = `${appUrl}/gather?orderId=${encodeURIComponent(orderId)}`;

  const response = new VoiceResponse();

  const gather = response.gather({
    numDigits: 1,
    action: gatherUrl,
    method: 'POST',
    timeout: 7
  });

  gather.say(
    `Assalam o Alaikum ${customerName}. ` +
    `Aap ne ${productName} order kiya hai. ` +
    `Iski qeemat ${productPrice} rupay hai. ` +
    `Confirm karne ke liye 1 dabayein. ` +
    `Cancel karne ke liye 2 dabayein.`
  );

  response.say('Koi jawab nahi mila. Allah Hafiz.');

  res.type('text/xml');
  res.send(response.toString());
});

// ===============================
// TWILIO GATHER INPUT
// ===============================
app.all('/gather', async (req, res) => {
  console.log('🎯 /gather HIT');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Body:', req.body);

  const digit = req.body?.Digits || req.query?.Digits || '';
  const orderId = req.query.orderId;

  console.log('📥 User pressed:', digit, 'for order:', orderId);

  let message = '';
  let status = '';
  let tag = '';

  if (digit === '1') {
    message = 'Aapka order confirm ho gaya hai. Shukriya.';
    status = 'Confirmed';
    tag = 'Confirmed';
  } else if (digit === '2') {
    message = 'Aapka order cancel kar diya gaya hai. Shukriya.';
    status = 'Cancelled';
    tag = 'Cancelled';
  } else {
    message = 'Maazrat, koi sahi jawab nahi mila. Allah Hafiz.';
    status = 'No Response';
    tag = 'No Response';
  }

  try {
    if (orderId && status) {
      const db = (await import('./lib/db.js')).getDb();
      const { now } = await import('./lib/db.js');

      await db.run(
        'UPDATE orders SET status=?, tag=?, updatedAt=? WHERE id=?',
        [status, tag, now(), orderId]
      );

      console.log(`✅ DB updated for order ${orderId}: ${status}`);

      try {
        await addShopifyOrderTag(orderId, tag);
      } catch (tagErr) {
        console.error('⚠️ Shopify tag failed but call response will continue:', tagErr.message);
      }
    }
  } catch (err) {
    console.error('❌ DB update failed but call response will continue:', err.message);
  }

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say(message || 'Shukriya. Allah Hafiz.');
  response.hangup();

  res.type('text/xml');
  return res.send(response.toString());
});

// ===============================
// TWILIO CALL STATUS TRACKING
// ===============================
app.all('/call-status', async (req, res) => {
  console.log('✅ /call-status HIT');
  console.log('Method:', req.method);
  console.log('Query:', req.query);
  console.log('Body:', req.body);

  const orderId = req.query.orderId;
  const callSid = req.body?.CallSid || req.query.CallSid || '';
  const callStatus = req.body?.CallStatus || req.query.CallStatus || 'unknown';

  console.log('📞 Call status:', orderId, callSid, callStatus);

  try {
    if (orderId && callStatus) {
      const db = (await import('./lib/db.js')).getDb();
      const { now } = await import('./lib/db.js');

      await db.run(
        'UPDATE orders SET callStatus=?, callSid=?, updatedAt=? WHERE id=?',
        [callStatus, callSid, now(), orderId]
      );

      console.log(`✅ Saved call status for ${orderId}: ${callStatus}`);

      const order = await db.get(
        'SELECT * FROM orders WHERE id=?',
        [orderId]
      );

      if (!order) {
        console.log('⚠️ Retry skipped: order not found');
        return res.sendStatus(200);
      }

      if (order.status === 'Confirmed' || order.status === 'Cancelled') {
        console.log('✅ Retry skipped: order already decided');
        return res.sendStatus(200);
      }

      const failedStatuses = ['busy', 'failed', 'no-answer'];

      const shouldRetry =
        failedStatuses.includes(callStatus) ||
        (callStatus === 'completed' && order.status === 'Pending Confirmation');

      if (shouldRetry) {
        const retryCount = order.retryCount || 0;

        if (retryCount >= 2) {
          await db.run(
            'UPDATE orders SET tag=?, updatedAt=? WHERE id=?',
            ['Max Retries Reached', now(), orderId]
          );

          console.log(`⛔ Max retries reached for ${orderId}. No further action.`);
          return res.sendStatus(200);
        }

        await db.run(
          'UPDATE orders SET retryCount=?, tag=?, updatedAt=? WHERE id=?',
          [retryCount + 1, 'Retry', now(), orderId]
        );

        console.log(`🔁 Retry scheduled for ${orderId}. Attempt ${retryCount + 1}`);

        setTimeout(async () => {
          try {
            const payload = JSON.parse(order.payload || '{}');

            const customerName =
              payload?.shipping_address?.name ||
              payload?.customer?.first_name ||
              'Customer';

            let phone =
              payload?.phone ||
              payload?.shipping_address?.phone ||
              payload?.customer?.phone ||
              payload?.billing_address?.phone;

            if (!phone) {
              console.log('❌ Retry failed: no phone number');
              return;
            }

            if (!phone.startsWith('+')) {
              phone = '+92' + phone.replace(/^0/, '');
            }

            const productName = payload?.line_items?.[0]?.title || 'your product';
            const productPrice = payload?.total_price || '0';

            console.log(`🔁 Retrying call for ${orderId}: ${phone}`);

            await triggerCall({
              phone,
              customerName,
              productName,
              productPrice,
              orderId
            });
          } catch (err) {
            console.error('❌ Retry call failed:', err.message);
          }
        }, 60 * 1000);
      }
    }
  } catch (err) {
    console.error('❌ Call status save failed:', err.message);
  }

  return res.sendStatus(200);
});

// ===============================
// MANUAL CALL ENDPOINT
// ===============================
app.post('/debug/orders/:orderId/call', async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.orderId);

    const db = (await import('./lib/db.js')).getDb();
    const order = await db.get('SELECT * FROM orders WHERE id=?', [orderId]);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    const payload = JSON.parse(order.payload || '{}');

    const customerName =
      payload?.shipping_address?.name ||
      payload?.customer?.first_name ||
      'Customer';

    let phone =
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.customer?.phone ||
      payload?.billing_address?.phone;

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'No phone number found' });
    }

    if (!phone.startsWith('+')) {
      phone = '+92' + phone.replace(/^0/, '');
    }

    const productName = payload?.line_items?.[0]?.title || 'your product';
    const productPrice = payload?.total_price || '0';

    await triggerCall({
      phone,
      customerName,
      productName,
      productPrice,
      orderId
    });

    res.json({ ok: true, message: 'Call started', orderId });
  } catch (err) {
    console.error('❌ Manual call failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===============================
// DEBUG: VIEW ORDERS
// ===============================
app.get('/debug/orders', async (_req, res) => {
  try {
    const db = (await import('./lib/db.js')).getDb();

    const rows = await db.all(`
      SELECT id, shop, status, tag, callStatus, callSid, retryCount, payload, createdAt, updatedAt
      FROM orders
      ORDER BY createdAt DESC
      LIMIT 100
    `);

    const orders = rows.map((order) => {
      let payload = {};

      try {
        payload = JSON.parse(order.payload || '{}');
      } catch {
        payload = {};
      }

      const customerName =
        payload?.shipping_address?.name ||
        `${payload?.customer?.first_name || ''} ${payload?.customer?.last_name || ''}`.trim() ||
        payload?.billing_address?.name ||
        'Unknown customer';

      const phone =
        payload?.phone ||
        payload?.shipping_address?.phone ||
        payload?.billing_address?.phone ||
        payload?.customer?.phone ||
        '';

      const productName =
        payload?.line_items?.map((item) => item.title).join(', ') ||
        'Unknown product';

      const totalAmount =
        payload?.total_price ||
        payload?.current_total_price ||
        payload?.subtotal_price ||
        0;

      return {
        ...order,
        payload: undefined,
        customerName,
        phone,
        productName,
        totalAmount,
        orderDate: order.createdAt
      };
    });

    res.json({ orders });
  } catch (err) {
    console.error('❌ Debug orders failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ===============================
// INIT DB + START SERVER
// ===============================
await initDb();

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});