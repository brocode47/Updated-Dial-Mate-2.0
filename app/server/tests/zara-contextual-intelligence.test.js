import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { HumanEscalationService } from '../src/services/humanEscalationService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { SpokenResponsePlanner } from '../src/services/spokenResponsePlanner.js';
import { ProductSummaryService } from '../src/services/productSummaryService.js';

describe('Dial Mate 2.0 — Zara Contextual Intelligence & Voice Regression Suite', () => {
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
    vi.clearAllMocks();
    if (prisma.shop) {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
    }
    if (prisma.customer) {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998', firstName: 'Ahmed' });
      vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
    }
    if (prisma.conversation) {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-test-ctx', messages: [] });
      vi.spyOn(prisma.conversation, 'create').mockResolvedValue({ id: 'conv-test-ctx', messages: [] });
    }
    if (prisma.message) {
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
    }
    if (prisma.aIInteractionLog) {
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
    }
    if (prisma.order) {
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(null);
      vi.spyOn(prisma.order, 'findMany').mockResolvedValue([]);
    }
    vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'msg-1' });
    vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({ id: 'msg-media-1' });
    vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
      success: true,
      buffer: Buffer.from('RIFF mock wav'),
      format: 'ogg',
      durationSeconds: 3.0
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // TEST 1: Product inquiry -> "please confirm my order" -> confirms same product
  // =========================================================================
  it('TEST 1: anti-snoring inquiry -> "please confirm my order" preserves active product and NEVER searches a different product', async () => {
    const convId = 'conv-test-1';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    const searchSpy = vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductSnoring],
      totalFound: 1
    });

    // Step 1: Customer asks for anti snoring product
    const res1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'Mujhe anti snoring wala product batao'
    });

    expect(res1.success).toBe(true);
    expect(res1.replyText).toContain('Anti Snoring');
    expect(res1.replyText).toContain('Rs. 999');

    const state = await ConversationStateService.getState(convId);
    expect(state.activeProduct).toBeDefined();
    expect(state.activeProduct.title).toContain('Anti Snoring');

    // Reset search spy to verify it is NOT called with "please my" or search for a new product
    searchSpy.mockClear();

    // Step 2: Customer says "please confirm my order"
    const res2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'please confirm my order'
    });

    expect(res2.success).toBe(true);
    expect(res2.replyText).toContain('Anti Snoring');
    expect(res2.replyText).not.toContain('Silicone Chair');
    // Must NOT have searched Shopify for random product
    expect(searchSpy).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TEST 2: Chair inquiry -> "iska link do" -> returns direct chair URL
  // =========================================================================
  it('TEST 2: chair inquiry -> "iska link do" returns direct chair URL without dumping raw descriptions', async () => {
    const convId = 'conv-test-2';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    // Step 1: Inquire chair
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'Mujhe chair protection cover chaiye'
    });

    // Step 2: Customer asks for link
    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska link do'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover');
    // Ensure raw scraped marketing description is not dumped
    expect(res.replyText).not.toContain('Looking for something that protect you flooring');
  });

  // =========================================================================
  // TEST 3: "Mene kal aik order kiya tha" -> ORDER_SUMMARY / order lookup, NOT PRODUCT_SEARCH
  // =========================================================================
  it('TEST 3: "Mene kal aik order kiya tha" resolves to ORDER_SUMMARY / order lookup, NOT PRODUCT_SEARCH', async () => {
    const detected = WhatsAppAgentService.detectIntent('Mene kal aik order kiya tha uski detail batao');
    expect(detected.intent).toBe('ORDER_SUMMARY');
    expect(detected.intent).not.toBe('PRODUCT_INQUIRY');
    expect(detected.intent).not.toBe('PRODUCT_SEARCH');
  });

  // =========================================================================
  // TEST 4: "Mera order kahan pohcha" -> ORDER_STATUS
  // =========================================================================
  it('TEST 4: "Mera order kahan pohcha" maps deterministically to ORDER_STATUS', () => {
    const detected = WhatsAppAgentService.detectIntent('Mera order kahan pohcha');
    expect(detected.intent).toBe('ORDER_STATUS');
  });

  // =========================================================================
  // TEST 5: Standalone "1643" -> ORDER_NUMBER_INPUT and sets activeOrderNumber = 1643
  // =========================================================================
  it('TEST 5: customer input "1643" resolves order #1643 and persists activeOrderNumber', async () => {
    const convId = 'conv-test-5';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(WhatsAppAgentService, 'resolveOrderByNumber').mockResolvedValue(mockOrder1643);

    const detected = WhatsAppAgentService.detectIntent('1643');
    expect(detected.intent).toBe('ORDER_NUMBER_INPUT');
    expect(detected.orderNumber).toBe('1643');

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: '1643'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('#1643');
    expect(res.replyText).toContain('Wooden Silicone Chair Protection Cover');

    const state = await ConversationStateService.getState(convId);
    expect(state.activeOrderNumber).toBe('1643');
  });

  // =========================================================================
  // TEST 6: Order #1643 active -> "nahi mujhe nahi chahiye" -> CANCEL_ORDER
  // =========================================================================
  it('TEST 6: order #1643 active -> "nahi mujhe nahi chahiye" cancels order #1643 (not product rejection)', async () => {
    const convId = 'conv-test-6';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);
    const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true });

    // Seed state with active order #1643
    await ConversationStateService.updateState(convId, {
      activeOrderNumber: '1643',
      activeOrderId: mockOrder1643.id,
      recentTopic: 'order'
    });

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'nahi mujhe nahi chahiye'
    });

    expect(res.success).toBe(true);
    expect(res.action).toBe('cancel_order');
    expect(res.replyText).toContain('#1643');
    expect(res.replyText).toContain('cancel');
    expect(dispatchSpy).toHaveBeenCalledWith('cancel_order', expect.objectContaining({ orderId: mockOrder1643.id }), expect.any(Object));
  });

  // =========================================================================
  // TEST 7: Voice price inquiry -> Text "delivery?" -> preserves active chair product
  // =========================================================================
  it('TEST 7: voice price inquiry followed by text "delivery?" preserves active chair product context', async () => {
    const convId = 'conv-test-7';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    // Voice turn
    const res1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover ki price?',
      isVoiceInbound: true
    });
    expect(res1.success).toBe(true);
    expect(res1.isVoiceResponse).toBe(true);

    // Text follow-up
    const res2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'delivery?'
    });
    expect(res2.success).toBe(true);
    expect(res2.replyText).toContain('Chair Protection Cover');
    expect(res2.replyText).toContain('Rs. 199');
  });

  // =========================================================================
  // TEST 8: Text product inquiry -> Voice "iska link bhejo" -> sends WhatsApp link
  // =========================================================================
  it('TEST 8: text product inquiry -> voice "iska link bhejo" sends companion WhatsApp link', async () => {
    const convId = 'conv-test-8';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });
    const sendMsgSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'txt-link' });

    // Step 1: Text inquiry
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });

    // Step 2: Voice request for link
    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska link bhejo',
      isVoiceInbound: true
    });

    expect(res.success).toBe(true);
    expect(res.isVoiceResponse).toBe(true);
    // Verified companion text link was sent
    expect(sendMsgSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover')
    );
  });

  // =========================================================================
  // TEST 9: Owner Info vs Human Transfer
  // =========================================================================
  it('TEST 9: "tumahra owner ka naam kya hy" is OWNER_INFO (no escalation); "owner se baat karwao" triggers HUMAN_TRANSFER while Zara remains active', async () => {
    // 1. Owner info
    const detOwner = WhatsAppAgentService.detectIntent('tumahra owner ka naam kya hy');
    expect(detOwner.intent).toBe('OWNER_INFO');

    const resOwner = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'tumahra owner ka naam kya hy'
    });
    expect(resOwner.replyText).toContain('Sunday Bazaaar');
    expect(resOwner.handledByHuman).not.toBe(true);

    // 2. Human transfer
    const detTransfer = WhatsAppAgentService.detectIntent('owner se baat karwao');
    expect(detTransfer.intent).toBe('HUMAN_TRANSFER');

    const escSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
      escalated: true,
      alreadyEscalated: false,
      escalationId: 'esc-1'
    });

    const resTransfer = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'owner se baat karwao'
    });

    expect(escSpy).toHaveBeenCalled();
    expect(resTransfer.isTakeover).not.toBe(true);
    expect(resTransfer.replyText).toContain('support team');
  });

  // =========================================================================
  // TEST 10: Product rejection -> future recommendations exclude rejected product
  // =========================================================================
  it('TEST 10: rejected product is stored in state and excluded from future pagination/recommendations', async () => {
    const convId = 'conv-test-10';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });

    // Seed state with active product
    await ConversationStateService.updateState(convId, {
      currentProduct: mockProductChair,
      activeProduct: mockProductChair
    });

    // Customer rejects
    const resReject = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'nahi chahiye'
    });

    expect(resReject.action).toMatch(/product_reject/);
    const state = await ConversationStateService.getState(convId);
    expect(state.rejectedProducts).toBeDefined();
    expect(state.rejectedProducts.some(p => p.title.includes('Chair'))).toBe(true);

    // Later customer asks for more products
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair, mockProductSnoring],
      totalFound: 2
    });

    const resMore = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'aur dikhao'
    });

    expect(resMore.replyText).not.toContain('Wooden Silicone Chair Protection Cover');
    expect(resMore.replyText).toContain('Anti Snoring');
  });

  // =========================================================================
  // TEST 11: "bye" closure -> subsequent message resumes normally
  // =========================================================================
  it('TEST 11: "bye" closes conversation politely but subsequent message resumes normally without being blocked', async () => {
    const convId = 'conv-test-11';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });

    const resBye = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'bye'
    });

    expect(resBye.replyText).toContain('Allah Hafiz');

    // Customer returns later
    const resReturn = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'acha ek baat batao'
    });

    expect(resReturn.success).toBe(true);
    expect(resReturn.replyText.length).toBeGreaterThan(5);
  });

  // =========================================================================
  // REQUIREMENT 23: Voice Regression Tests
  // =========================================================================
  describe('Requirement 23: Voice Flow Regression Tests', () => {
    it('plans clean spoken dialogue for compound price + delivery query without repeating charges', () => {
      const plan = SpokenResponsePlanner.planSpokenResponse({
        textResponse: 'Ji, Wooden Silicone Chair Protection Cover ki price Rs. 499 hai. Delivery charges Rs. 199, kul total Rs. 698 hai.\n\n🔗 https://sundaybazaaar.store/products/chair-cover',
        product: mockProductChair,
        intent: 'PRODUCT_INQUIRY',
        customerMessage: 'Mera chair protection cover ka price batao aur delivery charges bhi batao.'
      });

      expect(plan.spokenScript).toContain('499');
      expect(plan.spokenScript).toContain('199');
      expect(plan.spokenScript).toContain('698');
      expect(plan.spokenScript).not.toContain('http');
      expect(plan.spokenScript).not.toContain('*');
      // No duplicate delivery charge sentences
      const deliveryMentions = (plan.spokenScript.match(/199/g) || []).length;
      expect(deliveryMentions).toBe(1);
    });

    it('sets sendTextLink = true when link requested via voice and avoids reading raw URL aloud', () => {
      const plan = SpokenResponsePlanner.planSpokenResponse({
        textResponse: 'Ji, yeh raha direct link:\n🔗 https://sundaybazaaar.store/products/chair-cover',
        product: mockProductChair,
        intent: 'PRODUCT_LINK',
        customerMessage: 'acha iska link bhejo'
      });

      expect(plan.sendTextLink).toBe(true);
      expect(plan.spokenScript).toContain('WhatsApp');
      expect(plan.spokenScript).not.toContain('https://');
    });
  });
});
