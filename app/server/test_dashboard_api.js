/**
 * DialMate 2.0 - Phase 3 Step 3 Merchant Control Center & AI Analytics Console Test Suite
 * 
 * Verifies:
 * 1. Conversation Inbox:
 *    - List conversations with contract fields { id, customer, lastMessage, status, assignedTo, unreadCount, lastAgent, lastIntent, confidence }
 *    - Filter by status (ACTIVE, HUMAN_TAKEOVER, RESOLVED)
 *    - Search customers by name/phone
 *    - Conversation details with messages and AI interaction logs
 *    - Merchant manual reply (POST /reply) & WhatsApp AKG forwarding
 *    - Status update & Human Takeover toggle (PATCH)
 * 2. Customer Intelligence:
 *    - Customer list with spend and order counts
 *    - Customer profile dossier with AI memory (categories, products, budget, preferences, summary)
 *    - Purchase history and order timeline
 * 3. AI Analytics Dashboard:
 *    - Overview KPIs (total conversations, messages, AI resolved, escalations, fallback rate, avg response time)
 *    - Daily conversation trend
 *    - Top intents breakdown
 *    - Agent utilization distribution
 * 4. Commerce Analytics:
 *    - Product catalog demand & most searched items
 *    - Low stock alerts and unavailable requested inventory
 *    - Order inquiries and cancellation request metrics
 * 5. Shop Settings:
 *    - Business profile, AI persona, working hours, escalation contact
 *    - WhatsApp AKG session status
 *    - Update settings via PUT
 * 6. Multi-Tenant Security Isolation:
 *    - Merchant A CANNOT view, reply to, or resolve Merchant B conversations
 *    - Merchant A CANNOT view Merchant B customer dossiers or order history
 *    - Merchant A analytics have zero cross-tenant leakage
 */

import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { apiRouter } from './src/routes/api.js';
import { prisma } from './src/lib/db.js';
import { WhatsAppClient } from './src/integrations/whatsapp/client.js';

let passedTests = 0;
let totalTests = 0;

function reportTest(name, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`✅ PASS: ${name} ${details ? '(' + details + ')' : ''}`);
  } else {
    console.error(`❌ FAIL: ${name} ${details ? '(' + details + ')' : ''}`);
  }
}

// Global Spy for WhatsApp outbound replies
const capturedOutboundWhatsApp = [];
WhatsAppClient.prototype.sendMessage = async function(to, text, options) {
  capturedOutboundWhatsApp.push({
    sessionId: this.sessionId,
    shopId: this.shopId,
    to,
    text,
    options
  });
  return { success: true, messageId: 'wa-ack-test-999' };
};

// Test Fixtures
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-dialmate-2026';
process.env.JWT_SECRET = JWT_SECRET;

const tokenAlpha = jwt.sign({ shopDomain: 'store-alpha.myshopify.com' }, JWT_SECRET, { expiresIn: '1h' });
const tokenBeta = jwt.sign({ shopDomain: 'store-beta.myshopify.com' }, JWT_SECRET, { expiresIn: '1h' });

