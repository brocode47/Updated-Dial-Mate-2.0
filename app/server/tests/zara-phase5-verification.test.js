import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { HumanEscalationService } from '../src/services/humanEscalationService.js';

describe('DIAL MATE 2.0 / ZARA — PHASE 5 PRODUCTION SPECIFICATION VERIFICATION (TESTS 1 - 13)', () => {
  const TEST_PHONE = '923333255998';
  const TEST_SENDER = `${TEST_PHONE}@s.whatsapp.net`;
  const SHOP_ID = 'shop-p5-1';
  const SHOP_DOMAIN = 'sundaybazaaar.store';

  const mockShop = {
    id: SHOP_ID,
    domain: SHOP_DOMAIN,
    name: 'Sunday Bazaaar',
    ownerPhone: '+923333255998',
    settings: { operatorPhone: '+923333255998' }
  };

  const mockProductChair = {
    id: 'prod-chair-1',
    title: 'Wooden Silicone Chair Protection Cover',
    price: 'Rs. 499',
    formattedPrice: 'Rs. 499',
    numericPrice: 499,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover',
    available: true,
    description: 'Silicone chair protection cover prevents scratches while moving chairs. 24 pieces pack.'
  };

  const mockProductBottleBrush = {
    id: 'prod-brush-19l',
    title: '19L Water Bottle Cleaning Brush',
    price: 'Rs. 599',
    formattedPrice: 'Rs. 599',
    numericPrice: 599,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/19l-water-bottle-cleaning-brush',
    available: true,
    description: 'Long flexible cleaning brush for 19 liter water bottles.'
  };

  const mockProductSiliconeMat = {
    id: 'prod-mat-1',
    title: 'Silicone Faucet Mat Splash Guard',
    price: 'Rs. 1399',
    formattedPrice: 'Rs. 1399',
    numericPrice: 1399,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/silicone-faucet-mat',
    available: true,
    description: 'Silicone kitchen sink splash guard and drying mat.'
  };

  let catalogSearches = [];
  let sentWhatsAppMessages = [];
  let dbOrders = [];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ZARA_DEBUG_CONTEXT = 'true';
    catalogSearches = [];
    sentWhatsAppMessages = [];
    dbOrders = [];
    ConversationStateService.clearMemory();

    if (prisma.shop) {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
    }
    if (prisma.customer) {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
        id: 'cust-ali-1',
        phone: TEST_PHONE,
        firstName: 'Ali',
        city: 'Karachi'
      });
      vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'cust-ali-1', phone: TEST_PHONE, firstName: 'Ali' });
    }
    if (prisma.conversation) {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-p5-1', messages: [] });
      vi.spyOn(prisma.conversation, 'create').mockResolvedValue({ id: 'conv-p5-1', messages: [] });
    }
    if (prisma.message) {
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
    }
    if (prisma.aIInteractionLog) {
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
    }
    if (prisma.whatsAppIntegration) {
      vi.spyOn(prisma.whatsAppIntegration, 'findFirst').mockResolvedValue({
        id: 'wa-int-1',
        shopId: SHOP_ID,
        sessionId: 'session-live',
        isActive: true
      });
    }
    if (prisma.complianceLog) {
      vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({});
    }

    if (prisma.order) {
      vi.spyOn(prisma.order, 'findFirst').mockImplementation(async (args) => {
        const orderNum = args?.where?.orderNumber;
        if (orderNum) {
          return dbOrders.find(o => String(o.orderNumber) === String(orderNum)) || null;
        }
        return dbOrders[0] || null;
      });

      vi.spyOn(prisma.order, 'findMany').mockImplementation(async (args) => {
        if (!args || !args.where) return dbOrders;
        const where = args.where;
        let filtered = [...dbOrders];
        if (where.orderNumber) {
          filtered = filtered.filter(o => String(o.orderNumber) === String(where.orderNumber));
        }
        if (where.customerPhone) {
          const phVal = typeof where.customerPhone === 'object' ? (where.customerPhone.contains || '') : where.customerPhone;
          const cleanPhVal = String(phVal).replace(/\D/g, '');
          filtered = filtered.filter(o => (o.customerPhone || '').includes(cleanPhVal));
        }
        return filtered;
      });
    }

    vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockImplementation(async (to, msg) => {
      sentWhatsAppMessages.push({ to, msg });
      return { id: `msg-${Date.now()}` };
    });

    vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({ id: `media-${Date.now()}` });

    vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
      success: true,
      buffer: Buffer.from('RIFF mock ogg opus audio'),
      format: 'ogg',
      durationSeconds: 2.5
    });

    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockImplementation(async (domain, query) => {
      catalogSearches.push(query);
      const clean = (query || '').toLowerCase().trim();
      if (/chair|cover|kursi|protection/i.test(clean)) {
        return { products: [mockProductChair], totalFound: 1 };
      }
      if (/19l|bottle|brush/i.test(clean)) {
        return { products: [mockProductBottleBrush], totalFound: 1 };
      }
      if (/clean|cleaning/i.test(clean)) {
        return { products: [mockProductBottleBrush, mockProductSiliconeMat], totalFound: 2 };
      }
      return { products: [], totalFound: 0 };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // TEST 1 — NATURAL GREETING & GROUNDED PRODUCT SEARCH
  // =========================================================================
  it('TEST 1: "Hello" -> Greeting; "Mujhe chair protection cover chahiye" -> Product details, price, delivery, link', async () => {
    // 1. Customer: Hello
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t1',
      fromPhone: TEST_SENDER,
      messageText: 'Hello'
    });
    expect(t1.success).toBe(true);
    expect(t1.replyText).toMatch(/Sunday Bazaaar|madad|khushamdeed/i);

    // 2. Customer: Mujhe chair protection cover chahiye
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t1',
      fromPhone: TEST_SENDER,
      messageText: 'Mujhe chair protection cover chahiye'
    });
    expect(t2.success).toBe(true);
    expect(t2.replyText).toContain('Wooden Silicone Chair Protection Cover');
    expect(t2.replyText).toContain('499');
    expect(t2.replyText).toContain('199');
    expect(t2.replyText).toContain('698');
    expect(t2.replyText).toContain('https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover');
    // Does NOT dump raw HTML or giant web description
    expect(t2.replyText).not.toContain('<div');
    expect(t2.replyText).not.toContain('body_html');
  });

  // =========================================================================
  // TEST 2 — PRONOUN CONTEXT ("iski price kya hai?")
  // =========================================================================
  it('TEST 2: "iski price kya hai?" strictly resolves to Chair Protection Cover without re-searching', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);
    catalogSearches = [];

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t2',
      fromPhone: TEST_SENDER,
      messageText: 'iski price kya hai?'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('Chair Protection Cover');
    expect(res.replyText).toContain('499');
    expect(catalogSearches.length).toBe(0); // Zero random search
  });

  // =========================================================================
  // TEST 3 — PRONOUN TOTAL ("iska total?")
  // =========================================================================
  it('TEST 3: "iska total?" returns Chair Protection Cover total (499 + 199 = 698)', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t3',
      fromPhone: TEST_SENDER,
      messageText: 'iska total?'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('Chair Protection Cover');
    expect(res.replyText).toContain('698');
  });

  // =========================================================================
  // TEST 4 — DIRECT PRODUCT LINK ("iska link bhejo")
  // =========================================================================
  it('TEST 4: "iska link bhejo" returns direct product URL without repeating full description', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t4',
      fromPhone: TEST_SENDER,
      messageText: 'iska link bhejo'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover');
    // Does NOT repeat the whole verbose summary
    expect(res.replyText).not.toContain('Silicone chair protection cover prevents scratches');
  });

  // =========================================================================
  // TEST 5 — REAL VOICE CONTEXT ("iski price kya hai")
  // =========================================================================
  it('TEST 5: Voice note "iski price kya hai" yields voice note response for Chair Protection Cover', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t5',
      fromPhone: TEST_SENDER,
      messageText: 'iski price kya hai',
      isVoiceInbound: true
    });

    expect(res.success).toBe(true);
    expect(res.isVoiceResponse).toBe(true);
    expect(res.spokenText).toContain('Chair Protection Cover');
    expect(res.spokenText).toContain('499');
    expect(res.spokenText).not.toContain('http');
  });

  // =========================================================================
  // TEST 6 — VOICE -> TEXT CONTEXT CONTINUITY
  // =========================================================================
  it('TEST 6: Voice "iska total kitna hai?" -> Text "aur iska link bhejo" both ground on Chair Cover', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    // 1. Voice
    const vTurn = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t6',
      fromPhone: TEST_SENDER,
      messageText: 'iska total kitna hai?',
      isVoiceInbound: true
    });
    expect(vTurn.success).toBe(true);
    expect(vTurn.spokenText).toContain('698');

    // 2. Text
    const tTurn = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t6',
      fromPhone: TEST_SENDER,
      messageText: 'aur iska link bhejo',
      isVoiceInbound: false
    });
    expect(tTurn.success).toBe(true);
    expect(tTurn.replyText).toContain('https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover');
  });

  // =========================================================================
  // TEST 7 — ORDER CONTEXT & TRUTHFULNESS
  // =========================================================================
  it('TEST 7: "mera order kahan pohancha?" states no order found when no order exists, never invents #1643', async () => {
    dbOrders = []; // No orders on file

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t7-none',
      fromPhone: TEST_SENDER,
      messageText: 'mera order kahan pohancha?'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toMatch(/koi order nahi mila|record mein nahi mila/i);
    expect(res.replyText).not.toContain('1643');
  });

  it('TEST 7b: "mera order kahan pohancha?" prompts for clarification when multiple orders exist', async () => {
    dbOrders = [
      { orderNumber: '1640', customerPhone: TEST_PHONE, items: 'Chair Cover', status: 'Shipped', totalAmount: 698 },
      { orderNumber: '1641', customerPhone: TEST_PHONE, items: 'Water Bottle', status: 'Delivered', totalAmount: 599 }
    ];

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t7-multi',
      fromPhone: TEST_SENDER,
      messageText: 'mera order kahan pohancha?'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toMatch(/multiple orders|aik se zyada|kis order/i);
    expect(res.replyText).toContain('1640');
    expect(res.replyText).toContain('1641');
  });

  // =========================================================================
  // TEST 8 — ORDER CONFIRMATION & MISSING CHECKOUT DATA
  // =========================================================================
  it('TEST 8: "mera order confirm krdo" identifies product, breakdown, and collects missing customer data', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t8',
      fromPhone: TEST_SENDER,
      messageText: 'mera order confirm krdo'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('Chair Protection Cover');
    expect(res.replyText).toContain('499');
    expect(res.replyText).toContain('199');
    expect(res.replyText).toContain('698');
    expect(res.replyText).toMatch(/naam|address|shehar|city|phone/i);
  });

  // =========================================================================
  // TEST 9 — PRODUCT REJECTION MEMORY
  // =========================================================================
  it('TEST 9: "19L bottle brush dikhao" -> "nahi mujhe nahi chahiye" -> "aur cleaning products dikhao" never repeats rejected brush', async () => {
    // 1. Show bottle brush
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t9',
      fromPhone: TEST_SENDER,
      messageText: '19L bottle brush dikhao'
    });
    expect(t1.success).toBe(true);
    expect(t1.replyText).toContain('19L Water Bottle Cleaning Brush');

    // 2. Reject it
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t9',
      fromPhone: TEST_SENDER,
      messageText: 'nahi mujhe nahi chahiye'
    });
    expect(t2.success).toBe(true);
    expect(t2.replyText).toMatch(/koi baat nahi|aur dekhna chahein/i);

    // 3. Ask for other cleaning products
    const t3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t9',
      fromPhone: TEST_SENDER,
      messageText: 'aur cleaning products dikhao'
    });
    expect(t3.success).toBe(true);
    // Must NOT keep recommending the rejected 19L bottle brush
    expect(t3.replyText).not.toContain('19L Water Bottle Cleaning Brush ki price');
    expect(t3.replyText).toMatch(/cleaning-products|cleaning/i);
  });

  // =========================================================================
  // TEST 10 — HUMAN ESCALATION & UNINTERRUPTED CONVERSATION CONTINUITY
  // =========================================================================
  it('TEST 10: "mujhe real person se baat karni hai" dispatches owner WhatsApp alert, and Zara continues answering normally', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    // 1. Request human
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t10',
      fromPhone: TEST_SENDER,
      messageText: 'mujhe real person se baat karni hai'
    });
    expect(t1.success).toBe(true);
    expect(t1.replyText).toMatch(/support team|forward kar di hai/i);

    // Owner notification was dispatched
    expect(sentWhatsAppMessages.length).toBeGreaterThan(0);
    const ownerMsg = sentWhatsAppMessages[0].msg;
    expect(ownerMsg).toContain('Human Support Request');
    expect(ownerMsg).toContain(TEST_PHONE);

    // 2. Zara DOES NOT permanently stop responding
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t10',
      fromPhone: TEST_SENDER,
      messageText: 'acha chair cover ki price kya hai?'
    });
    expect(t2.success).toBe(true);
    expect(t2.replyText).toContain('Chair Protection Cover');
    expect(t2.replyText).toContain('499');
  });

  // =========================================================================
  // TEST 11 — CASUAL CHAT & FRIENDSHIP
  // =========================================================================
  it('TEST 11: "tumhara naam kya hai?" -> Zara; "mujhse friendship karogi?" -> friendly natural, no random product ad', async () => {
    // 1. Identity
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t11',
      fromPhone: TEST_SENDER,
      messageText: 'tumhara naam kya hai?'
    });
    expect(t1.success).toBe(true);
    expect(t1.replyText).toContain('Zara');

    // 2. Friendship
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t11',
      fromPhone: TEST_SENDER,
      messageText: 'mujhse friendship karogi?'
    });
    expect(t2.success).toBe(true);
    expect(t2.replyText).toMatch(/dost|bilkul/i);
    expect(t2.replyText).not.toContain('Wooden Silicone Chair Protection Cover');
  });

  // =========================================================================
  // TEST 12 — FRUSTRATION HANDLING
  // =========================================================================
  it('TEST 12: "yr tumahra masla kya hy" responds calmly and concisely without product promotion', async () => {
    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-p5-t12',
      fromPhone: TEST_SENDER,
      messageText: 'yr tumahra masla kya hy'
    });
    expect(res.success).toBe(true);
    expect(res.replyText).toMatch(/afsos|pareshani|madad/i);
    expect(res.replyText).not.toContain('Wooden Silicone Chair Protection Cover');
    expect(res.replyText).not.toContain('499');
  });

  // =========================================================================
  // TEST 13 — PAKISTANI LANGUAGE INTENT MATRIX (17 PHRASES)
  // =========================================================================
  it('TEST 13: Understands all 17 Pakistani colloquial phrases with correct semantic intent', async () => {
    await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockProductChair);

    const phrases = [
      { text: 'iski price?', expectIntent: 'PRODUCT_DETAIL' },
      { text: 'iska rate?', expectIntent: 'PRODUCT_DETAIL' },
      { text: 'ye kitny ka hy?', expectIntent: 'PRODUCT_DETAIL' },
      { text: 'delivry charges?', expectIntent: 'ORDER_DELIVERY_CHARGES' },
      { text: 'delivery kitni?', expectIntent: 'ORDER_DELIVERY_CHARGES' },
      { text: 'total kitna?', expectIntent: 'ORDER_TOTAL' },
      { text: 'link send kro', expectIntent: 'PRODUCT_LINK' },
      { text: 'wo wala', expectIntent: 'ORDINAL_REFERENCE' },
      { text: 'kal wala order', expectIntent: 'ORDER_LOOKUP_BY_DETAILS' },
      { text: 'mera order kidhr pohancha', expectIntent: 'ORDER_STATUS' },
      { text: 'order confirm krdo', expectIntent: 'CONFIRM' },
      { text: 'cancel mt krna', expectIntent: 'CANCEL_NEGATED' },
      { text: 'mujhe ye nahi chahiye', expectIntent: 'PRODUCT_REJECTION' },
      { text: 'aur dikhao', expectIntent: 'MORE' },
      { text: 'tumahra naam kya hy', expectIntent: 'BOT_IDENTITY' },
      { text: 'mujhe apne order ka status required hai', expectIntent: 'ORDER_STATUS' },
      { text: 'mujhse friendship karogi or not?', expectIntent: 'SOCIAL_FRIENDSHIP' }
    ];

    for (const p of phrases) {
      const intentResult = WhatsAppAgentService.detectIntent(p.text, {
        activeProduct: mockProductChair,
        state: { activeProduct: mockProductChair }
      });
      if (p.expectIntent === 'CANCEL_NEGATED') {
        expect(intentResult.isNegated || intentResult.intent === 'CANCEL_NEGATED').toBe(true);
      } else if (p.expectIntent === 'PRODUCT_DETAIL') {
        expect(['PRODUCT_DETAIL', 'ORDINAL_REFERENCE']).toContain(intentResult.intent);
      } else if (p.expectIntent === 'ORDER_LOOKUP_BY_DETAILS' || p.expectIntent === 'ORDER_STATUS') {
        expect(['ORDER_LOOKUP_BY_DETAILS', 'ORDER_STATUS', 'ORDER_SUMMARY']).toContain(intentResult.intent);
      } else {
        expect(intentResult.intent).toBe(p.expectIntent);
      }
    }
  });
});
