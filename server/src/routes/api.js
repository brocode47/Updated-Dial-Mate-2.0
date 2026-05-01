/* __imports_rewritten__ */
import express from 'express';
import { z } from 'zod';
import { initDb, getDb, now, uid } from '../lib/db.js';
import { placeOutboundCall } from '../calls/twilio.js';

export function apiRouter() {
  const router = express.Router();

  router.get('/shops/:shop/orders', async (req, res) => {
    await initDb();
    const db = getDb();
    const shop = req.params.shop;

  const rows = await db.all(
  `SELECT id, shop, status, tag, riskScore, updatedAt, payload,
          callStatus, retryCount, whatsappSent
   FROM orders
   WHERE shop=?
   ORDER BY updatedAt DESC
   LIMIT 200`,
  [shop]
);

    const orders = rows.map((r) => {
      const payload = JSON.parse(r.payload);

      return {
        id: r.id,
        status: r.status,
        tag: r.tag,
        risk: r.riskScore,
        callStatus: r.callStatus || 'pending',
        retryCount: r.retryCount || 0,
        whatsappSent: r.whatsappSent || 0,

        customer: payload?.shipping_address?.name || payload?.customer?.first_name || 'Customer',
        city: payload?.shipping_address?.city || '',
        phone: payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone || '',
        payment: (payload?.payment_gateway_names || []).join(', ') || 'Unknown',
        total: Number(payload?.current_total_price || payload?.total_price || 0),
        items: (payload?.line_items || []).slice(0, 3).map((li) => ({
          title: li.title,
          variant: li.variant_title,
          qty: li.quantity
        })),
        updatedAt: r.updatedAt
      };
    });

    return res.json({ orders });
  });

  router.get('/shops/:shop/calls', async (req, res) => {
    await initDb();
    const db = getDb();
    const shop = req.params.shop;

    const rows = await db.all(
      'SELECT id, orderId, outcome, intent, sentiment, durationSec, recordingUrl, transcript, createdAt FROM calls WHERE shop=? ORDER BY createdAt DESC LIMIT 200',
      [shop]
    );

    return res.json({ calls: rows });
  });

  router.get('/shops/:shop/compliance', async (req, res) => {
    await initDb();
    const db = getDb();
    const shop = req.params.shop;

    const rows = await db.all(
      'SELECT id, event, detail, createdAt FROM compliance_logs WHERE shop=? ORDER BY createdAt DESC LIMIT 200',
      [shop]
    );

    return res.json({ logs: rows });
  });

  router.post('/shops/:shop/orders/:orderId/tag', async (req, res) => {
    const schema = z.object({
      status: z.string().min(1),
      tag: z.string().min(1)
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    await initDb();
    const db = getDb();
    const { shop, orderId } = req.params;

    await db.run(
      'UPDATE orders SET status=?, tag=?, updatedAt=? WHERE shop=? AND id=?',
      [parsed.data.status, parsed.data.tag, now(), shop, orderId]
    );

    await db.run(
      'INSERT INTO compliance_logs(id, shop, event, detail, createdAt) VALUES(?,?,?,?,?)',
      [uid('log'), shop, 'Order tag update', `${orderId} -> ${parsed.data.tag}`, now()]
    );

    return res.json({ ok: true });
  });

  // 📞 Call Now / Retry
  router.post('/shops/:shop/orders/:orderId/call', async (req, res) => {
    const schema = z.object({
      to: z.string().min(5).optional(),
      mode: z.enum(['dry_run', 'twilio']).default('dry_run')
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    await initDb();
    const db = getDb();
    const { shop, orderId } = req.params;

    const orderRow = await db.get(
      'SELECT payload FROM orders WHERE shop=? AND id=?',
      [shop, orderId]
    );

    if (!orderRow) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const payload = JSON.parse(orderRow.payload);

    let phone =
      parsed.data.to ||
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.customer?.phone;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number found' });
    }

    // ✅ Format Pakistani number
    if (!phone.startsWith('+')) {
      phone = '+92' + phone.replace(/^0/, '');
    }

    const customerName =
      payload?.shipping_address?.name ||
      payload?.customer?.first_name ||
      'Customer';

    const productName =
      payload?.line_items?.[0]?.title || 'your product';

    const productPrice =
      payload?.current_total_price ||
      payload?.total_price ||
      '0';

    const callId = uid('call');
    let providerCallSid = null;

    if (parsed.data.mode === 'twilio') {
      try {
        const baseUrl = (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '');
        const from = process.env.TWILIO_FROM_NUMBER;

        if (!from) {
          return res.status(500).json({ error: 'TWILIO_FROM_NUMBER not configured' });
        }

        // ✅ Dynamic IVR URL
        const webhookUrl =
          `${baseUrl}/voice?name=${encodeURIComponent(customerName)}&product=${encodeURIComponent(productName)}&price=${encodeURIComponent(productPrice)}`;

        const statusCallbackUrl =
          `${baseUrl}/twilio/status?shop=${encodeURIComponent(shop)}&orderId=${encodeURIComponent(orderId)}&callId=${encodeURIComponent(callId)}`;

        const resp = await placeOutboundCall({
          to: phone,
          from,
          webhookUrl,
          statusCallbackUrl
        });

        providerCallSid = resp.sid;

      } catch (error) {
        return res.status(500).json({ error: error?.message || String(error) });
      }
    }

    await db.run(
      'INSERT INTO calls(id, shop, orderId, outcome, intent, sentiment, durationSec, recordingUrl, transcript, providerCallSid, createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [callId, shop, orderId, 'Queued', 'Confirmation', 'Unknown', null, null, null, providerCallSid, now()]
    );

    await db.run(
      'INSERT INTO compliance_logs(id, shop, event, detail, createdAt) VALUES(?,?,?,?,?)',
      [uid('log'), shop, 'Call queued', `${orderId} -> ${phone} (${parsed.data.mode})`, now()]
    );

    return res.json({ ok: true, callId, providerCallSid });
  });

  return router;
}