const db = {
  shops: [
    {
      id: 'shop-uuid-alpha',
      organizationId: 'org-alpha',
      domain: 'store-alpha.myshopify.com',
      name: 'Alpha Fashion Store',
      logo: 'https://cdn.store.com/logo-alpha.png',
      contact: '+923001111111',
      settings: JSON.stringify({
        aiName: 'AlphaBot',
        tone: 'Professional & Courteous',
        language: 'Roman Urdu & English',
        fallbackMessage: 'Hamari team jald aap se rabta karegi.',
        workingHours: '10:00 AM - 10:00 PM',
        escalationNumber: '+923009998877'
      })
    },
    {
      id: 'shop-uuid-beta',
      organizationId: 'org-beta',
      domain: 'store-beta.myshopify.com',
      name: 'Beta Tech Store',
      logo: null,
      contact: '+923002222222',
      settings: null
    }
  ],
  customers: [
    {
      id: 'cust-alpha-1',
      shopId: 'shop-uuid-alpha',
      firstName: 'Ali',
      lastName: 'Khan',
      phone: '+923001234567',
      email: 'ali.khan@gmail.com',
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-29T12:00:00Z')
    },
    {
      id: 'cust-alpha-2',
      shopId: 'shop-uuid-alpha',
      firstName: 'Bilal',
      lastName: 'Ahmed',
      phone: '+923007654321',
      email: 'bilal.ahmed@yahoo.com',
      createdAt: new Date('2026-09-10T14:00:00Z'),
      updatedAt: new Date('2026-09-28T16:00:00Z')
    },
    {
      id: 'cust-beta-1',
      shopId: 'shop-uuid-beta',
      firstName: 'Tariq',
      lastName: 'Mehmood',
      phone: '+923334444444',
      email: 'tariq@beta.com',
      createdAt: new Date('2026-09-15T11:00:00Z'),
      updatedAt: new Date('2026-09-29T15:00:00Z')
    }
  ],
  customerProfileMemories: [
    {
      id: 'mem-alpha-1',
      customerId: 'cust-alpha-1',
      shopId: 'shop-uuid-alpha',
      preferredCategories: JSON.stringify(['Shoes', 'Jackets']),
      preferredProducts: JSON.stringify(['Leather Chelsea Boots', 'Denim Jacket']),
      averageBudget: 5500,
      purchaseFrequency: 'bi-weekly',
      customerPreferences: 'Prefers Cash on Delivery and evening deliveries',
      interactionSummary: 'Customer Ali regularly inquires about new shoe arrivals and size 42 availability.'
    }
  ],
  conversations: [
    {
      id: 'conv-alpha-1',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-1',
      status: 'ACTIVE',
      assignedTo: null,
      isTakeover: false,
      createdAt: new Date('2026-09-29T08:00:00Z'),
      updatedAt: new Date('2026-09-29T10:30:00Z')
    },
    {
      id: 'conv-alpha-2',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-2',
      status: 'HUMAN_TAKEOVER',
      assignedTo: 'Agent Hassan',
      isTakeover: true,
      createdAt: new Date('2026-09-28T09:00:00Z'),
      updatedAt: new Date('2026-09-28T11:00:00Z')
    },
    {
      id: 'conv-beta-1',
      shopId: 'shop-uuid-beta',
      customerId: 'cust-beta-1',
      status: 'ACTIVE',
      assignedTo: null,
      isTakeover: false,
      createdAt: new Date('2026-09-29T09:00:00Z'),
      updatedAt: new Date('2026-09-29T11:00:00Z')
    }
  ],
  messages: [
    {
      id: 'msg-alpha-1',
      conversationId: 'conv-alpha-1',
      sender: 'customer',
      text: 'Bhai shoes available hain?',
      createdAt: new Date('2026-09-29T10:28:00Z')
    },
    {
      id: 'msg-alpha-2',
      conversationId: 'conv-alpha-1',
      sender: 'assistant',
      text: 'Jee hamare paas boots aur sneakers available hain.',
      createdAt: new Date('2026-09-29T10:29:00Z')
    },
    {
      id: 'msg-alpha-3',
      conversationId: 'conv-alpha-2',
      sender: 'customer',
      text: 'Mujhe human representative se baat karni hai.',
      createdAt: new Date('2026-09-28T10:55:00Z')
    },
    {
      id: 'msg-beta-1',
      conversationId: 'conv-beta-1',
      sender: 'customer',
      text: 'Beta store laptop price?',
      createdAt: new Date('2026-09-29T10:00:00Z')
    }
  ],
  orders: [
    {
      id: 'order-alpha-1',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-1',
      orderNumber: 'ORD-9001',
      status: 'Delivered',
      totalAmount: 6500,
      courierName: 'TCS',
      trackingNumber: 'TCS-12345',
      trackingStatus: 'Delivered to recipient',
      createdAt: new Date('2026-09-20T10:00:00Z')
    },
    {
      id: 'order-alpha-2',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-1',
      orderNumber: 'ORD-9002',
      status: 'Confirmed',
      totalAmount: 3200,
      courierName: 'Leopards',
      trackingNumber: 'LEO-67890',
      trackingStatus: 'In Transit',
      createdAt: new Date('2026-09-27T14:00:00Z')
    },
    {
      id: 'order-beta-1',
      shopId: 'shop-uuid-beta',
      customerId: 'cust-beta-1',
      orderNumber: 'ORD-BETA-01',
      status: 'Confirmed',
      totalAmount: 95000,
      createdAt: new Date('2026-09-25T12:00:00Z')
    }
  ],
  products: [
    {
      id: 'prod-alpha-1',
      shopId: 'shop-uuid-alpha',
      name: 'Leather Chelsea Boots',
      category: 'Shoes',
      price: 5500,
      stock: 15
    },
    {
      id: 'prod-alpha-2',
      shopId: 'shop-uuid-alpha',
      name: 'Denim Casual Jacket',
      category: 'Jackets',
      price: 4200,
      stock: 3 // Low stock
    },
    {
      id: 'prod-alpha-3',
      shopId: 'shop-uuid-alpha',
      name: 'Suede Loafers',
      category: 'Shoes',
      price: 3800,
      stock: 0 // Out of stock
    },
    {
      id: 'prod-beta-1',
      shopId: 'shop-uuid-beta',
      name: 'Gaming Laptop RTX 4060',
      category: 'Laptops',
      price: 240000,
      stock: 5
    }
  ],
  aiLogs: [
    {
      id: 'log-alpha-1',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-1',
      conversationId: 'conv-alpha-1',
      userMessage: 'Bhai shoes available hain?',
      detectedAgent: 'product_agent',
      intent: 'product_availability',
      action: 'check_stock',
      responseTimeMs: 85,
      status: 'SUCCESS',
      fallbackUsed: false,
      createdAt: new Date('2026-09-29T10:28:30Z')
    },
    {
      id: 'log-alpha-2',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-1',
      conversationId: 'conv-alpha-1',
      userMessage: 'Mera order kahan hai?',
      detectedAgent: 'order_agent',
      intent: 'order_status',
      action: 'track_order',
      responseTimeMs: 95,
      status: 'SUCCESS',
      fallbackUsed: false,
      createdAt: new Date('2026-09-29T10:35:00Z')
    },
    {
      id: 'log-alpha-3',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-2',
      conversationId: 'conv-alpha-2',
      userMessage: 'Mujhe human representative se baat karni hai.',
      detectedAgent: 'support_agent',
      intent: 'human_agent_request',
      action: 'escalate_human',
      responseTimeMs: 220,
      status: 'SUCCESS',
      fallbackUsed: false,
      createdAt: new Date('2026-09-28T10:55:00Z')
    },
    {
      id: 'log-alpha-4',
      shopId: 'shop-uuid-alpha',
      customerId: 'cust-alpha-1',
      conversationId: 'conv-alpha-1',
      userMessage: 'asdkjh 123 unknown',
      detectedAgent: 'support_agent',
      intent: 'unknown_query',
      action: 'fallback_response',
      responseTimeMs: 310,
      status: 'FALLBACK',
      fallbackUsed: true,
      createdAt: new Date('2026-09-28T14:00:00Z')
    },
    {
      id: 'log-beta-1',
      shopId: 'shop-uuid-beta',
      customerId: 'cust-beta-1',
      conversationId: 'conv-beta-1',
      userMessage: 'Beta store laptop price?',
      detectedAgent: 'product_agent',
      intent: 'price_inquiry',
      action: 'lookup_price',
      responseTimeMs: 90,
      status: 'SUCCESS',
      fallbackUsed: false,
      createdAt: new Date('2026-09-29T10:00:00Z')
    }
  ],
  whatsappIntegrations: [
    {
      id: 'wa-alpha-1',
      shopId: 'shop-uuid-alpha',
      provider: 'WA-AKG',
      sessionId: 'session-alpha-custom-001',
      isActive: true
    },
    {
      id: 'wa-beta-1',
      shopId: 'shop-uuid-beta',
      provider: 'WA-AKG',
      sessionId: 'session-beta-custom-002',
      isActive: false
    }
  ]
};

