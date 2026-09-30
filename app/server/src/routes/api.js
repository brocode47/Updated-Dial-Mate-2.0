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

  router.get('/features', (req, res) => {
    return res.json(config);
  });

  router.use(tenantMiddleware);

  // High-level dashboard summary metrics
  router.get('/dashboard/stats', async (req, res) => {
    try {
      const shopRecord = req.shopRecord;
      const [orders, customersCount, productsCount] = await Promise.all([
        prisma.order.findMany({
          where: { shopId: shopRecord.id },
          select: { status: true, totalAmount: true, callStatus: true }
        }),
        prisma.customer.count({ where: { shopId: shopRecord.id } }),
        prisma.product.count({ where: { shopId: shopRecord.id } })
      ]);

      const confirmed = orders.filter(o => o.status === 'Confirmed');
      const cancelled = orders.filter(o => o.status === 'Cancelled');
      const pending = orders.filter(o => o.status !== 'Confirmed' && o.status !== 'Cancelled');
      const completedCalls = orders.filter(o => o.callStatus === 'completed');

      const totalRevenue = confirmed.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const connectionRate = orders.length ? Math.round((completedCalls.length / orders.length) * 100) : 0;

      return res.json({
        totalOrders: orders.length,
        confirmedOrders: confirmed.length,
        cancelledOrders: cancelled.length,
        pendingOrders: pending.length,
        totalRevenue,
        connectionRate,
        customersCount,
        productsCount
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
      const products = await prisma.product.findMany({
        where: { shopId: shopRecord.id },
        orderBy: { updatedAt: 'desc' },
        take: 200
      });
      return res.json({ products });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  router.get('/orders', async (req, res) => {
    const shopRecord = req.shopRecord;

    const rows = await prisma.order.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });

    const orders = rows.map((r) => {
      let payload = {};
      try {
        payload = r.payload ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) : {};
      } catch (e) {
        payload = {};
      }

      const totalVal = r.totalAmount != null ? r.totalAmount : Number(payload?.current_total_price || payload?.total_price || 0);

      return {
        id: r.id,
        orderNumber: r.orderNumber || payload?.name || r.id,
        status: r.status,
        tag: r.tag,
        risk: r.riskScore,
        callStatus: r.callStatus || 'pending',
        callSid: r.callSid,
        retryCount: r.retryCount || 0,
        whatsappSent: r.whatsappSent || 0,

        shop: shopRecord.name || shopRecord.domain,
        customer: payload?.shipping_address?.name || payload?.customer?.first_name || 'Customer',
        customerName: payload?.shipping_address?.name || (payload?.customer ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() : '') || 'Customer',
        productName: (payload?.line_items || [])[0]?.title || 'Order Items',
        city: payload?.shipping_address?.city || '',
        phone: payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone || '',
        payment: (payload?.payment_gateway_names || []).join(', ') || 'Unknown',
        total: totalVal,
        totalAmount: totalVal,
        items: (payload?.line_items || []).slice(0, 3).map((li) => ({
          title: li.title,
          variant: li.variant_title,
          qty: li.quantity
        })),
        createdAt: r.createdAt,
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
        whatsapp: {
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
      const { profile, aiSettings, businessRules } = req.body || {};

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
        ...(businessRules || {})
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
        }
      });
    } catch (err) {
      return res.status(500).json({ error: String(err.message || err) });
    }
  });

  return router;
}