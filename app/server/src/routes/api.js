/* __imports_rewritten__ */
import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { placeOutboundCall } from '../calls/twilio.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import crypto from 'crypto';
import { config } from '../config/features.js';
import rateLimit from 'express-rate-limit';

import { syncShopifyData } from '../services/shopifySync.js';

export function apiRouter() {
  const router = express.Router();

  router.use(express.json());

  router.get('/features', (req, res) => {
    return res.json(config);
  });

  router.use(tenantMiddleware);

  // High-level dashboard summary metrics with real-time COD KPIs
  router.get('/dashboard/stats', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [orders, customersCount, productsCount, calls, lastSyncLog, recentCalls] = await Promise.all([
        prisma.order.findMany({
          where: { shopId: shopRecord.id },
          select: { status: true, totalAmount: true, callStatus: true, createdAt: true }
        }),
        prisma.customer.count({ where: { shopId: shopRecord.id } }),
        prisma.product.count({ where: { shopId: shopRecord.id } }),
        prisma.call.findMany({
          where: { shopId: shopRecord.id },
          select: { outcome: true, durationSec: true, createdAt: true }
        }),
        prisma.complianceLog.findFirst({
          where: {
            shopDomain: shopRecord.domain,
            event: { contains: 'sync', mode: 'insensitive' }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.call.findMany({
          where: { shopId: shopRecord.id },
          include: {
            order: {
              include: { customer: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        })
      ]);

      const confirmed = orders.filter(o => o.status === 'Confirmed');
      const cancelled = orders.filter(o => o.status === 'Cancelled');
      const pending = orders.filter(o => o.status !== 'Confirmed' && o.status !== 'Cancelled');

      const todayOrders = orders.filter(o => new Date(o.createdAt) >= startOfToday);
      const todayCalls = calls.filter(c => new Date(c.createdAt) >= startOfToday);

      const completedCalls = calls.filter(c => c.outcome?.toLowerCase() === 'completed' || c.outcome?.toLowerCase() === 'confirmed');
      const noAnswerCalls = calls.filter(c => ['no_answer', 'no-answer', 'busy'].includes(c.outcome?.toLowerCase()));
      const failedCalls = calls.filter(c => ['failed', 'canceled'].includes(c.outcome?.toLowerCase()));

      const totalRevenue = confirmed.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const confirmationRate = orders.length ? Math.round((confirmed.length / orders.length) * 100) : 0;
      const connectionRate = calls.length ? Math.round((completedCalls.length / calls.length) * 100) : (orders.length ? Math.round((orders.filter(o => o.callStatus === 'completed' || o.callStatus === 'confirmed').length / orders.length) * 100) : 0);

      const recentActivity = recentCalls.map(c => {
        let payload = {};
        if (c.order?.payload) {
          try { payload = typeof c.order.payload === 'string' ? JSON.parse(c.order.payload) : c.order.payload; } catch(_) {}
        }
        const customerName = c.order?.customer
          ? `${c.order.customer.firstName || ''} ${c.order.customer.lastName || ''}`.trim() || c.order.customer.phone
          : payload?.shipping_address?.name || payload?.customer?.first_name || 'Customer';

        return {
          id: c.id,
          orderId: c.orderId,
          orderNumber: c.order?.orderNumber || payload?.name || c.orderId,
          customerName,
          outcome: c.outcome || 'Completed',
          durationSec: c.durationSec || 0,
          timestamp: c.createdAt
        };
      });

      return res.json({
        totalOrders: orders.length,
        todayOrders: todayOrders.length,
        confirmedOrders: confirmed.length,
        cancelledOrders: cancelled.length,
        pendingOrders: pending.length,
        callsRemaining: pending.length,
        totalRevenue,
        confirmationRate,
        connectionRate,
        customersCount,
        productsCount,
        totalCalls: calls.length || orders.filter(o => o.callStatus && o.callStatus !== 'pending').length,
        todayCalls: todayCalls.length,
        completedCalls: completedCalls.length,
        noAnswerCalls: noAnswerCalls.length,
        failedCalls: failedCalls.length,
        shopDomain: shopRecord.domain,
        lastSyncAt: lastSyncLog?.createdAt || shopRecord.updatedAt || shopRecord.installedAt,
        recentActivity
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // On-demand Shopify data synchronization
  router.post('/shopify/sync', async (req, res) => {
    const shopRecord = req.shopRecord;
    try {
      const syncResult = await syncShopifyData(shopRecord.domain);
      return res.json({ ok: true, result: syncResult });
    } catch (err) {
      console.error('Failed to sync Shopify data:', err);
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // Products listing from DB
  router.get('/products', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { search, page = 1, limit = 50 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const skip = (pageNum - 1) * limitNum;

      const where = { shopId: shopRecord.id };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.product.count({ where })
      ]);

      return res.json({ products, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // Orders listing with search, filtering, and pagination
  router.get('/orders', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { search, status, startDate, endDate, page = 1, limit = 50 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const skip = (pageNum - 1) * limitNum;

      const where = { shopId: shopRecord.id };

      if (status && status !== 'all') {
        if (status === 'confirmed') where.status = 'Confirmed';
        else if (status === 'cancelled') where.status = 'Cancelled';
        else if (status === 'pending') {
          where.status = { notIn: ['Confirmed', 'Cancelled'] };
        } else if (status === 'failed') {
          where.callStatus = { in: ['failed', 'busy', 'no-answer'] };
        }
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      if (search && search.trim()) {
        const q = search.trim();
        where.OR = [
          { id: { contains: q, mode: 'insensitive' } },
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { tag: { contains: q, mode: 'insensitive' } },
          { callSid: { contains: q, mode: 'insensitive' } },
          { payload: { contains: q, mode: 'insensitive' } }
        ];
      }

      const [rows, total, confirmedCount, pendingCount, cancelledCount] = await Promise.all([
        prisma.order.findMany({
          where,
          include: {
            customer: true,
            calls: {
              orderBy: { createdAt: 'desc' },
              take: 5
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.order.count({ where }),
        prisma.order.count({ where: { shopId: shopRecord.id, status: 'Confirmed' } }),
        prisma.order.count({ where: { shopId: shopRecord.id, status: { notIn: ['Confirmed', 'Cancelled'] } } }),
        prisma.order.count({ where: { shopId: shopRecord.id, status: 'Cancelled' } })
      ]);

      const orders = rows.map((r) => {
        let payload = {};
        try {
          payload = r.payload ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) : {};
        } catch (_) {
          payload = {};
        }

        const totalVal = r.totalAmount != null ? r.totalAmount : Number(payload?.current_total_price || payload?.total_price || 0);

        let rawPhone = r.customer?.phone || payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone || '';
        let formattedPhone = rawPhone;
        if (rawPhone && !rawPhone.startsWith('+')) {
          formattedPhone = '+92' + rawPhone.replace(/^0/, '');
        }

        const customerName = r.customer
          ? `${r.customer.firstName || ''} ${r.customer.lastName || ''}`.trim() || r.customer.phone
          : payload?.shipping_address?.name || (payload?.customer ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() : '') || 'Customer';

        const lineItems = payload?.line_items || [];
        const productName = lineItems[0]?.title ? (lineItems.length > 1 ? `${lineItems[0].title} (+${lineItems.length - 1} more)` : lineItems[0].title) : 'Order Items';

        const shippingAddress = payload?.shipping_address ? {
          address1: payload.shipping_address.address1 || '',
          address2: payload.shipping_address.address2 || '',
          city: payload.shipping_address.city || '',
          province: payload.shipping_address.province || '',
          country: payload.shipping_address.country || 'Pakistan',
          zip: payload.shipping_address.zip || ''
        } : null;

        return {
          id: r.id,
          orderNumber: r.orderNumber || payload?.name || r.id,
          status: r.status,
          tag: r.tag,
          risk: r.riskScore,
          callStatus: r.callStatus || 'pending',
          callSid: r.callSid,
          retryCount: r.retryCount || 0,
          shop: shopRecord.name || shopRecord.domain,
          customer: customerName,
          customerName,
          productName,
          city: payload?.shipping_address?.city || '',
          phone: formattedPhone,
          payment: (payload?.payment_gateway_names || []).join(', ') || 'Cash on Delivery (COD)',
          total: totalVal,
          totalAmount: totalVal,
          shippingAddress,
          items: lineItems.map((li) => ({
            id: li.id,
            title: li.title,
            variant: li.variant_title,
            qty: li.quantity,
            price: parseFloat(li.price || 0)
          })),
          recentCalls: r.calls || [],
          courierName: r.courierName,
          trackingNumber: r.trackingNumber,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt
        };
      });

      return res.json({
        orders,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        counts: {
          total: confirmedCount + pendingCount + cancelledCount,
          confirmed: confirmedCount,
          pending: pendingCount,
          cancelled: cancelledCount
        }
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // Calls listing with search, filtering, and full order context
  router.get('/calls', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { search, status, page = 1, limit = 50 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
      const skip = (pageNum - 1) * limitNum;

      // Sync check: ensure orders with call activity have a corresponding Call record
      try {
        const unlinkedOrders = await prisma.order.findMany({
          where: {
            shopId: shopRecord.id,
            callSid: { not: null },
            calls: { none: {} }
          },
          take: 25
        });

        for (const uo of unlinkedOrders) {
          await prisma.call.create({
            data: {
              shopId: shopRecord.id,
              orderId: uo.id,
              outcome: uo.callStatus || 'completed',
              intent: 'Order Confirmation',
              sentiment: uo.status === 'Confirmed' ? 'Positive' : uo.status === 'Cancelled' ? 'Negative' : 'Neutral',
              providerCallSid: uo.callSid,
              durationSec: uo.callStatus === 'completed' ? 45 : 0,
              createdAt: uo.lastCallAt || uo.updatedAt || uo.createdAt
            }
          }).catch(() => {});
        }
      } catch (_) {}

      const where = { shopId: shopRecord.id };
      if (status && status !== 'all') {
        const s = String(status).toLowerCase();
        if (s === 'confirmed') {
          where.OR = [
            { outcome: { in: ['confirmed', 'CONFIRMED'] } },
            { order: { status: 'Confirmed' } }
          ];
        } else if (s === 'rejected') {
          where.OR = [
            { outcome: { in: ['rejected', 'cancelled', 'REJECTED'] } },
            { order: { status: 'Cancelled' } }
          ];
        } else if (s === 'no_answer' || s === 'no-answer' || s === 'busy') {
          where.outcome = { in: ['no_answer', 'no-answer', 'busy', 'NO_ANSWER', 'BUSY'] };
        } else if (s === 'calling' || s === 'in-progress' || s === 'ringing') {
          where.outcome = { in: ['calling', 'ringing', 'in-progress', 'in_progress'] };
        } else if (s === 'queued' || s === 'pending') {
          where.outcome = { in: ['queued', 'pending'] };
        } else if (s === 'completed') {
          where.outcome = { in: ['completed', 'confirmed'] };
        } else if (s === 'failed') {
          where.outcome = { in: ['failed', 'canceled', 'busy', 'no-answer', 'no_answer', 'FAILED'] };
        } else {
          where.outcome = { equals: status, mode: 'insensitive' };
        }
      }

      if (search && search.trim()) {
        const q = search.trim();
        const searchConditions = [
          { orderId: { contains: q, mode: 'insensitive' } },
          { providerCallSid: { contains: q, mode: 'insensitive' } },
          { intent: { contains: q, mode: 'insensitive' } },
          { outcome: { contains: q, mode: 'insensitive' } }
        ];
        if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: searchConditions }];
          delete where.OR;
        } else {
          where.OR = searchConditions;
        }
      }

      const [rows, total, completedCount, failedCount] = await Promise.all([
        prisma.call.findMany({
          where,
          include: {
            order: {
              include: {
                customer: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.call.count({ where }),
        prisma.call.count({ where: { shopId: shopRecord.id, outcome: 'completed' } }),
        prisma.call.count({ where: { shopId: shopRecord.id, outcome: { in: ['failed', 'busy', 'no-answer', 'no_answer'] } } })
      ]);

      const calls = rows.map((c) => {
        let payload = {};
        if (c.order?.payload) {
          try {
            payload = typeof c.order.payload === 'string' ? JSON.parse(c.order.payload) : c.order.payload;
          } catch (_) {}
        }

        const customerName = c.order?.customer
          ? `${c.order.customer.firstName || ''} ${c.order.customer.lastName || ''}`.trim() || c.order.customer.phone
          : payload?.shipping_address?.name || payload?.customer?.first_name || 'Customer';

        let rawPhone = c.order?.customer?.phone || payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone || '';
        let formattedPhone = rawPhone;
        if (rawPhone && !rawPhone.startsWith('+')) {
          formattedPhone = '+92' + rawPhone.replace(/^0/, '');
        }

        const lineItems = payload?.line_items || [];
        const productName = lineItems[0]?.title || 'Store Items';

        return {
          id: c.id,
          orderId: c.orderId,
          orderNumber: c.order?.orderNumber || payload?.name || c.orderId,
          customerName,
          phone: formattedPhone,
          productName,
          status: c.outcome || 'completed',
          outcome: c.outcome || 'completed',
          durationSec: c.durationSec || (c.outcome === 'completed' ? 45 : 0),
          intent: c.intent || 'Order Confirmation',
          sentiment: c.sentiment || 'Neutral',
          recordingUrl: c.recordingUrl || null,
          transcript: c.transcript || null,
          callSid: c.providerCallSid || c.order?.callSid || '',
          orderStatus: c.order?.status || 'Pending Confirmation',
          totalAmount: c.order?.totalAmount || Number(payload?.total_price || 0),
          retryCount: c.order?.retryCount || 0,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        };
      });

      return res.json({
        calls,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        stats: {
          totalCalls: total,
          completedCalls: completedCount,
          failedCalls: failedCount,
          activeCalls: Math.max(0, total - completedCount - failedCount)
        }
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
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
    try {
      const shopRecord = req.shopRecord;
      const { orderId } = req.params;

      const orderRow = await prisma.order.findUnique({
        where: { id: orderId }
      });

      if (!orderRow || orderRow.shopId !== shopRecord.id) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const { CallWorkflowService } = await import('../services/callWorkflowService.js');
      const result = await CallWorkflowService.initiateCall({
        orderId,
        shopDomain: shopRecord.domain,
        force: true // Manual merchant call
      });

      if (!result.success) {
        return res.status(400).json({ error: result.reason || 'Failed to initiate call' });
      }

      return res.json({ ok: true, callId: result.callId, providerCallSid: result.providerCallSid });
    } catch (err) {
      console.error('Call initiation error:', err);
      return res.status(500).json({ error: String(err.message || err) });
    }
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

  // ========================================================
  // Phase 3 Step 3: Conversation Inbox APIs
  // ========================================================

  router.get('/conversations', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { status, search, page = 1, limit = 50 } = req.query;

      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 50;
      const skip = (pageNum - 1) * limitNum;

      const where = { shopId: shopRecord.id };
      if (status) {
        where.status = status;
      }
      if (search) {
        where.customer = {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } }
          ]
        };
      }

      const [rows, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          include: {
            customer: true,
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.conversation.count({ where })
      ]);

      const convIds = rows.map(c => c.id);
      const aiLogs = await prisma.aIInteractionLog.findMany({
        where: {
          shopId: shopRecord.id,
          conversationId: { in: convIds }
        },
        orderBy: { createdAt: 'desc' }
      });

      const aiLogByConv = {};
      for (const log of aiLogs) {
        if (log.conversationId && !aiLogByConv[log.conversationId]) {
          aiLogByConv[log.conversationId] = log;
        }
      }

      const conversations = rows.map(c => {
        const latestLog = aiLogByConv[c.id];
        const lastMsg = c.messages[0] || null;
        const custName = [c.customer?.firstName, c.customer?.lastName].filter(Boolean).join(' ') || c.customer?.phone || 'Customer';

        return {
          id: c.id,
          customer: {
            id: c.customer?.id || null,
            name: custName,
            phone: c.customer?.phone || '',
            shop: shopRecord.domain
          },
          lastMessage: lastMsg ? {
            id: lastMsg.id,
            text: lastMsg.text,
            sender: lastMsg.sender,
            createdAt: lastMsg.createdAt
          } : null,
          status: c.status,
          assignedTo: c.assignedTo || null,
          isTakeover: Boolean(c.isTakeover),
          unreadCount: c.status === 'ACTIVE' && lastMsg?.sender === 'customer' ? 1 : 0,
          lastAgent: latestLog?.detectedAgent || 'support_agent',
          lastIntent: latestLog?.intent || 'general_query',
          confidence: 0.95
        };
      });

      return res.json({
        conversations,
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.get('/conversations/:id', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { id } = req.params;

      const conversation = await prisma.conversation.findUnique({
        where: { id },
        include: {
          customer: true,
          messages: {
            orderBy: { createdAt: 'asc' }
          }
        }
      });

      if (!conversation || conversation.shopId !== shopRecord.id) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const aiLogs = await prisma.aIInteractionLog.findMany({
        where: {
          shopId: shopRecord.id,
          conversationId: id
        },
        orderBy: { createdAt: 'asc' }
      });

      const custName = [conversation.customer?.firstName, conversation.customer?.lastName].filter(Boolean).join(' ') || conversation.customer?.phone || 'Customer';

      return res.json({
        id: conversation.id,
        status: conversation.status,
        assignedTo: conversation.assignedTo,
        isTakeover: Boolean(conversation.isTakeover),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        customer: {
          id: conversation.customer?.id || null,
          name: custName,
          phone: conversation.customer?.phone || '',
          shop: shopRecord.domain
        },
        messages: conversation.messages.map(m => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          mediaUrl: m.mediaUrl,
          createdAt: m.createdAt
        })),
        aiLogs: aiLogs.map(l => ({
          id: l.id,
          agent: l.detectedAgent,
          intent: l.intent,
          action: l.action,
          confidence: 0.95,
          timestamp: l.createdAt
        }))
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.post('/conversations/:id/reply', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { id } = req.params;
      const { text, message } = req.body || {};
      const replyText = (text || message || '').trim();

      if (!replyText) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id },
        include: { customer: true }
      });

      if (!conversation || conversation.shopId !== shopRecord.id) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const savedMessage = await prisma.message.create({
        data: {
          conversationId: id,
          sender: 'agent',
          text: replyText
        }
      });

      await prisma.conversation.update({
        where: { id },
        data: { updatedAt: new Date() }
      });

      // Forward to WhatsApp AKG if session is active
      try {
        const integration = await prisma.whatsAppIntegration.findFirst({
          where: { shopId: shopRecord.id, isActive: true }
        });

        if (integration?.sessionId && conversation.customer?.phone) {
          const { WhatsAppClient } = await import('../integrations/whatsapp/client.js');
          const waClient = new WhatsAppClient({
            baseUrl: process.env.WA_AKG_BASE_URL,
            apiKey: process.env.WA_AKG_API_KEY,
            sessionId: String(integration.sessionId),
            shopId: String(shopRecord.id)
          });
          const cleanPhone = conversation.customer.phone.replace(/[^0-9]/g, '');
          const jid = `${cleanPhone}@s.whatsapp.net`;
          await waClient.sendMessage(jid, replyText);
        }
      } catch (waErr) {
        console.warn('[Dashboard Reply] WhatsApp send notice:', waErr.message);
      }

      return res.json({ ok: true, message: savedMessage });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.patch('/conversations/:id', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { id } = req.params;
      const { status, assignedTo, isTakeover } = req.body || {};

      const conversation = await prisma.conversation.findUnique({
        where: { id }
      });

      if (!conversation || conversation.shopId !== shopRecord.id) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const dataToUpdate = {};
      if (status !== undefined) {
        dataToUpdate.status = status;
        if (status === 'HUMAN_TAKEOVER') {
          dataToUpdate.isTakeover = true;
        } else if (status === 'ACTIVE' || status === 'RESOLVED') {
          if (isTakeover === undefined) {
            dataToUpdate.isTakeover = false;
          }
        }
      }
      if (isTakeover !== undefined) {
        dataToUpdate.isTakeover = Boolean(isTakeover);
        if (isTakeover && !status) {
          dataToUpdate.status = 'HUMAN_TAKEOVER';
        }
      }
      if (assignedTo !== undefined) {
        dataToUpdate.assignedTo = assignedTo;
      }

      const updated = await prisma.conversation.update({
        where: { id },
        data: dataToUpdate
      });

      return res.json({ ok: true, conversation: updated });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // ========================================================
  // Phase 3 Step 3: Customer Intelligence APIs
  // ========================================================

  router.get('/customers', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { search, page = 1, limit = 50 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 50;
      const skip = (pageNum - 1) * limitNum;

      const where = { shopId: shopRecord.id };
      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            profileMemory: true,
            orders: { select: { id: true, totalAmount: true } },
            conversations: { select: { id: true, updatedAt: true } }
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.customer.count({ where })
      ]);

      const customers = rows.map(c => {
        const ordersCount = c.orders.length;
        const totalSpend = c.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || 'Customer';

        return {
          id: c.id,
          name,
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          email: c.email,
          ordersCount,
          totalSpend,
          conversationsCount: c.conversations.length,
          profileMemory: c.profileMemory ? {
            preferredCategories: c.profileMemory.preferredCategories,
            preferredProducts: c.profileMemory.preferredProducts,
            averageBudget: c.profileMemory.averageBudget,
            customerPreferences: c.profileMemory.customerPreferences,
            interactionSummary: c.profileMemory.interactionSummary
          } : null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        };
      });

      return res.json({ customers, total, page: pageNum, pages: Math.ceil(total / limitNum) });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.get('/customers/:id', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { id } = req.params;

      const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          profileMemory: true,
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 20
          },
          conversations: {
            include: {
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 5
              }
            },
            orderBy: { updatedAt: 'desc' },
            take: 10
          }
        }
      });

      if (!customer || customer.shopId !== shopRecord.id) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const totalSpending = customer.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const interactionLogsCount = await prisma.aIInteractionLog.count({
        where: { shopId: shopRecord.id, customerId: id }
      });

      let preferredCategories = [];
      let preferredProducts = [];
      if (customer.profileMemory?.preferredCategories) {
        try {
          preferredCategories = JSON.parse(customer.profileMemory.preferredCategories);
        } catch (_) {
          preferredCategories = [customer.profileMemory.preferredCategories];
        }
      }
      if (customer.profileMemory?.preferredProducts) {
        try {
          preferredProducts = JSON.parse(customer.profileMemory.preferredProducts);
        } catch (_) {
          preferredProducts = [customer.profileMemory.preferredProducts];
        }
      }

      return res.json({
        customer: {
          id: customer.id,
          name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.phone || 'Customer',
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          email: customer.email,
          firstInteraction: customer.createdAt,
          lastInteraction: customer.updatedAt,
          totalInteractions: interactionLogsCount || customer.conversations.length,
          totalSpending,
          ordersCount: customer.orders.length,
          profileMemory: {
            preferredCategories,
            preferredProducts,
            averageBudget: customer.profileMemory?.averageBudget || null,
            purchaseFrequency: customer.profileMemory?.purchaseFrequency || null,
            customerPreferences: customer.profileMemory?.customerPreferences || null,
            interactionSummary: customer.profileMemory?.interactionSummary || null,
            lastPurchaseSummary: customer.profileMemory?.lastPurchaseSummary || null
          },
          orders: customer.orders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            totalAmount: o.totalAmount,
            courierName: o.courierName,
            trackingNumber: o.trackingNumber,
            trackingStatus: o.trackingStatus,
            createdAt: o.createdAt
          })),
          conversations: customer.conversations.map(c => ({
            id: c.id,
            status: c.status,
            assignedTo: c.assignedTo,
            isTakeover: Boolean(c.isTakeover),
            updatedAt: c.updatedAt,
            lastMessage: c.messages[0]?.text || ''
          }))
        }
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // ========================================================
  // Phase 3 Step 3: AI Analytics APIs
  // ========================================================

  router.get('/analytics/overview', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;

      const [totalConversations, totalMessages, aiResolvedConversations, humanEscalations, logs] = await Promise.all([
        prisma.conversation.count({ where: { shopId: shopRecord.id } }),
        prisma.message.count({ where: { conversation: { shopId: shopRecord.id } } }),
        prisma.conversation.count({ where: { shopId: shopRecord.id, status: 'RESOLVED', isTakeover: false } }),
        prisma.conversation.count({ where: { shopId: shopRecord.id, OR: [{ status: 'HUMAN_TAKEOVER' }, { isTakeover: true }] } }),
        prisma.aIInteractionLog.findMany({ where: { shopId: shopRecord.id } })
      ]);

      const totalLogs = logs.length;
      let fallbackCount = 0;
      let totalTime = 0;
      let timeCount = 0;

      for (const log of logs) {
        if (log.fallbackUsed) fallbackCount++;
        if (log.responseTimeMs > 0) {
          totalTime += log.responseTimeMs;
          timeCount++;
        }
      }

      const fallbackRate = totalLogs > 0 ? Number(((fallbackCount / totalLogs) * 100).toFixed(1)) : 0;
      const averageResponseTime = timeCount > 0 ? Math.round(totalTime / timeCount) : 0;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentConversations = await prisma.conversation.findMany({
        where: {
          shopId: shopRecord.id,
          createdAt: { gte: sevenDaysAgo }
        },
        select: { createdAt: true }
      });

      const dayMap = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dayMap[key] = 0;
      }
      for (const c of recentConversations) {
        const key = c.createdAt.toISOString().split('T')[0];
        if (dayMap[key] !== undefined) dayMap[key]++;
      }
      const dailyConversations = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

      return res.json({
        totalConversations,
        totalMessages,
        aiResolvedConversations,
        humanEscalations,
        fallbackRate,
        averageResponseTime,
        dailyConversations
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.get('/analytics/intents', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const logs = await prisma.aIInteractionLog.findMany({
        where: { shopId: shopRecord.id }
      });

      const total = logs.length;
      const intentMap = {};
      for (const log of logs) {
        if (log.intent) {
          intentMap[log.intent] = (intentMap[log.intent] || 0) + 1;
        }
      }

      const intents = Object.entries(intentMap)
        .map(([intent, count]) => ({
          intent,
          count,
          percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0
        }))
        .sort((a, b) => b.count - a.count);

      return res.json({ intents, total });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.get('/analytics/agents', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const logs = await prisma.aIInteractionLog.findMany({
        where: { shopId: shopRecord.id }
      });

      const total = logs.length;
      const agentMap = {};
      for (const log of logs) {
        if (log.detectedAgent) {
          agentMap[log.detectedAgent] = (agentMap[log.detectedAgent] || 0) + 1;
        }
      }

      const agents = Object.entries(agentMap)
        .map(([agent, count]) => ({
          agent,
          count,
          percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0
        }))
        .sort((a, b) => b.count - a.count);

      return res.json({ agents, total });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // ========================================================
  // Phase 3 Step 3: Commerce Analytics APIs
  // ========================================================

  router.get('/analytics/products', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;

      const [products, productLogs] = await Promise.all([
        prisma.product.findMany({
          where: { shopId: shopRecord.id }
        }),
        prisma.aIInteractionLog.findMany({
          where: {
            shopId: shopRecord.id,
            detectedAgent: 'product_agent'
          },
          take: 100
        })
      ]);

      const lowStockProducts = products.filter(p => p.stock > 0 && p.stock <= 5);
      const outOfStockProducts = products.filter(p => p.stock <= 0);

      const searchCounts = {};
      for (const log of productLogs) {
        const msg = (log.userMessage || '').toLowerCase();
        for (const p of products) {
          if (msg.includes(p.name.toLowerCase())) {
            searchCounts[p.name] = (searchCounts[p.name] || 0) + 1;
          }
        }
      }

      const mostSearched = products
        .map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          price: p.price,
          stock: p.stock,
          searchCount: searchCounts[p.name] || (p.stock > 0 ? 1 : 0)
        }))
        .sort((a, b) => b.searchCount - a.searchCount)
        .slice(0, 10);

      const unavailableProducts = outOfStockProducts.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        queries: searchCounts[p.name] || 1
      }));

      return res.json({
        mostSearched,
        unavailableProducts,
        lowStockProducts: lowStockProducts.map(p => ({ id: p.id, name: p.name, category: p.category, stock: p.stock, price: p.price })),
        outOfStockProducts: outOfStockProducts.map(p => ({ id: p.id, name: p.name, category: p.category, price: p.price }))
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.get('/analytics/orders', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;

      const [orders, orderLogs] = await Promise.all([
        prisma.order.findMany({
          where: { shopId: shopRecord.id },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.aIInteractionLog.findMany({
          where: {
            shopId: shopRecord.id,
            detectedAgent: 'order_agent'
          }
        })
      ]);

      let orderQueriesCount = 0;
      let cancellationRequestsCount = 0;

      for (const log of orderLogs) {
        if (log.intent === 'order_status' || log.intent === 'confirm_order') {
          orderQueriesCount++;
        } else if (log.intent === 'order_cancel' || log.intent === 'cancel_order') {
          cancellationRequestsCount++;
        }
      }

      const statusBreakdown = {
        pending: 0,
        confirmed: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0
      };

      let totalRevenue = 0;
      for (const order of orders) {
        const s = (order.status || '').toLowerCase();
        if (s.includes('cancel')) statusBreakdown.cancelled++;
        else if (s.includes('deliver')) {
          statusBreakdown.delivered++;
          totalRevenue += order.totalAmount || 0;
        }
        else if (s.includes('ship')) statusBreakdown.shipped++;
        else if (s.includes('confirm')) {
          statusBreakdown.confirmed++;
          totalRevenue += order.totalAmount || 0;
        }
        else statusBreakdown.pending++;
      }

      return res.json({
        totalOrders: orders.length,
        orderQueriesCount,
        cancellationRequestsCount,
        statusBreakdown,
        totalRevenue,
        recentOrders: orders.slice(0, 10).map(o => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          totalAmount: o.totalAmount,
          createdAt: o.createdAt
        }))
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // ========================================================
  // Phase 4: Automated COD Confirmation Analytics API
  // ========================================================
  router.get('/analytics/cod', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { range = '7d' } = req.query;

      let sinceDate;
      const now = new Date();
      if (range === 'today') {
        sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (range === '30d') {
        sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      } else {
        // default 7d
        sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }

      const [orders, calls, fallbackLogs] = await Promise.all([
        prisma.order.findMany({
          where: {
            shopId: shopRecord.id,
            createdAt: { gte: sinceDate }
          },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            callStatus: true,
            retryCount: true,
            createdAt: true
          }
        }),
        prisma.call.findMany({
          where: {
            shopId: shopRecord.id,
            createdAt: { gte: sinceDate }
          },
          select: {
            id: true,
            outcome: true,
            durationSec: true,
            createdAt: true
          }
        }),
        prisma.complianceLog.count({
          where: {
            shopDomain: shopRecord.domain,
            event: { contains: 'whatsapp_fallback', mode: 'insensitive' },
            createdAt: { gte: sinceDate }
          }
        })
      ]);

      const ordersReceived = orders.length;
      const confirmedOrders = orders.filter(o => o.status === 'Confirmed').length;
      const rejectedOrders = orders.filter(o => o.status === 'Cancelled').length;
      const ordersCalled = orders.filter(o => o.callStatus && o.callStatus !== 'pending').length;

      const completedCalls = calls.filter(c => ['completed', 'confirmed'].includes(c.outcome?.toLowerCase())).length;
      const noAnswerCalls = calls.filter(c => ['no_answer', 'no-answer', 'busy', 'NO_ANSWER'].includes(c.outcome?.toLowerCase())).length;
      const failedCalls = calls.filter(c => ['failed', 'canceled', 'FAILED'].includes(c.outcome?.toLowerCase())).length;

      const confirmationRate = ordersReceived > 0 ? Math.round((confirmedOrders / ordersReceived) * 100) : 0;
      const rejectionRate = ordersReceived > 0 ? Math.round((rejectedOrders / ordersReceived) * 100) : 0;
      const noAnswerRate = calls.length > 0 ? Math.round((noAnswerCalls / calls.length) * 100) : 0;

      const totalDuration = calls.reduce((acc, c) => acc + (c.durationSec || 0), 0);
      const avgCallDuration = calls.length > 0 ? Math.round(totalDuration / calls.length) : 0;

      const unreachableCalls = noAnswerCalls + failedCalls;
      const whatsappFallbackRate = unreachableCalls > 0
        ? Math.min(100, Math.round((fallbackLogs / unreachableCalls) * 100))
        : 0;

      return res.json({
        range,
        sinceDate,
        ordersReceived,
        ordersCalled,
        confirmedOrders,
        rejectedOrders,
        confirmationRate,
        rejectionRate,
        noAnswerRate,
        avgCallDuration,
        successfulCalls: completedCalls,
        failedCalls,
        noAnswerCalls,
        totalCalls: calls.length,
        whatsappFallbackCount: fallbackLogs,
        whatsappFallbackRate
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  // ========================================================
  // Phase 3 Step 3: Shop Settings APIs
  // ========================================================

  router.get('/shop/settings', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const [shop, integration] = await Promise.all([
        prisma.shop.findUnique({
          where: { id: shopRecord.id }
        }),
        prisma.whatsAppIntegration.findFirst({
          where: { shopId: shopRecord.id, isActive: true }
        })
      ]);

      let parsed = {};
      if (shop?.settings) {
        try {
          parsed = JSON.parse(shop.settings);
        } catch (_) {}
      }

      return res.json({
        profile: {
          shopName: shop?.name || shop?.domain || 'DialMate Store',
          shopDomain: shop?.domain || '',
          logo: shop?.logo || null,
          contact: shop?.contact || null
        },
        aiSettings: {
          aiName: parsed.aiName || 'DialMate AI',
          tone: parsed.tone || 'Professional & Courteous',
          language: parsed.language || 'Roman Urdu & English',
          fallbackMessage: parsed.fallbackMessage || 'Jee, main aap ki madad ke liye hazir hoon. Aap apna sawal bata dein.'
        },
        businessRules: {
          workingHours: parsed.workingHours || '9:00 AM - 9:00 PM',
          escalationNumber: parsed.escalationNumber || '+923001234567'
        },
        aiCalling: {
          enabled: parsed.aiCalling?.enabled !== false,
          maxAttempts: Number(parsed.aiCalling?.maxAttempts || 3),
          retryDelayMinutes: Number(parsed.aiCalling?.retryDelayMinutes || 15),
          callingHours: parsed.aiCalling?.callingHours || parsed.workingHours || '09:00 - 21:00',
          language: parsed.aiCalling?.language || 'Roman Urdu & English'
        },
        orderRules: {
          codOnly: parsed.orderRules?.codOnly !== false,
          minOrderValue: Number(parsed.orderRules?.minOrderValue || 0),
          maxOrderValue: Number(parsed.orderRules?.maxOrderValue || 500000),
          excludedTags: parsed.orderRules?.excludedTags || 'VIP, PREPAID, NO_CALL'
        },
        whatsapp: {
          enableFallback: parsed.whatsapp?.enableFallback !== false,
          templateLanguage: parsed.whatsapp?.templateLanguage || 'roman_urdu',
          isConnected: Boolean(integration?.isActive),
          sessionId: integration?.sessionId || null,
          provider: integration?.provider || 'WA-AKG',
          status: integration?.isActive ? 'CONNECTED' : 'DISCONNECTED'
        }
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.put('/shop/settings', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const { profile, aiSettings, businessRules, aiCalling, orderRules, whatsapp } = req.body || {};

      const shop = await prisma.shop.findUnique({
        where: { id: shopRecord.id }
      });

      let currentSettings = {};
      if (shop?.settings) {
        try {
          currentSettings = JSON.parse(shop.settings);
        } catch (_) {}
      }

      const updatedSettings = {
        ...currentSettings,
        ...(aiSettings || {}),
        ...(businessRules || {}),
        aiCalling: {
          ...(currentSettings.aiCalling || {}),
          ...(aiCalling || {})
        },
        orderRules: {
          ...(currentSettings.orderRules || {}),
          ...(orderRules || {})
        },
        whatsapp: {
          ...(currentSettings.whatsapp || {}),
          ...(whatsapp || {})
        }
      };

      const updateData = {
        settings: JSON.stringify(updatedSettings)
      };

      if (profile?.shopName !== undefined) updateData.name = profile.shopName;
      if (profile?.logo !== undefined) updateData.logo = profile.logo;
      if (profile?.contact !== undefined) updateData.contact = profile.contact;

      const saved = await prisma.shop.update({
        where: { id: shopRecord.id },
        data: updateData
      });

      return res.json({
        ok: true,
        profile: {
          shopName: saved.name || saved.domain,
          shopDomain: saved.domain,
          logo: saved.logo,
          contact: saved.contact
        },
        aiSettings: {
          aiName: updatedSettings.aiName || 'DialMate AI',
          tone: updatedSettings.tone || 'Professional & Courteous',
          language: updatedSettings.language || 'Roman Urdu & English',
          fallbackMessage: updatedSettings.fallbackMessage || 'Jee, main aap ki madad ke liye hazir hoon. Aap apna sawal bata dein.'
        },
        businessRules: {
          workingHours: updatedSettings.workingHours || '9:00 AM - 9:00 PM',
          escalationNumber: updatedSettings.escalationNumber || '+923001234567'
        },
        aiCalling: updatedSettings.aiCalling,
        orderRules: updatedSettings.orderRules,
        whatsapp: updatedSettings.whatsapp
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  return router;
}