// Wire Prisma delegates to in-memory fixtures with tenant scoping
prisma.shop.findUnique = async ({ where }) => {
  if (where.domain) return db.shops.find(s => s.domain === where.domain) || null;
  if (where.id) return db.shops.find(s => s.id === where.id) || null;
  return null;
};
prisma.shop.update = async ({ where, data }) => {
  const shop = db.shops.find(s => s.id === where.id);
  if (!shop) throw new Error('Shop not found');
  Object.assign(shop, data);
  return shop;
};

prisma.conversation.findMany = async ({ where = {}, include, orderBy, skip = 0, take = 50 }) => {
  let list = db.conversations.filter(c => c.shopId === where.shopId);
  if (where.status) list = list.filter(c => c.status === where.status);
  if (where.customer?.OR) {
    const searchVal = where.customer.OR[0].firstName.contains.toLowerCase();
    list = list.filter(c => {
      const cust = db.customers.find(cu => cu.id === c.customerId);
      if (!cust) return false;
      return (cust.firstName && cust.firstName.toLowerCase().includes(searchVal)) ||
             (cust.lastName && cust.lastName.toLowerCase().includes(searchVal)) ||
             (cust.phone && cust.phone.includes(searchVal));
    });
  }
  return list.slice(skip, skip + take).map(c => {
    const res = { ...c };
    if (include?.customer) {
      res.customer = db.customers.find(cu => cu.id === c.customerId) || null;
    }
    if (include?.messages) {
      const msgs = db.messages
        .filter(m => m.conversationId === c.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      res.messages = msgs.slice(0, include.messages.take || msgs.length);
    }
    return res;
  });
};

prisma.conversation.count = async ({ where = {} }) => {
  let list = db.conversations.filter(c => c.shopId === where.shopId);
  if (where.status) list = list.filter(c => c.status === where.status);
  if (where.isTakeover !== undefined) list = list.filter(c => c.isTakeover === where.isTakeover);
  if (where.OR) {
    list = list.filter(c => c.status === 'HUMAN_TAKEOVER' || c.isTakeover === true);
  }
  return list.length;
};

prisma.conversation.findUnique = async ({ where, include }) => {
  const c = db.conversations.find(conv => conv.id === where.id);
  if (!c) return null;
  const res = { ...c };
  if (include?.customer) {
    res.customer = db.customers.find(cu => cu.id === c.customerId) || null;
  }
  if (include?.messages) {
    res.messages = db.messages
      .filter(m => m.conversationId === c.id)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  return res;
};

prisma.conversation.update = async ({ where, data }) => {
  const c = db.conversations.find(conv => conv.id === where.id);
  if (!c) throw new Error('Conversation not found');
  Object.assign(c, data);
  return c;
};

prisma.message.create = async ({ data }) => {
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...data,
    createdAt: new Date()
  };
  db.messages.push(newMsg);
  return newMsg;
};

prisma.message.count = async ({ where = {} }) => {
  const shopId = where.conversation?.shopId;
  if (!shopId) return db.messages.length;
  const convIds = db.conversations.filter(c => c.shopId === shopId).map(c => c.id);
  return db.messages.filter(m => convIds.includes(m.conversationId)).length;
};

prisma.customer.findMany = async ({ where = {}, include, skip = 0, take = 50 }) => {
  let list = db.customers.filter(c => c.shopId === where.shopId);
  if (where.OR) {
    const searchVal = where.OR[0].firstName.contains.toLowerCase();
    list = list.filter(c => 
      (c.firstName && c.firstName.toLowerCase().includes(searchVal)) ||
      (c.lastName && c.lastName.toLowerCase().includes(searchVal)) ||
      (c.phone && c.phone.includes(searchVal))
    );
  }
  return list.slice(skip, skip + take).map(c => {
    const res = { ...c };
    if (include?.profileMemory) {
      res.profileMemory = db.customerProfileMemories.find(m => m.customerId === c.id) || null;
    }
    if (include?.orders) {
      res.orders = db.orders.filter(o => o.customerId === c.id);
    }
    if (include?.conversations) {
      res.conversations = db.conversations.filter(conv => conv.customerId === c.id);
    }
    return res;
  });
};

prisma.customer.count = async ({ where = {} }) => {
  return db.customers.filter(c => c.shopId === where.shopId).length;
};

prisma.customer.findUnique = async ({ where, include }) => {
  const c = db.customers.find(cu => cu.id === where.id);
  if (!c) return null;
  const res = { ...c };
  if (include?.profileMemory) {
    res.profileMemory = db.customerProfileMemories.find(m => m.customerId === c.id) || null;
  }
  if (include?.orders) {
    res.orders = db.orders.filter(o => o.customerId === c.id).sort((a, b) => b.createdAt - a.createdAt);
  }
  if (include?.conversations) {
    res.conversations = db.conversations
      .filter(conv => conv.customerId === c.id)
      .map(conv => {
        const msgs = db.messages.filter(m => m.conversationId === conv.id).sort((a, b) => b.createdAt - a.createdAt);
        return { ...conv, messages: msgs.slice(0, 5) };
      });
  }
  return res;
};

prisma.aIInteractionLog.findMany = async ({ where = {}, orderBy, skip = 0, take = 100 }) => {
  let list = db.aiLogs.filter(l => l.shopId === where.shopId);
  if (where.conversationId?.in) {
    list = list.filter(l => where.conversationId.in.includes(l.conversationId));
  } else if (where.conversationId) {
    list = list.filter(l => l.conversationId === where.conversationId);
  }
  if (where.detectedAgent) {
    list = list.filter(l => l.detectedAgent === where.detectedAgent);
  }
  return list.slice(skip, skip + take);
};

prisma.aIInteractionLog.count = async ({ where = {} }) => {
  return db.aiLogs.filter(l => l.shopId === where.shopId).length;
};

prisma.product.findMany = async ({ where = {} }) => {
  return db.products.filter(p => p.shopId === where.shopId);
};

prisma.order.findMany = async ({ where = {} }) => {
  return db.orders.filter(o => o.shopId === where.shopId);
};

prisma.whatsAppIntegration.findFirst = async ({ where = {} }) => {
  return db.whatsappIntegrations.find(w => w.shopId === where.shopId && (where.isActive === undefined || w.isActive === where.isActive)) || null;
};

// Express App Runner
let server;
let baseUrl;

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter());

  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });
}

