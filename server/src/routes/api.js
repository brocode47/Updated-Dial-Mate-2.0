/* __imports_rewritten__ */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { placeOutboundCall } from '../calls/twilio.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import crypto from 'crypto';
import { config } from '../config/features.js';

export function apiRouter() {
  const router = express.Router();

  router.get('/features', (req, res) => {
    return res.json(config);
  });

  router.use('/shops/:shop', tenantMiddleware);

  router.get('/shops/:shop/orders', async (req, res) => {
    const shopRecord = req.shopRecord;

    const rows = await prisma.order.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });

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
    const shopRecord = req.shopRecord;

    const rows = await prisma.call.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return res.json({ calls: rows });
  });

  router.get('/shops/:shop/compliance', async (req, res) => {
    const rows = await prisma.complianceLog.findMany({
      where: { shopDomain: req.shopRecord.domain },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

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

    const shopRecord = req.shopRecord;
    const { orderId } = req.params;

    await prisma.order.update({
      where: { id: orderId },
      data: { status: parsed.data.status, tag: parsed.data.tag }
    });

    await prisma.complianceLog.create({
      data: {
        shopDomain: shopRecord.domain,
        event: 'Order tag update',
        detail: `${orderId} -> ${parsed.data.tag}`
      }
    });

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

    const shopRecord = req.shopRecord;
    const { orderId } = req.params;

    const orderRow = await prisma.order.findUnique({
      where: { id: orderId }
    });

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

    const callId = crypto.randomUUID();
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
          `${baseUrl}/twilio/status?shop=${encodeURIComponent(shopRecord.domain)}&orderId=${encodeURIComponent(orderId)}&callId=${encodeURIComponent(callId)}`;

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

    await prisma.call.create({
      data: {
        shopId: shopRecord.id,
        orderId,
        outcome: 'Queued',
        intent: 'Confirmation',
        sentiment: 'Unknown',
        providerCallSid
      }
    });

    await prisma.complianceLog.create({
      data: {
        shopDomain: shopRecord.domain,
        event: 'Call queued',
        detail: `${orderId} -> ${phone} (${parsed.data.mode})`
      }
    });

    return res.json({ ok: true, callId, providerCallSid });
  });

  return router;
}