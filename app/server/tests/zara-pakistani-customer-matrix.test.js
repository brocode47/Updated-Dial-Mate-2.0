import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { IntentResolver } from '../src/services/intentResolver.js';
import { ResponseQualityControlService } from '../src/services/responseQualityControlService.js';

describe('DIAL MATE 2.0 — 100+ REALISTIC PAKISTANI CUSTOMER UTTERANCE MATRIX', () => {
  const TEST_PHONE = '923333255998';
  const TEST_SENDER = `${TEST_PHONE}@s.whatsapp.net`;
  const SHOP_ID = 'shop-matrix-1';
  const SHOP_DOMAIN = 'sundaybazaaar.store';

  const mockShop = {
    id: SHOP_ID,
    domain: SHOP_DOMAIN,
    name: 'Sunday Bazaaar',
    ownerPhone: '+923333255998',
    settings: { operatorPhone: '+923333255998' }
  };

  const mockChair = {
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

  const mockSnoring = {
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

  const mockBrush = {
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
  const mockOrder1640 = {
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

  const mockOrder1643 = {
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
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    payload: JSON.stringify({
      order_number: '1643',
      shipping_address: { name: 'Ali', city: 'Karachi', phone: TEST_PHONE, address1: 'Gulshan-e-Iqbal' },
      line_items: [{ title: 'Anti Snoring Magnetic Nasal Dilator', price: '999.00' }]
    })
  };

  let dbOrders = [mockOrder1640, mockOrder1643];
  let catalogSearches = [];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ZARA_DEBUG_CONTEXT = 'true';
    catalogSearches = [];
    dbOrders = [mockOrder1640, mockOrder1643];
    ConversationStateService.clearMemory();

    if (prisma.shop) vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
    if (prisma.customer) {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
        id: 'cust-ali-1',
        phone: '923333255998',
        firstName: 'Ali',
        city: 'Karachi'
      });
      vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'cust-ali-1', phone: TEST_PHONE, firstName: 'Ali' });
    }
    if (prisma.conversation) {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-matrix-1', messages: [] });
      vi.spyOn(prisma.conversation, 'create').mockResolvedValue({ id: 'conv-matrix-1', messages: [] });
    }
    if (prisma.message) vi.spyOn(prisma.message, 'create').mockResolvedValue({});
    if (prisma.aIInteractionLog) vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

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

    vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'msg-out-1' });
    vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({ id: 'msg-media-1' });
    vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
      success: true,
      buffer: Buffer.from('mock voice note ogg opus'),
      format: 'ogg',
      durationSeconds: 2.0
    });

    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockImplementation(async (domain, query) => {
      catalogSearches.push(query);
      const clean = (query || '').toLowerCase().trim();
      if (/chair|cover|protection|kursi|chear/i.test(clean)) {
        return { products: [mockChair], totalFound: 1 };
      }
      if (/snore|snoring|dilator|kharat/i.test(clean)) {
        return { products: [mockSnoring], totalFound: 1 };
      }
      if (/bath|brush/i.test(clean)) {
        return { products: [mockBrush], totalFound: 1 };
      }
      return { products: [], totalFound: 0 };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // GROUP 1: PRODUCT DISCOVERY WITH TYPOS, PHONETICS & SLANG (15 Utterances)
  // =========================================================================
  describe('Group 1: Product Discovery (15 Pakistani Utterances)', () => {
    const productUtterances = [
      'chair protection cover dikhao',
      'chair protekshan',
      'chair wala cover',
      'mujhy chair ka cover chahiye',
      'chear cover dikha do',
      'kursi ke paye wala cover',
      'snoring dilator',
      'kharate rokne wali cheez',
      'anti snoring magnetic nasal dilator',
      'bath brush dikhana',
      'show me chair cover',
      'chair leg protector',
      'woh chair cover',
      'mujhe cover chahiye',
      'kursi cover kitne ka hai'
    ];

    for (const [idx, utt] of productUtterances.entries()) {
      it(`[P${idx + 1}] Handles utterance "${utt}" by identifying product intent`, async () => {
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-prod-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: utt
        });
        expect(turn.success).toBe(true);
        expect(turn.replyText).toBeTruthy();
        expect(turn.replyText).not.toContain('1643');
      });
    }
  });

  // =========================================================================
  // GROUP 2: PRONOUN, ORDINAL & CONTEXTUAL PRICING (15 Utterances)
  // =========================================================================
  describe('Group 2: Pronoun & Contextual Pricing (15 Utterances)', () => {
    const pronounUtterances = [
      'iski price?',
      'iska total?',
      'ye kitne ka hai',
      'iski price kya hai',
      'iska rate btao',
      'iska link bhejo',
      'link send kro',
      'ye wala kitne ka paray ga',
      'pehle wale ki price',
      'iska delivery kitna hai',
      'total with delivery kitna padega',
      'ghar tak kitne ka hoga',
      'delivery charges kitny hain',
      'iska direct link do',
      'url send kardo'
    ];

    for (const [idx, utt] of pronounUtterances.entries()) {
      it(`[PR${idx + 1}] Handles pronoun query "${utt}" grounded in active chair entity`, async () => {
        // Preload active chair product in conversation state
        await ConversationStateService.setActiveProduct(
          `${SHOP_ID}:+${TEST_PHONE}`,
          mockChair
        );

        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-pronoun-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: utt
        });
        expect(turn.success).toBe(true);
        // Guaranteed: Never mentions unrelated products
        expect(turn.replyText).not.toContain('Bath Brush');
        expect(turn.replyText).not.toContain('Nasal Dilator');
      });
    }
  });

  // =========================================================================
  // GROUP 3: ORDER LOOKUP BY DETAILS & TIME (15 Utterances)
  // =========================================================================
  describe('Group 3: Order Lookup by Customer Details & Time (15 Utterances)', () => {
    const orderUtterances = [
      'mera order check kro',
      'kal wala order',
      'mera order kaha pohcha',
      'order status btao',
      'parcel kidhar hai',
      'Ali Karachi order',
      '1640 wala order kahan pohcha',
      'jo order kal kiya tha',
      'kal aik order kiya tha status kya hai',
      'tracking number bta dein',
      'order kab ayega',
      'parcel kab milega',
      'meri delivery kab tak hogi',
      'directory mein check karein Ali Gulshan',
      'phone se order dhoondo'
    ];

    for (const [idx, utt] of orderUtterances.entries()) {
      it(`[ORD${idx + 1}] Handles order query "${utt}" without catalog leakage`, async () => {
        catalogSearches = [];
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-order-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: utt
        });
        expect(turn.success).toBe(true);
        // CRITICAL PRODUCTION GUARANTEE: Never leak catalog search during order lookup
        expect(catalogSearches.length).toBe(0);
      });
    }
  });

  // =========================================================================
  // GROUP 4: EXACT ORDER NUMBERS & NO #1643 FALLBACK (10 Utterances)
  // =========================================================================
  describe('Group 4: Exact Order Numbers & No #1643 Fallback (10 Utterances)', () => {
    const exactValid = ['1640', '#1640', 'order 1640', '1643', '#1643'];
    for (const [idx, num] of exactValid.entries()) {
      it(`[EX_VALID_${idx + 1}] Exactly resolves matching order "${num}"`, async () => {
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-num-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: num
        });
        expect(turn.success).toBe(true);
        const expectedOrder = num.includes('1640') ? '1640' : '1643';
        expect(turn.replyText).toContain(expectedOrder);
      });
    }

    const unmatchable = ['123', '#9999', 'order 888', '123 wala', '777'];
    for (const [idx, num] of unmatchable.entries()) {
      it(`[EX_UNMATCHED_${idx + 1}] Refuses unmatched order "${num}" and NEVER falls back to #1643`, async () => {
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-unmatch-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: num
        });
        expect(turn.success).toBe(true);
        expect(turn.replyText).not.toContain('1643');
        expect(turn.replyText).toContain('record mein nahi mila');
      });
    }
  });

  // =========================================================================
  // GROUP 5: CHECKOUT, CONFIRMATION & NEGATION SAFETY (15 Utterances)
  // =========================================================================
  describe('Group 5: Checkout & Negation Safety (15 Utterances)', () => {
    const checkoutUtterances = [
      { text: 'mera order confirm krdo', expectConfirm: true },
      { text: 'confirm kar dein', expectConfirm: true },
      { text: '1', expectConfirm: true },
      { text: 'ji yehi book kardo', expectConfirm: true },
      { text: 'ye wala order kar do', expectConfirm: true },
      { text: 'confirm nahi krna', expectConfirm: false, negated: true },
      { text: 'confirm mat karna', expectConfirm: false, negated: true },
      { text: 'cancel krdo', expectCancel: true },
      { text: 'cancel mt krna', expectCancel: false, negatedCancel: true },
      { text: 'cancel mat karna dispatch kar do', expectConfirm: true },
      { text: 'rehne do mujhe nahi chahiye', expectReject: true },
      { text: 'nahi lena', expectReject: true },
      { text: 'abhi nahi soch kar batata hun', expectConfirm: false, negated: true },
      { text: 'nahi chahiye', expectReject: true },
      { text: 'cancel this product', expectReject: true }
    ];

    for (const [idx, c] of checkoutUtterances.entries()) {
      it(`[CHK_${idx + 1}] Safety for utterance "${c.text}"`, async () => {
        await ConversationStateService.updateState(`${SHOP_ID}:+${TEST_PHONE}`, {
          activeProduct: mockChair,
          recentTopic: 'checkout'
        });

        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-chk-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: c.text
        });
        expect(turn.success).toBe(true);

        if (c.negated) {
          expect(turn.replyText).toContain('confirm nahi');
        } else if (c.negatedCancel) {
          expect(turn.replyText).toContain('cancel nahi');
        } else if (c.expectReject) {
          const stateAfter = await ConversationStateService.getState(`${SHOP_ID}:+${TEST_PHONE}`);
          expect(stateAfter.activeProduct).toBeNull();
        }
      });
    }
  });

  // =========================================================================
  // GROUP 6: HUMAN ESCALATION & RETENTION (10 Utterances)
  // =========================================================================
  describe('Group 6: Human Escalation (10 Utterances)', () => {
    const humanUtterances = [
      'owner se baat krwao',
      'human se baat karni hai',
      'real person se baat karwao',
      'kisi bande ko bulao',
      'customer support se connect karo',
      'agent se baat karni hai',
      'live agent please',
      'owner ka number do',
      'manager se baat karao',
      'insaan se baat karwao'
    ];

    for (const [idx, utt] of humanUtterances.entries()) {
      it(`[HUMAN_${idx + 1}] Correctly triggers human escalation for "${utt}" without crashing`, async () => {
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-human-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: utt
        });
        expect(turn.success).toBe(true);
        expect(turn.replyText).toContain('support team');
        // Conversation is NOT terminated permanently
        const state = await ConversationStateService.getState(`${SHOP_ID}:+${TEST_PHONE}`);
        expect(state.isClosed).toBeFalsy();
      });
    }
  });

  // =========================================================================
  // GROUP 7: GENERAL CHITCHAT, ATTITUDE & FRUSTRATION (15 Utterances)
  // =========================================================================
  describe('Group 7: Chitchat, Frustration & Small Talk (15 Utterances)', () => {
    const chitchatUtterances = [
      { text: 'tumhara naam kya hai', match: 'Zara' },
      { text: 'tumhare owner ka naam kya hai', match: 'Sunday Bazaaar' },
      { text: 'tumhara masla kya hai', match: 'afsos' },
      { text: 'yr tumhara masla kya hai', match: 'afsos' },
      { text: 'tum kya bata rahi ho', match: 'afsos' },
      { text: 'bekar bot ho', match: 'afsos' },
      { text: 'samajh nahi aa raha', match: 'afsos' },
      { text: 'meri girlfriend naraz hai', match: 'girlfriend' },
      { text: 'mujhe neend nahi aa rahi', match: 'neend' },
      { text: 'friendship karogi?', match: 'dost' },
      { text: 'dosti karogi', match: 'dost' },
      { text: 'hello', match: 'madad' },
      { text: 'assalam o alaikum', match: 'madad' },
      { text: 'bye', match: 'Hafiz' },
      { text: 'Allah Hafiz', match: 'Hafiz' }
    ];

    for (const [idx, c] of chitchatUtterances.entries()) {
      it(`[CHAT_${idx + 1}] Handles chitchat / frustration "${c.text}"`, async () => {
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-chat-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: c.text
        });
        expect(turn.success).toBe(true);
        expect(turn.replyText.toLowerCase()).toContain(c.match.toLowerCase());
      });
    }
  });

  // =========================================================================
  // GROUP 8: MULTIPLE PRODUCTS & COLLECTIONS (10 Utterances)
  // =========================================================================
  describe('Group 8: Multiple Products & Collections (10 Utterances)', () => {
    const collectionUtterances = [
      { text: 'cleaning products dikhao', expectedUrl: 'cleaning-products' },
      { text: 'cleaning ke products', expectedUrl: 'cleaning-products' },
      { text: 'kitchen ke products dikhao', expectedUrl: 'kitchen-collections' },
      { text: 'mobile accessories dikhao', expectedUrl: 'mobile-accessories' },
      { text: 'women collection dikhao', expectedUrl: 'women-collection' },
      { text: 'aur products dikhao', expectedUrl: 'all-products' },
      { text: 'catalog bhejo', expectedUrl: 'sundaybazaaar.store' },
      { text: 'website ka link', expectedUrl: 'sundaybazaaar.store' },
      { text: 'store link do', expectedUrl: 'sundaybazaaar.store' },
      { text: 'online store ka url', expectedUrl: 'sundaybazaaar.store' }
    ];

    for (const [idx, col] of collectionUtterances.entries()) {
      it(`[COL_${idx + 1}] Returns curated collection link for "${col.text}"`, async () => {
        const turn = await WhatsAppAgentService.handleIncomingMessage({
          shopId: SHOP_ID,
          shopDomain: SHOP_DOMAIN,
          sessionId: `sess-col-${idx}`,
          fromPhone: TEST_SENDER,
          messageText: col.text
        });
        expect(turn.success).toBe(true);
        expect(turn.replyText).toContain(col.expectedUrl);
      });
    }
  });

  // =========================================================================
  // GROUP 9: VOICE NOTE SPOKEN TEXT & QUALITY CONTROL (5 Utterances)
  // =========================================================================
  describe('Group 9: Voice Spoken Output Quality Control (5 Utterances)', () => {
    it('[VOICE_QC_1] Outbound spokenText contains zero raw URLs', async () => {
      await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockChair);

      const turn = await WhatsAppAgentService.handleIncomingMessage({
        shopId: SHOP_ID,
        shopDomain: SHOP_DOMAIN,
        sessionId: 'sess-voice-qc',
        fromPhone: TEST_SENDER,
        messageText: 'iski price kya hai',
        isVoiceInbound: true
      });

      expect(turn.success).toBe(true);
      expect(turn.spokenText).toBeDefined();
      expect(turn.spokenText).not.toContain('http');
      expect(turn.spokenText).not.toContain('🔗');
      expect(turn.spokenText).not.toContain('sundaybazaaar.store');
    });

    it('[VOICE_QC_2] Rejection memory suppresses re-recommending rejected product', async () => {
      // 1. Customer rejects chair cover
      await ConversationStateService.setActiveProduct(`${SHOP_ID}:+${TEST_PHONE}`, mockChair);
      await WhatsAppAgentService.handleIncomingMessage({
        shopId: SHOP_ID,
        shopDomain: SHOP_DOMAIN,
        sessionId: 'sess-rej-1',
        fromPhone: TEST_SENDER,
        messageText: 'nahi mujhe nahi chahiye'
      });

      // 2. Customer asks a general follow-up
      const followUp = await WhatsAppAgentService.handleIncomingMessage({
        shopId: SHOP_ID,
        shopDomain: SHOP_DOMAIN,
        sessionId: 'sess-rej-2',
        fromPhone: TEST_SENDER,
        messageText: 'koi aur cheez hai?'
      });

      expect(followUp.success).toBe(true);
      // Must NOT re-pitch the rejected chair cover
      expect(followUp.replyText).not.toContain('Wooden Silicone Chair Protection Cover ki price');
    });

    it('[VOICE_QC_3] Response Quality Control repairs incorrect arithmetic total', () => {
      const repaired = ResponseQualityControlService.validateAndRepair({
        replyText: 'Chair cover Rs. 499 ka hai aur delivery 199 hai. Total Rs. 999 banta hai.',
        intent: 'PRODUCT_DETAIL',
        activeProduct: mockChair
      });

      expect(repaired.repaired).toBe(true);
      expect(repaired.replyText).toContain('total Rs. 698');
    });

    it('[VOICE_QC_4] Response Quality Control strips duplicate sentences', () => {
      const repetitiveText = 'Delivery charges Rs. 199 hain.\nDelivery charges Rs. 199 hain.\nTamam Pakistan mein delivery available hai.';
      const repaired = ResponseQualityControlService.validateAndRepair({
        replyText: repetitiveText,
        intent: 'ORDER_DELIVERY_CHARGES'
      });

      const lines = repaired.replyText.split('\n');
      const deliveryLines = lines.filter(l => l.includes('Delivery charges Rs. 199'));
      expect(deliveryLines.length).toBe(1);
    });

    it('[VOICE_QC_5] Intent Normalizer handles severe Pakistani typos seamlessly', () => {
      const raw = 'mjhe chear protekshan chaiye plz delvry charges btao';
      const clean = IntentResolver.normalizeText(raw);
      expect(clean).toContain('mujhe');
      expect(clean).toContain('chair');
      expect(clean).toContain('protection');
      expect(clean).toContain('chahiye');
      expect(clean).toContain('delivery');
      expect(clean).toContain('batao');
    });
  });
});