async function request(endpoint, token, options = {}) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  return { status: res.status, ok: res.ok, data };
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('DIALMATE 2.0: PHASE 3 STEP 3 MERCHANT CONTROL CENTER TEST SUITE');
  console.log('======================================================================\n');

  await startServer();

  // ------------------------------------------------------------------
  // Suite 1: Conversation Inbox
  // ------------------------------------------------------------------
  console.log('--- 1. Conversation Inbox APIs ---');

  // Test 1.1: List conversations & verify response contract
  const convListRes = await request('/conversations', tokenAlpha);
  const convs = convListRes.data?.conversations || [];
  const validContract = convs.length > 0 && convs.every(c => 
    c.id &&
    c.customer &&
    c.customer.name &&
    c.status &&
    c.unreadCount !== undefined &&
    c.lastAgent &&
    c.lastIntent &&
    c.confidence !== undefined
  );
  reportTest('List conversations has required response contract fields', convListRes.status === 200 && validContract,
    `count: ${convs.length}, first intent: ${convs[0]?.lastIntent}`);

  // Test 1.2: Status filtering (HUMAN_TAKEOVER)
  const filterRes = await request('/conversations?status=HUMAN_TAKEOVER', tokenAlpha);
  const takeoverList = filterRes.data?.conversations || [];
  const filterOk = takeoverList.length === 1 && takeoverList[0].status === 'HUMAN_TAKEOVER';
  reportTest('Filter conversations by status (HUMAN_TAKEOVER)', filterOk, `matches: ${takeoverList.length}`);

  // Test 1.3: Search customer by name
  const searchRes = await request('/conversations?search=Ali', tokenAlpha);
  const searchList = searchRes.data?.conversations || [];
  const searchOk = searchList.length === 1 && searchList[0].customer.name.includes('Ali');
  reportTest('Search conversation by customer name', searchOk, `found: ${searchList[0]?.customer.name}`);

  // Test 1.4: Conversation Details with Messages & AI logs
  const detailRes = await request('/conversations/conv-alpha-1', tokenAlpha);
  const detail = detailRes.data;
  const detailOk = detailRes.status === 200 &&
                   detail.id === 'conv-alpha-1' &&
                   detail.messages?.length === 2 &&
                   detail.aiLogs?.length >= 1;
  reportTest('Get conversation details with message history & AI telemetry', detailOk,
    `msgs: ${detail.messages?.length}, aiLogs: ${detail.aiLogs?.length}`);

  // Test 1.5: Merchant Manual Reply (POST /reply) & WhatsApp Delivery
  capturedOutboundWhatsApp.length = 0;
  const replyRes = await request('/conversations/conv-alpha-1/reply', tokenAlpha, {
    method: 'POST',
    body: JSON.stringify({ text: 'Aap ka shoes order confirm hai, kal dispatch ho jaye ga.' })
  });
  const replyOk = replyRes.status === 200 &&
                  replyRes.data?.ok === true &&
                  replyRes.data?.message?.sender === 'agent' &&
                  capturedOutboundWhatsApp.length === 1 &&
                  capturedOutboundWhatsApp[0].sessionId === 'session-alpha-custom-001' &&
                  capturedOutboundWhatsApp[0].text.includes('confirm hai');
  reportTest('Merchant manual reply saved & forwarded to customer WhatsApp AKG', replyOk,
    `wa session: ${capturedOutboundWhatsApp[0]?.sessionId}`);

  // Test 1.6: Human Takeover Toggle & Status Update (PATCH)
  const takeoverRes = await request('/conversations/conv-alpha-1', tokenAlpha, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'HUMAN_TAKEOVER', isTakeover: true, assignedTo: 'Agent Sarah' })
  });
  const takeoverOk = takeoverRes.status === 200 &&
                     takeoverRes.data?.conversation?.status === 'HUMAN_TAKEOVER' &&
                     takeoverRes.data?.conversation?.isTakeover === true &&
                     takeoverRes.data?.conversation?.assignedTo === 'Agent Sarah';
  reportTest('Human takeover toggle activates isTakeover and assignedTo', takeoverOk,
    `status: ${takeoverRes.data?.conversation?.status}`);

  // ------------------------------------------------------------------
  // Suite 2: Customer Intelligence
  // ------------------------------------------------------------------
  console.log('\n--- 2. Customer Intelligence APIs ---');

  // Test 2.1: List customers
  const custListRes = await request('/customers', tokenAlpha);
  const custs = custListRes.data?.customers || [];
  const custListOk = custListRes.status === 200 &&
                     custs.length === 2 &&
                     custs[0].ordersCount > 0 &&
                     custs[0].totalSpend > 0;
  reportTest('List customers includes spend & order counts', custListOk, `customers: ${custs.length}`);

  // Test 2.2: Customer Profile Dossier & AI Memory
  const custDetailRes = await request('/customers/cust-alpha-1', tokenAlpha);
  const custDossier = custDetailRes.data?.customer;
  const dossierOk = custDetailRes.status === 200 &&
                    custDossier?.name === 'Ali Khan' &&
                    custDossier?.profileMemory?.preferredCategories?.includes('Shoes') &&
                    custDossier?.profileMemory?.averageBudget === 5500 &&
                    custDossier?.orders?.length === 2 &&
                    custDossier?.totalSpending === 9700;
  reportTest('Customer profile dossier retrieves AI memory, preferences & order history', dossierOk,
    `budget: ${custDossier?.profileMemory?.averageBudget}, spend: ${custDossier?.totalSpending}`);

  // ------------------------------------------------------------------
  // Suite 3: AI Analytics Dashboard
  // ------------------------------------------------------------------
  console.log('\n--- 3. AI Analytics Dashboard APIs ---');

  // Test 3.1: Overview KPIs
  const ovRes = await request('/analytics/overview', tokenAlpha);
  const ov = ovRes.data;
  const ovOk = ovRes.status === 200 &&
               ov.totalConversations >= 2 &&
               ov.totalMessages >= 3 &&
               ov.humanEscalations >= 1 &&
               ov.fallbackRate !== undefined &&
               ov.averageResponseTime > 0 &&
               Array.isArray(ov.dailyConversations);
  reportTest('Analytics overview returns KPIs (conversations, fallback rate, avg response time)', ovOk,
    `total: ${ov?.totalConversations}, avgTime: ${ov?.averageResponseTime}ms`);

  // Test 3.2: Top Intents Distribution
  const intentRes = await request('/analytics/intents', tokenAlpha);
  const intentList = intentRes.data?.intents || [];
  const intentOk = intentRes.status === 200 &&
                   intentList.length >= 2 &&
                   intentList.some(i => i.intent === 'product_availability');
  reportTest('Top intents distribution aggregated from AIInteractionLog', intentOk,
    `top intent: ${intentList[0]?.intent} (${intentList[0]?.count})`);

  // Test 3.3: Most Used Agents
  const agentRes = await request('/analytics/agents', tokenAlpha);
  const agentList = agentRes.data?.agents || [];
  const agentOk = agentRes.status === 200 &&
                  agentList.length >= 2 &&
                  agentList.some(a => a.agent === 'product_agent');
  reportTest('Agent execution breakdown by sub-agent', agentOk,
    `top agent: ${agentList[0]?.agent}`);

  // ------------------------------------------------------------------
  // Suite 4: Commerce Analytics
  // ------------------------------------------------------------------
  console.log('\n--- 4. Commerce Analytics APIs ---');

  // Test 4.1: Product Analytics & Inventory Insights
  const prodRes = await request('/analytics/products', tokenAlpha);
  const prodData = prodRes.data;
  const prodOk = prodRes.status === 200 &&
                 prodData?.mostSearched?.length > 0 &&
                 prodData?.lowStockProducts?.some(p => p.name === 'Denim Casual Jacket') &&
                 prodData?.outOfStockProducts?.some(p => p.name === 'Suede Loafers');
  reportTest('Commerce product analytics detects search demand, low stock & stockouts', prodOk,
    `low stock: ${prodData?.lowStockProducts?.length}, out of stock: ${prodData?.outOfStockProducts?.length}`);

  // Test 4.2: Order Status & Cancellation Inquiries
  const ordRes = await request('/analytics/orders', tokenAlpha);
  const ordData = ordRes.data;
  const ordOk = ordRes.status === 200 &&
                ordData?.totalOrders === 2 &&
                ordData?.orderQueriesCount >= 1 &&
                ordData?.statusBreakdown?.delivered === 1 &&
                ordData?.totalRevenue === 9700;
  reportTest('Commerce order queries, fulfillment statuses & total revenue', ordOk,
    `revenue: PKR ${ordData?.totalRevenue}, delivered: ${ordData?.statusBreakdown?.delivered}`);

  // ------------------------------------------------------------------
  // Suite 5: Shop Settings
  // ------------------------------------------------------------------
  console.log('\n--- 5. Shop Settings APIs ---');

  // Test 5.1: Retrieve shop settings
  const settingsGetRes = await request('/shop/settings', tokenAlpha);
  const settingsData = settingsGetRes.data;
  const settingsGetOk = settingsGetRes.status === 200 &&
                        settingsData?.profile?.shopName === 'Alpha Fashion Store' &&
                        settingsData?.aiSettings?.aiName === 'AlphaBot' &&
                        settingsData?.businessRules?.workingHours === '10:00 AM - 10:00 PM' &&
                        settingsData?.whatsapp?.isConnected === true &&
                        settingsData?.whatsapp?.sessionId === 'session-alpha-custom-001';
  reportTest('Get shop settings returns profile, AI persona, rules & WhatsApp session', settingsGetOk,
    `aiName: ${settingsData?.aiSettings?.aiName}, waConnected: ${settingsData?.whatsapp?.isConnected}`);

  // Test 5.2: Update shop settings (PUT)
  const settingsPutRes = await request('/shop/settings', tokenAlpha, {
    method: 'PUT',
    body: JSON.stringify({
      profile: { shopName: 'Alpha Premier Store' },
      aiSettings: { aiName: 'AlphaConcierge', tone: 'Urgent & Direct' },
      businessRules: { workingHours: '8:00 AM - 11:00 PM' }
    })
  });
  const settingsPutOk = settingsPutRes.status === 200 &&
                        settingsPutRes.data?.ok === true &&
                        settingsPutRes.data?.profile?.shopName === 'Alpha Premier Store' &&
                        settingsPutRes.data?.aiSettings?.aiName === 'AlphaConcierge' &&
                        settingsPutRes.data?.businessRules?.workingHours === '8:00 AM - 11:00 PM';
  reportTest('Update shop settings persists persona and business rules updates', settingsPutOk,
    `updated name: ${settingsPutRes.data?.profile?.shopName}`);

  // ------------------------------------------------------------------
  // Suite 6: Security & Multi-Tenant Isolation
  // ------------------------------------------------------------------
  console.log('\n--- 6. Security & Multi-Tenant Isolation ---');

  // Test 6.1: Merchant A cannot view Merchant B conversations
  const crossConvRes = await request('/conversations/conv-beta-1', tokenAlpha);
  reportTest('Merchant A blocked from viewing Merchant B conversation (404 isolation)', crossConvRes.status === 404,
    `status: ${crossConvRes.status}`);

  // Test 6.2: Merchant A cannot reply to Merchant B conversation
  const crossReplyRes = await request('/conversations/conv-beta-1/reply', tokenAlpha, {
    method: 'POST',
    body: JSON.stringify({ text: 'Malicious cross-tenant injection' })
  });
  reportTest('Merchant A blocked from replying to Merchant B conversation', crossReplyRes.status === 404,
    `status: ${crossReplyRes.status}`);

  // Test 6.3: Merchant A cannot view Merchant B customer profile
  const crossCustRes = await request('/customers/cust-beta-1', tokenAlpha);
  reportTest('Merchant A blocked from viewing Merchant B customer profile', crossCustRes.status === 404,
    `status: ${crossCustRes.status}`);

  // Test 6.4: Analytics are strictly isolated per tenant
  const betaOvRes = await request('/analytics/overview', tokenBeta);
  const betaOv = betaOvRes.data;
  const isolationOk = betaOv.totalConversations === 1 &&
                      betaOv.totalMessages === 1 &&
                      ov.totalConversations >= 2;
  reportTest('Zero cross-tenant data leakage in analytics overview (Alpha != Beta)', isolationOk,
    `Alpha convs: ${ov.totalConversations}, Beta convs: ${betaOv.totalConversations}`);

  // Test 6.5: Merchant B conversation list contains zero Merchant A records
  const betaConvsRes = await request('/conversations', tokenBeta);
  const betaConvs = betaConvsRes.data?.conversations || [];
  const listIsoOk = betaConvs.length === 1 && betaConvs[0].id === 'conv-beta-1';
  reportTest('Merchant B conversation list strictly isolated to tenant records', listIsoOk,
    `Beta count: ${betaConvs.length}`);

  // Teardown HTTP server
  server.close();

  console.log('\n======================================================================');
  console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED (${((passedTests/totalTests)*100).toFixed(1)}%)`);
  console.log('======================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
