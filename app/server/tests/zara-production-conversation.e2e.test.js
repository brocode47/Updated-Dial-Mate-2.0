import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';

describe('ZARA PRODUCTION FORENSIC VERIFICATION — End-to-End Conversation Test Suite', () => {
  const TEST_PHONE = '923333255998';
  const TEST_SENDER = `${TEST_PHONE}@s.whatsapp.net`;
  const SHOP_ID = 'shop-sunday-1';
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
    description: 'Silicone chair protection cover prevents floor scratches. 24 pieces pack.'
  };

  const mockProductSnoring = {
    id: 'prod-snore-1',
    title: 'Anti Snoring Magnetic Nasal Dilator',
    price: 'Rs. 999',
    formattedPrice: 'Rs. 999',
    numericPrice: 999,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/anti-snoring-nasal-dilator',
    available: true,
    description: 'Anti snoring kit helps improve breathing.'
  };

  const mockProductBathBrush = {
    id: 'prod-brush-1',
    title: '2 in 1 Long Handle Double Sided Bath Brush',
    price: 'Rs. 499',
    formattedPrice: 'Rs. 499',
    numericPrice: 499,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/bath-brush',
    available: true,
    description: 'Long handle shower bath brush.'
  };

  const yesterdayDate = new Date(Date.now() - 86400000).toISOString();
  const fiveDaysAgoDate = new Date(Date.now() - 86400000 * 5).toISOString();

  // Order A: Yesterday, Chair Protection Cover
  const mockOrderA = {
    id: 'order-1640-uuid',
    orderId: 'order-1640-uuid',
    orderNumber: '1640',
    shopId: SHOP_ID,
    customerPhone: TEST_PHONE,
    customerName: 'Ali',
    city: 'Karachi',
    address: 'Gulshan-e-Iqbal, Karachi',
    items: 'Wooden Silicone Chair Protection Cover',
    totalAmount: 698,
    shippingFee: 199,
    status: 'In Transit',
    financialStatus: 'Pending',
    createdAt: yesterdayDate,
    payload: JSON.stringify({
      order_number: '1640',
      shipping_address: { name: 'Ali', city: 'Karachi', phone: TEST_PHONE, address1: 'Gulshan-e-Iqbal' },
      line_items: [{ title: 'Wooden Silicone Chair Protection Cover', price: '499.00' }]
    })
  };

  // Order B: 5 days ago, Nasal Dilator
  const mockOrderB = {
    id: 'order-1643-uuid',
    orderId: 'order-1643-uuid',
    orderNumber: '1643',
    shopId: SHOP_ID,
    customerPhone: TEST_PHONE,
    customerName: 'Ali',
    city: 'Karachi',
    address: 'Gulshan-e-Iqbal, Karachi',
    items: 'Anti Snoring Magnetic Nasal Dilator',
    totalAmount: 1198,
    shippingFee: 199,
    status: 'Delivered',
    financialStatus: 'Paid',
    createdAt: fiveDaysAgoDate,
    payload: JSON.stringify({
      order_number: '1643',
      shipping_address: { name: 'Ali', city: 'Karachi', phone: TEST_PHONE, address1: 'Gulshan-e-Iqbal' },
      line_items: [{ title: 'Anti Snoring Magnetic Nasal Dilator', price: '999.00' }]
    })
  };

  let dbOrders = [mockOrderA, mockOrderB];
  let catalogSearchCalls = [];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ZARA_DEBUG_CONTEXT = 'true';
    catalogSearchCalls = [];
    dbOrders = [mockOrderA, mockOrderB];

    if (prisma.shop) {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
    }
    if (prisma.customer) {
      vi.spyOn(prisma.customer, 'findFirst').mockImplementation(async (args) => {
        const phone = args?.where?.phone;
        const name = args?.where?.firstName?.contains;
        if (phone && phone.includes('923333255998')) {
          return { id: 'cust-ali-1', phone: '923333255998', firstName: 'Ali', city: 'Karachi' };
        }
        if (name && /ali/i.test(name)) {
          return { id: 'cust-ali-1', phone: '923333255998', firstName: 'Ali', city: 'Karachi' };
        }
        return null;
      });
      vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'cust-ali-1', phone: TEST_PHONE, firstName: 'Ali' });
    }
    if (prisma.conversation) {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-e2e-1', messages: [] });
      vi.spyOn(prisma.conversation, 'create').mockResolvedValue({ id: 'conv-e2e-1', messages: [] });
    }
    if (prisma.message) {
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
    }
    if (prisma.aIInteractionLog) {
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
    }

    // Realistic Order Query Mocking
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

        if (where.customerPhone) {
          const phVal = typeof where.customerPhone === 'object' ? (where.customerPhone.contains || '') : where.customerPhone;
          const cleanPhVal = String(phVal).replace(/\D/g, '');
          filtered = filtered.filter(o => (o.customerPhone || '').includes(cleanPhVal));
        }
        if (where.orderNumber) {
          filtered = filtered.filter(o => String(o.orderNumber) === String(where.orderNumber));
        }
        if (where.OR) {
          filtered = filtered.filter(o => {
            return where.OR.some(clause => {
              if (clause.customerName?.contains) {
                return (o.customerName || '').toLowerCase().includes(clause.customerName.contains.toLowerCase());
              }
              if (clause.city?.contains) {
                return (o.city || '').toLowerCase().includes(clause.city.contains.toLowerCase());
              }
              if (clause.payload?.contains) {
                return (o.payload || '').toLowerCase().includes(clause.payload.contains.toLowerCase());
              }
              if (clause.customerPhone?.contains) {
                return (o.customerPhone || '').toLowerCase().includes(clause.customerPhone.contains.toLowerCase());
              }
              return false;
            });
          });
        }
        return filtered;
      });
    }

    vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'msg-out-1' });
    vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({ id: 'msg-media-1' });
    vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
      success: true,
      buffer: Buffer.from('mock voice note ogg opus'),
      format: 'ogg',
      durationSeconds: 2.0
    });

    // Realistic Catalog Search
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockImplementation(async (domain, query, options) => {
      catalogSearchCalls.push(query);
      const clean = (query || '').toLowerCase().trim();
      if (/chair|cover|protection/i.test(clean)) {
        return { products: [mockProductChair], totalFound: 1 };
      }
      if (/snore|snoring|dilator/i.test(clean)) {
        return { products: [mockProductSnoring], totalFound: 1 };
      }
      if (/bath|brush/i.test(clean)) {
        return { products: [mockProductBathBrush], totalFound: 1 };
      }
      // Any empty/pronoun/number query returns 0 products in real Shopify!
      return { products: [], totalFound: 0 };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SCENARIO 1 — TEXT -> TEXT PRODUCT INQUIRY & PRONOUN RESOLUTION
  // =========================================================================
  it('SCENARIO 1: Text "show me chair protection cover" -> Text "iski price kya hai" retains exact chair product', async () => {
    // TURN 1:
    const turn1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-prod-1',
      fromPhone: TEST_SENDER,
      messageText: 'show me chair protection cover'
    });
    expect(turn1.success).toBe(true);
    expect(turn1.replyText).toContain('Chair Protection Cover');

    catalogSearchCalls = []; // reset tracker

    // TURN 2:
    const turn2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-prod-1',
      fromPhone: TEST_SENDER,
      messageText: 'iski price kya hai'
    });
    expect(turn2.success).toBe(true);
    expect(turn2.replyText).toContain('Chair Protection Cover');
    expect(turn2.replyText).toContain('499');
    expect(turn2.replyText).not.toContain('Bath Brush');
    expect(turn2.replyText).not.toContain('Nasal Dilator');
    // Must NOT execute catalog search on "iski"
    expect(catalogSearchCalls.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 2 — 4-MODALITY CONTINUITY (Text->Voice, Voice->Text, Voice->Voice)
  // =========================================================================
  it('SCENARIO 2: Text -> Voice preserves chair product context seamlessly', async () => {
    // Turn 1 Text:
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-mod-1',
      fromPhone: TEST_SENDER,
      messageText: 'show me chair protection cover'
    });

    catalogSearchCalls = [];

    // Turn 2 Voice:
    const turn2Voice = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-mod-1',
      fromPhone: TEST_SENDER,
      messageText: 'iski price kya hai',
      isVoiceInbound: true
    });

    expect(turn2Voice.success).toBe(true);
    expect(turn2Voice.isVoiceResponse).toBe(true);
    expect(turn2Voice.spokenText).toContain('Chair Protection Cover');
    expect(turn2Voice.spokenText).toContain('499');
    expect(turn2Voice.spokenText).not.toContain('Bath Brush');
    expect(catalogSearchCalls.length).toBe(0);
  });

  it('SCENARIO 2: Voice -> Text preserves chair product context seamlessly', async () => {
    // Turn 1 Voice:
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-mod-2',
      fromPhone: TEST_SENDER,
      messageText: 'chair protection cover dikhao',
      isVoiceInbound: true
    });

    catalogSearchCalls = [];

    // Turn 2 Text:
    const turn2Text = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-mod-2',
      fromPhone: TEST_SENDER,
      messageText: 'iski price kya hai',
      isVoiceInbound: false
    });

    expect(turn2Text.success).toBe(true);
    expect(turn2Text.replyText).toContain('Chair Protection Cover');
    expect(turn2Text.replyText).toContain('499');
    expect(turn2Text.replyText).not.toContain('Bath Brush');
    expect(catalogSearchCalls.length).toBe(0);
  });

  it('SCENARIO 2: Voice -> Voice preserves chair product context seamlessly', async () => {
    // Turn 1 Voice:
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-mod-3',
      fromPhone: TEST_SENDER,
      messageText: 'chair protection cover dikhao',
      isVoiceInbound: true
    });

    catalogSearchCalls = [];

    // Turn 2 Voice:
    const turn2Voice = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-mod-3',
      fromPhone: TEST_SENDER,
      messageText: 'iski price kya hai',
      isVoiceInbound: true
    });

    expect(turn2Voice.success).toBe(true);
    expect(turn2Voice.isVoiceResponse).toBe(true);
    expect(turn2Voice.spokenText).toContain('Chair Protection Cover');
    expect(turn2Voice.spokenText).toContain('499');
    expect(catalogSearchCalls.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 3 — VOICE CHECKOUT INTENT ESTABLISHMENT & BREAKDOWN
  // =========================================================================
  it('SCENARIO 3: "please mera order confirm krdo" establishes full breakdown for active chair product', async () => {
    // Turn 1: Discuss chair cover
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-chk-1',
      fromPhone: TEST_SENDER,
      messageText: 'show me chair protection cover'
    });

    // Turn 2 Voice: "please mera order confirm krdo"
    const turn2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-chk-1',
      fromPhone: TEST_SENDER,
      messageText: 'please mera order confirm krdo',
      isVoiceInbound: true
    });

    expect(turn2.success).toBe(true);
    const spoken = turn2.spokenText;
    // Must clearly establish:
    // 1. which product: Chair Protection Cover
    expect(spoken).toContain('Chair Protection Cover');
    // 2. quantity: 1
    expect(spoken).toMatch(/quantity (1|ek)/i);
    // 3. price: Rs. 499
    expect(spoken).toContain('499');
    // 4. delivery: Rs. 199
    expect(spoken).toContain('199');
    // 5. total: Rs. 698
    expect(spoken).toContain('698');
    // 6. asks for customer name, phone, address, city
    expect(spoken).toMatch(/naam|address|shehar|city/i);
    // 7. establishes this as a new booking
    expect(spoken).toMatch(/naya order/i);
  });

  // =========================================================================
  // SCENARIO 4 — "123" MUST NEVER RESOLVE TO #1643
  // =========================================================================
  it('SCENARIO 4: "123" returns NO ORDER MATCH and NEVER resolves to #1643', async () => {
    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-num-1',
      fromPhone: TEST_SENDER,
      messageText: '123'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('123');
    expect(res.replyText).toMatch(/record mein nahi mila|nahi mila/i);
    // CRITICAL: NEVER RESOLVE TO #1643
    expect(res.replyText).not.toContain('1643');
    expect(res.replyText).not.toContain('Magnetic Nasal Dilator');
  });

  // =========================================================================
  // SCENARIO 5 — "mera order kahan pohcha" EXECUTES ORDER_STATUS, NOT CATALOG
  // =========================================================================
  it('SCENARIO 5: "mera order kahan pohcha" executes order lookup/status with ZERO catalog search', async () => {
    catalogSearchCalls = [];

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-status-1',
      fromPhone: TEST_SENDER,
      messageText: 'mera order kahan pohcha'
    });

    expect(res.success).toBe(true);
    // Catalog search must NEVER be called
    expect(catalogSearchCalls.length).toBe(0);
    // Must not mention unrelated catalog products
    expect(res.replyText).not.toContain('Bath Brush');
    // Must relate to orders
    expect(res.replyText).toMatch(/order/i);
  });

  // =========================================================================
  // SCENARIO 6 — PAST ORDER LOOKUP BY PRODUCT & TIME ("kal mene chair protection cover order kiya tha...")
  // =========================================================================
  it('SCENARIO 6: Past order reference matches Order A (#1640) with zero catalog search', async () => {
    catalogSearchCalls = [];

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-past-1',
      fromPhone: TEST_SENDER,
      messageText: 'kal mene aik chair protection cover order kiya tha uska order number mujhe yad nahi araha tum batadogi?'
    });

    expect(res.success).toBe(true);
    // Resolves Order A (#1640)
    expect(res.replyText).toContain('1640');
    expect(res.replyText).toContain('Chair Protection Cover');
    // Zero catalog search!
    expect(catalogSearchCalls.length).toBe(0);
    expect(res.replyText).not.toContain('Bath Brush');
  });

  // =========================================================================
  // SCENARIO 7 — CUSTOMER IDENTITY LOOKUP ("mera name Ali hy aur address karachi hy...")
  // =========================================================================
  it('SCENARIO 7: Directory lookup by name & city routes to order lookup, NEVER to Bath Brush', async () => {
    catalogSearchCalls = [];

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-dir-1',
      fromPhone: TEST_SENDER,
      messageText: 'mera name Ali hy aur address karachi hy apne directory main check karo mere details se jo order hy uska status btao'
    });

    expect(res.success).toBe(true);
    // Must NOT call catalog search
    expect(catalogSearchCalls.length).toBe(0);
    // Must NEVER return 2 in 1 Bath Brush!
    expect(res.replyText).not.toContain('Bath Brush');
    expect(res.replyText).toMatch(/order/i);
  });

  // =========================================================================
  // MANDATORY AMBIGUITY TEST
  // =========================================================================
  it('MANDATORY AMBIGUITY: Multiple matching chair orders prompts clarification, does not guess', async () => {
    // Add second chair order
    dbOrders = [
      mockOrderA,
      {
        ...mockOrderA,
        id: 'order-1641-uuid',
        orderNumber: '1641',
        createdAt: new Date().toISOString(),
        payload: JSON.stringify({
          order_number: '1641',
          shipping_address: { name: 'Ali', city: 'Karachi', phone: TEST_PHONE, address1: 'Gulshan-e-Iqbal' },
          line_items: [{ title: 'Wooden Silicone Chair Protection Cover', price: '499.00' }]
        })
      }
    ];

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-amb-1',
      fromPhone: TEST_SENDER,
      messageText: 'chair cover wala order check karo'
    });

    expect(res.success).toBe(true);
    // Should prompt for clarification listing the orders
    expect(res.replyText).toMatch(/orders record mein hain|kis order/i);
    expect(res.replyText).toContain('1640');
    expect(res.replyText).toContain('1641');
  });

  // =========================================================================
  // MANDATORY NEGATION TEST
  // =========================================================================
  it('MANDATORY NEGATION: "order confirm nahi karna" does not confirm the order', async () => {
    const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-neg-1',
      fromPhone: TEST_SENDER,
      messageText: 'order confirm nahi karna'
    });

    expect(res.success).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalledWith('confirm_order', expect.anything(), expect.anything());
    expect(res.replyText).toMatch(/confirm nahi kiya gaya/i);
  });

  // =========================================================================
  // MANDATORY TOPIC INTERRUPTION TEST
  // =========================================================================
  it('MANDATORY TOPIC INTERRUPTION: "girlfriend naraz hai" does not drop active chair product', async () => {
    // Turn 1: Chair product
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-topic-1',
      fromPhone: TEST_SENDER,
      messageText: 'chair protection cover dikhao'
    });

    // Turn 2: Topic interruption
    const turn2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-topic-1',
      fromPhone: TEST_SENDER,
      messageText: 'meri girlfriend naraz hai'
    });
    expect(turn2.success).toBe(true);

    catalogSearchCalls = [];

    // Turn 3: "acha iski price kya hai"
    const turn3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-topic-1',
      fromPhone: TEST_SENDER,
      messageText: 'acha iski price kya hai'
    });

    expect(turn3.success).toBe(true);
    expect(turn3.replyText).toContain('Chair Protection Cover');
    expect(turn3.replyText).toContain('499');
    expect(catalogSearchCalls.length).toBe(0);
  });

  // =========================================================================
  // MANDATORY UNRELATED TOPIC TEST
  // =========================================================================
  it('MANDATORY UNRELATED TOPIC: "weather kaisa hai?" does not drop active chair product for link', async () => {
    // Turn 1: Chair product
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-unrel-1',
      fromPhone: TEST_SENDER,
      messageText: 'chair protection cover dikhao'
    });

    // Turn 2: Weather inquiry
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-unrel-1',
      fromPhone: TEST_SENDER,
      messageText: 'weather kaisa hai?'
    });

    // Turn 3: "acha iska link bhejo"
    const turn3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: SHOP_ID,
      shopDomain: SHOP_DOMAIN,
      sessionId: 'sess-unrel-1',
      fromPhone: TEST_SENDER,
      messageText: 'acha iska link bhejo'
    });

    expect(turn3.success).toBe(true);
    expect(turn3.replyText).toContain('products/wooden-silicone-chair-protection-cover');
  });
});
