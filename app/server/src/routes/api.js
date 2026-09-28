/* __imports_rewritten__ */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { placeOutboundCall } from '../calls/twilio.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import crypto from 'crypto';
import { config } from '../config/features.js';
import rateLimit from 'express-rate-limit';

export function apiRouter() {
  const router = express.Router();

  router.get('/features', (req, res) => {
    return res.json(config);
  });

  router.use(tenantMiddleware);

  router.get('/orders', async (req, res) => {
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

  router.get('/calls', async (req, res) => {
    const shopRecord = req.shopRecord;

    const rows = await prisma.call.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return res.json({ calls: rows });
  });

  router.get('/compliance', async (req, res) => {
    const rows = await prisma.complianceLog.findMany({
      where: { shopDomain: req.shopRecord.domain },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return res.json({ logs: rows });
  });

  router.post('/orders/:orderId/tag', async (req, res) => {
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
  const ipRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // Reasonable IP-based protection layer
    message: { error: 'Too many requests from this IP' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const tenantCallRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 5, // Limit each tenant to 5 call requests per `window`
    keyGenerator: (req) => req.shopRecord?.id || 'unknown',
    message: { error: 'Too many calls requested for this store, please try again after a minute' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/orders/:orderId/call', ipRateLimiter, tenantCallRateLimiter, async (req, res) => {
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
      where: { id: orderId } // Notice: standard Prisma might not allow composite `where: { id, shopId }` unless uniquely defined. We'll verify post-fetch.
    });

    if (!orderRow || orderRow.shopId !== shopRecord.id) {
      return res.status(404).json({ error: 'Order not found' });
    }

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
  router.get('/ai/logs', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { agent, intent, status, startDate, endDate, page = 1, limit = 50 } = req.query;
      
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 50;
      const skip = (pageNum - 1) * limitNum;
      
      const where = { shopId: shopRecord.id };
      if (agent) where.detectedAgent = agent;
      if (intent) where.intent = intent;
      if (status) where.status = status;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }
      
      const rows = await prisma.aIInteractionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      });
      
      const total = await prisma.aIInteractionLog.count({ where });
      
      return res.json({
        logs: rows.map(l => ({
          id: l.id,
          message: l.userMessage,
          agent: l.detectedAgent,
          intent: l.intent,
          action: l.action,
          modelUsed: l.modelUsed,
          usedLLM: l.usedLLM,
          fallbackUsed: l.fallbackUsed,
          responseTimeMs: l.responseTimeMs,
          status: l.status,
          timestamp: l.createdAt
        })),
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  router.get('/ai/stats', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      
      const logs = await prisma.aIInteractionLog.findMany({
        where: { shopId: shopRecord.id }
      });
      
      const total = logs.length;
      if (total === 0) {
         return res.json({
           totalRequests: 0,
           successCount: 0,
           fallbackPercentage: 0,
           averageResponseTime: 0,
           mostCommonIntents: [],
           mostUsedAgents: [],
           errorCount: 0,
           timeoutCount: 0
         });
      }
      
      let successCount = 0;
      let fallbackCount = 0;
      let totalTime = 0;
      let timeCount = 0;
      let errorCount = 0;
      let timeoutCount = 0;
      
      const intentMap = {};
      const agentMap = {};
      
      for (const log of logs) {
        if (log.status === 'SUCCESS') successCount++;
        if (log.fallbackUsed) fallbackCount++;
        if (log.responseTimeMs > 0) {
          totalTime += log.responseTimeMs;
          timeCount++;
        }
        if (log.status !== 'SUCCESS' && log.status !== 'FALLBACK') errorCount++;
        if (log.errorMessage && log.errorMessage.toLowerCase().includes('timeout')) timeoutCount++;
        
        if (log.intent) {
          intentMap[log.intent] = (intentMap[log.intent] || 0) + 1;
        }
        if (log.detectedAgent) {
          agentMap[log.detectedAgent] = (agentMap[log.detectedAgent] || 0) + 1;
        }
      }
      
      const mostCommonIntents = Object.entries(intentMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
        
      const mostUsedAgents = Object.entries(agentMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
        
      return res.json({
        totalRequests: total,
        successCount,
        fallbackPercentage: Math.round((fallbackCount / total) * 100) || 0,
        averageResponseTime: timeCount > 0 ? Math.round(totalTime / timeCount) : 0,
        mostCommonIntents,
        mostUsedAgents,
        errorCount,
        timeoutCount
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  return router;
}