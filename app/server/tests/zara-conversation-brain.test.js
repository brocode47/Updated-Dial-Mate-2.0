import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { IntentResolver } from '../src/services/intentResolver.js';
import {
  ConversationBrain,
  MessageNormalizer,
  SemanticContextResolver,
  IntentEngine,
  ActiveEntityType,
  IntentFamily
} from '../src/services/conversationBrain.js';

describe('Dial Mate 2.0 — Zara Phase 1 Conversation Brain Architecture Suite', () => {
  const mockShop = {
    id: 'shop-1',
    domain: 'sundaybazaaar.store',
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
    description: 'Anti snoring kit helps reduce snoring and improve breathing.'
  };

  const mockOrder1643 = {
    id: 'order-1643-uuid',
    orderId: 'order-1643-uuid',
    orderNumber: '1643',
    items: 'Wooden Silicone Chair Protection Cover',
    totalAmount: 698,
    shippingFee: 199,
    status: 'Dispatched',
    financialStatus: 'Pending',
    createdAt: new Date().toISOString()
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
    vi.spyOn(prisma.shop, 'findFirst').mockResolvedValue(mockShop);
    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998', name: 'Arslan' });
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1643]);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);
    vi.spyOn(prisma.order, 'findUnique').mockResolvedValue(mockOrder1643);

    vi.spyOn(DeliveryService, 'getDeliveryQuote').mockResolvedValue({
      deliveryCharge: 199,
      isFreeDelivery: false,
      estimatedDays: '3-4 working days',
      formattedText: 'Standard delivery charges Rs. 199 hain'
    });

    vi.spyOn(DeliveryService, 'calculateTotal').mockImplementation((subtotal, fee = 199) => ({
      subtotal,
      deliveryCharge: fee,
      total: subtotal + fee,
      formattedSubtotal: `Rs. ${subtotal}`,
      formattedDelivery: `Rs. ${fee}`,
      formattedTotal: `Rs. ${subtotal + fee}`
    }));

    vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'msg-1' });
    vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({ id: 'msg-media-1' });
    vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
      success: true,
      buffer: Buffer.from('mock voice ogg'),
      format: 'ogg',
      durationSeconds: 2.5
    });

    if (prisma.message) {
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
    }
    if (prisma.aIInteractionLog) {
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. CORE DISCOURSE CONTINUITY: "Chair Cover" -> "Iski price" -> "dc?" -> "total?" -> "link?"
  // =========================================================================
  describe('Discourse Continuity & Elliptical Query Resolution', () => {
    it('maintains 100% active entity continuity across multi-turn elliptical inquiries without vacuous non-answers', async () => {
      const convId = 'conv-discourse-flow-1';
      let stateStore = {
        activeProduct: null,
        currentProduct: null,
        activeOrder: null,
        recentTopic: 'unknown',
        conversationPhase: 'greeting',
        recentEntities: []
      };

      vi.spyOn(ConversationStateService, 'getState').mockImplementation(async () => stateStore);
      vi.spyOn(ConversationStateService, 'updateState').mockImplementation(async (id, patch) => {
        stateStore = { ...stateStore, ...patch };
        return stateStore;
      });

      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
        id: convId,
        isTakeover: false,
        messages: []
      });

      // Turn 1: Product Inquiry
      vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
        products: [mockProductChair],
        count: 1
      });
      const turn1 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-flow-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'Chair protection cover ka batao'
      });

      expect(turn1.replyText).toContain('Chair Protection Cover');
      expect(stateStore.activeProduct.title).toBe(mockProductChair.title);

      // Turn 2: Demonstrative Price Follow-up "Iski price kya hy"
      const turn2 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-flow-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'Iski price kya hy'
      });

      expect(turn2.replyText).toContain('499');
      expect(turn2.replyText).toContain('Chair Protection Cover');
      expect(stateStore.activeProduct.title).toBe(mockProductChair.title);

      // Turn 3: Diagnostic Critical Test: "dc?"
      // Zara must resolve "dc" to delivery charges for active product and NOT emit "Ji, main samajh gayi hoon"
      const turn3 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-flow-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'dc?'
      });

      expect(turn3.replyText).not.toBe('Ji, main samajh gayi hoon.');
      expect(turn3.replyText).toContain('199');
      expect(turn3.replyText.toLowerCase()).toContain('delivery');

      // Turn 4: "total?"
      const turn4 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-flow-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'total?'
      });

      expect(turn4.replyText).toContain('698');
      expect(turn4.replyText).toContain('499');
      expect(turn4.replyText).toContain('199');

      // Turn 5: "iska link"
      const turn5 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-flow-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'iska link'
      });

      expect(turn5.replyText).toContain(mockProductChair.url);
    });

    it('resolves semantic delivery queries across natural Pakistani phrasing without string matching', async () => {
      const phrases = [
        'dc?',
        'delivery?',
        'delivery kitni?',
        'delivery charges?',
        'shipping kitni hai?',
        'aur delivery ka kya scene hai?',
        'ghar tak kitna lagega?',
        'iske saath shipping?',
        'delivery fee kitni hy'
      ];

      for (const phrase of phrases) {
        const detected = WhatsAppAgentService.detectIntent(phrase, {
          activeProduct: mockProductChair,
          state: { activeProduct: mockProductChair }
        });
        expect(['DELIVERY_INQUIRY', 'ORDER_DELIVERY_CHARGES']).toContain(detected.intent);
      }
    });

    it('resolves semantic total inquiries across natural Pakistani phrasing', async () => {
      const phrases = [
        'total?',
        'final kitna?',
        'all inclusive kitna?',
        'yeh kitne ka paray ga?',
        'kul kitna banega?',
        'delivery mila k kitna?',
        'total with delivery?',
        'ghar tak kitne banenge?'
      ];

      for (const phrase of phrases) {
        const detected = WhatsAppAgentService.detectIntent(phrase, {
          activeProduct: mockProductChair,
          state: { activeProduct: mockProductChair }
        });
        expect(['TOTAL_INQUIRY', 'ORDER_TOTAL', 'TOTAL_COST_INQUIRY', 'PRODUCT_DETAIL']).toContain(detected.intent);
      }
    });
  });

  // =========================================================================
  // 2. CONTEXT SWITCH DETECTION & TOPIC SWITCHING
  // =========================================================================
  describe('Context Switch Detection vs Continuation', () => {
    it('accurately distinguishes topic switch from continuation when customer changes product', async () => {
      let state = {
        activeProduct: mockProductChair,
        currentProduct: mockProductChair,
        recentTopic: 'product'
      };

      // 1. Continuation: "iski price?" continues with Chair
      const norm1 = MessageNormalizer.normalize('iski price?');
      const disc1 = SemanticContextResolver.evaluateDiscourse(norm1, state);
      expect(disc1.isContinuation).toBe(true);
      expect(disc1.isTopicSwitch).toBe(false);

      // 2. Explicit Product Switch: "acha anti snoring wala dikhao"
      const norm2 = MessageNormalizer.normalize('acha anti snoring wala dikhao');
      const disc2 = SemanticContextResolver.evaluateDiscourse(norm2, state);
      expect(disc2.isTopicSwitch).toBe(true);
      expect(disc2.targetEntityType).toBe(ActiveEntityType.PRODUCT);

      // Update state to snoring
      state.activeProduct = mockProductSnoring;
      state.currentProduct = mockProductSnoring;

      // 3. Follow-up after switch: "iski price?" now continues with Snoring, NOT Chair!
      const norm3 = MessageNormalizer.normalize('iski price?');
      const disc3 = SemanticContextResolver.evaluateDiscourse(norm3, state);
      expect(disc3.isContinuation).toBe(true);
      const entityRes3 = SemanticContextResolver.resolveEntity(norm3, state, disc3);
      expect(entityRes3.resolvedEntity.title).toBe(mockProductSnoring.title);

      // 4. Switch to Order: "mera order check karo"
      const norm4 = MessageNormalizer.normalize('mera order check karo');
      const disc4 = SemanticContextResolver.evaluateDiscourse(norm4, state);
      expect(disc4.isTopicSwitch).toBe(true);
      expect(disc4.targetEntityType).toBe(ActiveEntityType.ORDER);
    });

    it('preserves order context during order follow-ups and switches back cleanly', () => {
      let state = {
        activeOrder: mockOrder1643,
        currentOrder: mockOrder1643,
        recentTopic: 'order'
      };

      // Turn 1: "mera order kahan hai?" -> Order entity
      const norm1 = MessageNormalizer.normalize('mera order kahan hai?');
      const disc1 = SemanticContextResolver.evaluateDiscourse(norm1, state);
      expect(disc1.targetEntityType).toBe(ActiveEntityType.ORDER);

      // Turn 2: "yeh kab pohanchega?" -> Continues same order
      const norm2 = MessageNormalizer.normalize('yeh kab pohanchega?');
      const disc2 = SemanticContextResolver.evaluateDiscourse(norm2, state);
      expect(disc2.targetEntityType).toBe(ActiveEntityType.ORDER);
      const entityRes2 = SemanticContextResolver.resolveEntity(norm2, state, disc2);
      expect(entityRes2.resolvedEntity.orderNumber).toBe('1643');
    });
  });

  // =========================================================================
  // 3. NON-PRODUCT CONVERSATIONS, CASUAL GUARD & HUMAN ESCALATION
  // =========================================================================
  describe('Casual Conversation Guard & Tool Selection Safety', () => {
    it('never invokes Shopify catalog search or recommends products for casual/emotional expressions', () => {
      const casualMessages = [
        'main upset hun',
        'aaj mera mood off hai',
        'bohat udas hun',
        'kaisi ho aap',
        'tumhara naam kya hai',
        'chup karo',
        'shukriya'
      ];

      for (const msg of casualMessages) {
        const norm = MessageNormalizer.normalize(msg);
        const disc = SemanticContextResolver.evaluateDiscourse(norm, {});
        expect(disc.targetEntityType).not.toBe(ActiveEntityType.PRODUCT);

        const intent = IntentEngine.inferIntent(norm, disc, {}, {});
        expect(intent.family).not.toBe(IntentFamily.PRODUCT_DISCOVERY);
        expect(intent.family).not.toBe(IntentFamily.PRODUCT_DETAIL);
      }
    });

    it('triggers human escalation cleanly without recommending products when requested', () => {
      const supportMessages = [
        'real person se baat karni hai',
        'kisi insan se connect karo',
        'mujhe live agent chahiye',
        'owner se baat karwao'
      ];

      for (const msg of supportMessages) {
        const norm = MessageNormalizer.normalize(msg);
        const disc = SemanticContextResolver.evaluateDiscourse(norm, {});
        expect(disc.targetEntityType).toBe(ActiveEntityType.HUMAN_SUPPORT);
        const intent = IntentEngine.inferIntent(norm, disc, {}, {});
        expect(intent.family).toBe(IntentFamily.HUMAN_TRANSFER);
      }
    });
  });

  // =========================================================================
  // 4. AMBIGUITY & CLARIFICATION HANDLING
  // =========================================================================
  describe('Ambiguity Handling & Clarification Contract', () => {
    it('triggers CLARIFICATION_NEEDED when pronoun reference is ambiguous across multiple entities', () => {
      const stateWithMultiple = {
        activeProduct: null,
        recentEntities: [mockProductChair, mockProductSnoring]
      };

      const norm = MessageNormalizer.normalize('iska batao');
      const disc = SemanticContextResolver.evaluateDiscourse(norm, stateWithMultiple);
      const entityRes = SemanticContextResolver.resolveEntity(norm, stateWithMultiple, disc);

      expect(entityRes.ambiguous).toBe(true);
      expect(entityRes.possibleEntities.length).toBe(2);

      const contract = ConversationBrain.buildResponseContract({
        rawMessage: 'iska batao',
        normalizedMessage: norm,
        discourseContext: disc,
        entityResolution: entityRes,
        intent: { family: IntentFamily.PRODUCT_DETAIL, intent: 'PRODUCT_DETAIL' },
        state: stateWithMultiple
      });

      expect(contract.action).toBe('CLARIFY_AMBIGUITY');
    });

    it('resolves automatically without unnecessary clarification when active entity is unambiguous', () => {
      const stateWithSingle = {
        activeProduct: mockProductChair,
        recentEntities: [mockProductChair]
      };

      const norm = MessageNormalizer.normalize('iska batao');
      const disc = SemanticContextResolver.evaluateDiscourse(norm, stateWithSingle);
      const entityRes = SemanticContextResolver.resolveEntity(norm, stateWithSingle, disc);

      expect(entityRes.ambiguous).toBe(false);
      expect(entityRes.resolvedEntity.title).toBe(mockProductChair.title);
    });
  });

  // =========================================================================
  // 5. CROSS-MODALITY (VOICE <-> TEXT) CONTINUITY
  // =========================================================================
  describe('Cross-Modality Unified Conversation Brain', () => {
    it('preserves complete active context across Text and Voice modality alternations', async () => {
      const convId = 'conv-cross-modality-1';
      let stateStore = {
        activeProduct: mockProductChair,
        currentProduct: mockProductChair,
        recentTopic: 'product',
        conversationPhase: 'product_browsing'
      };

      vi.spyOn(ConversationStateService, 'getState').mockImplementation(async () => stateStore);
      vi.spyOn(ConversationStateService, 'updateState').mockImplementation(async (id, patch) => {
        stateStore = { ...stateStore, ...patch };
        return stateStore;
      });

      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
        id: convId,
        isTakeover: false,
        messages: []
      });

      // 1. Inbound Voice: "iski price kya hai"
      const r1 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-cm-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'iski price kya hai',
        isVoiceInbound: true
      });

      expect(r1.isVoiceResponse).toBe(true);
      expect(r1.spokenText).toContain('499');

      // 2. Next Inbound Text: "dc?"
      const r2 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-cm-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'dc?',
        isVoiceInbound: false
      });

      expect(r2.isVoiceResponse).toBe(false);
      expect(r2.replyText).toContain('199');

      // 3. Next Inbound Voice: "total?"
      const r3 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: mockShop.id,
        shopDomain: mockShop.domain,
        sessionId: 'sess-cm-1',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'total?',
        isVoiceInbound: true
      });

      expect(r3.isVoiceResponse).toBe(true);
      expect(r3.spokenText).toContain('698');
    });
  });

  // =========================================================================
  // 6. PROGRAMMATIC ADVERSARIAL PAKISTANI CONVERSATION GENERATOR
  // =========================================================================
  describe('Programmatic Adversarial Linguistic Stress Suite', () => {
    it('generalizes robustly across programmatically generated Pakistani customer communications', () => {
      // Combinatorial variations:
      const prefixes = ['', 'acha ', 'bhai ', 'aur ', 'yaar ', 'suno '];
      const deliveryStems = ['dc', 'delivery charges', 'shipping', 'delivry chargis', 'ghar tak delivery'];
      const inquirySuffixes = ['?', ' kitni?', ' kitni hai', ' ka kya scene hai', ' batao', ' plzzzz'];

      const syntheticDeliveryCases = [];
      for (const prefix of prefixes) {
        for (const stem of deliveryStems) {
          for (const suffix of inquirySuffixes) {
            syntheticDeliveryCases.push(`${prefix}${stem}${suffix}`);
          }
        }
      }

      // Assert that regardless of prefix, typo, repetition, or suffix,
      // all synthetic variations are recognized as delivery inquiries
      for (const synthetic of syntheticDeliveryCases) {
        const norm = MessageNormalizer.normalize(synthetic);
        const disc = SemanticContextResolver.evaluateDiscourse(norm, { activeProduct: mockProductChair });
        const intent = IntentEngine.inferIntent(norm, disc, {}, { activeProduct: mockProductChair });

        expect(
          ['ORDER_DELIVERY_CHARGES', 'DELIVERY_INQUIRY'].includes(intent.intent) ||
          intent.family === IntentFamily.DELIVERY_INQUIRY,
          `Failed to understand synthetic variation: "${synthetic}" (Normalized: "${norm.normalizedMessage}")`
        ).toBe(true);
      }
    });

    it('safely handles noisy transcription errors, missing vowels and repeated letters without crashing', () => {
      const noisyInputs = [
        'plzzzzzzzzzzzzzz btao',
        'soooooch kar btaunga',
        'dcccccccc?',
        'chaer kae leeg covr',
        'kabbbbb ayyega parcel',
        'shippppppppppng kitni'
      ];

      for (const noisy of noisyInputs) {
        const norm = MessageNormalizer.normalize(noisy);
        expect(norm).toHaveProperty('cleanMessage');
        expect(norm).toHaveProperty('normalizedMessage');
        expect(norm.normalizedMessage.length).toBeGreaterThan(0);
        expect(() => {
          const disc = SemanticContextResolver.evaluateDiscourse(norm, {});
          IntentEngine.inferIntent(norm, disc, {}, {});
        }).not.toThrow();
      }
    });
  });
});
