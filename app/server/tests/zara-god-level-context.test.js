import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { OrderResolver } from '../src/services/orderResolver.js';
import { ConversationContextResolver } from '../src/services/conversationContextResolver.js';
import { CheckoutStateMachine } from '../src/services/checkoutStateMachine.js';
import { IntentResolver } from '../src/services/intentResolver.js';

describe('Dial Mate 2.0 — Zara God-Level Contextual Intelligence & Adversarial Regression Suite', () => {
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

  const mockOrder1641 = {
    id: 'order-1641-uuid',
    orderId: 'order-1641-uuid',
    orderNumber: '1641',
    items: 'Wooden Silicone Chair Protection Cover',
    totalAmount: 698,
    shippingFee: 199,
    status: 'Delivered',
    financialStatus: 'Paid',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString()
  };

  const mockOrder1642 = {
    id: 'order-1642-uuid',
    orderId: 'order-1642-uuid',
    orderNumber: '1642',
    items: 'Wooden Silicone Chair Protection Cover',
    totalAmount: 698,
    shippingFee: 199,
    status: 'In Transit',
    financialStatus: 'Pending',
    createdAt: new Date(Date.now() - 86400000).toISOString()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    if (prisma.shop) {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
    }
    if (prisma.customer) {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998', firstName: 'Ali' });
      vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'c-1', phone: '923333255998', firstName: 'Ali' });
    }
    if (prisma.conversation) {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-god-ctx', messages: [] });
      vi.spyOn(prisma.conversation, 'create').mockResolvedValue({ id: 'conv-god-ctx', messages: [] });
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
      buffer: Buffer.from('mock voice ogg'),
      format: 'ogg',
      durationSeconds: 2.5
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // JOURNEY A — PRODUCT -> VOICE PRICE
  // =========================================================================
  it('JOURNEY A: text product inquiry -> voice "iski price kya hai" returns same chair product price in voice', async () => {
    const convId = 'conv-journey-a';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    // Step 1: Text "chair protection cover"
    const res1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });
    expect(res1.success).toBe(true);
    expect(res1.replyText).toContain('Chair Protection Cover');

    // Step 2: Voice "iski price kya hai"
    const res2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price kya hai',
      isVoiceInbound: true
    });
    expect(res2.success).toBe(true);
    expect(res2.isVoiceResponse).toBe(true);
    expect(res2.replyText).toContain('Chair Protection Cover');
    expect(res2.replyText).toContain('499');
  });

  // =========================================================================
  // JOURNEY B — PRODUCT -> VOICE TOTAL
  // =========================================================================
  it('JOURNEY B: text product inquiry -> voice "delivery mila ke total kitna hai" returns chair product total', async () => {
    const convId = 'conv-journey-b';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });

    const resTotal = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'delivery mila ke total kitna hai',
      isVoiceInbound: true
    });
    expect(resTotal.success).toBe(true);
    expect(resTotal.isVoiceResponse).toBe(true);
    expect(resTotal.replyText).toContain('Chair Protection Cover');
    expect(resTotal.replyText).toContain('698'); // 499 + 199
  });

  // =========================================================================
  // JOURNEY C — PRODUCT -> VOICE LINK
  // =========================================================================
  it('JOURNEY C: text product -> voice "iska link bhej do" returns spoken ack and sends WhatsApp companion URL', async () => {
    const convId = 'conv-journey-c';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });

    const sendMsgSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage');

    const resLink = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska link bhej do',
      isVoiceInbound: true
    });
    expect(resLink.success).toBe(true);
    expect(resLink.isVoiceResponse).toBe(true);
    expect(sendMsgSpy).toHaveBeenCalledWith(
      expect.stringContaining('923333255998'),
      expect.stringContaining(mockProductChair.url)
    );
  });

  // =========================================================================
  // JOURNEY D — PRODUCT -> CONFIRM (Checkout State Machine)
  // =========================================================================
  it('JOURNEY D: active chair product -> voice "mera order confirm kar do" initiates checkout for chair product without generic search', async () => {
    const convId = 'conv-journey-d';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });

    const resConfirm = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'mera order confirm kar do',
      isVoiceInbound: true
    });
    expect(resConfirm.success).toBe(true);
    expect(resConfirm.replyText).toContain('Chair Protection Cover');
    expect(resConfirm.replyText).toContain('499');
    expect(resConfirm.replyText).toContain('199');
    expect(resConfirm.replyText).toContain('698');
    // Requests delivery address
    expect(resConfirm.replyText.toLowerCase()).toContain('address');
  });

  // =========================================================================
  // JOURNEY E — RANDOM NUMBER "123" NEVER MAPS TO #1643
  // =========================================================================
  it('JOURNEY E: customer says "123" -> strictly exact match fails and NEVER fuzzy-maps to order #1643', async () => {
    const convId = 'conv-journey-e';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    // Simulate order 1643 existing in DB, but exact 123 does not exist
    vi.spyOn(WhatsAppAgentService, 'resolveOrderByNumber').mockImplementation(async (shopId, num) => {
      if (num === '1643') return mockOrder1643;
      return null;
    });

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: '123'
    });
    expect(res.success).toBe(true);
    expect(res.replyText).not.toContain('1643');
    expect(res.replyText).not.toContain('Magnetic Nasal Dilator');
    expect(res.replyText).toContain('123');
    expect(res.replyText).toMatch(/nahi\s*mil/i);
  });

  // =========================================================================
  // JOURNEY F — EXACT ORDER MATCHING (#1643, 1643, order 1643)
  // =========================================================================
  it('JOURNEY F: exact order variants "1643", "#1643", "order 1643" resolve exact order #1643', async () => {
    const convId = 'conv-journey-f';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(WhatsAppAgentService, 'resolveOrderByNumber').mockResolvedValue(mockOrder1643);

    const variants = ['1643', '#1643', 'order 1643', 'mera order 1643'];
    for (const v of variants) {
      const detected = IntentResolver.resolveIntent(v, {}, {});
      expect(detected.intent).toBe('ORDER_NUMBER_INPUT');
      expect(detected.orderNumber).toBe('1643');

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: v
      });
      expect(res.success).toBe(true);
      expect(res.replyText).toContain('1643');
      expect(res.replyText.toLowerCase()).toContain('dispatch');
    }
  });

  // =========================================================================
  // JOURNEY G — ORDER WITHOUT NUMBER ("kal mene chair protection cover order kiya tha")
  // =========================================================================
  it('JOURNEY G: "kal mene aik chair protection cover order kiya tha" searches orders, NOT catalog', async () => {
    const convId = 'conv-journey-g';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    const catalogSpy = vi.spyOn(ShopifyCatalogService, 'searchProducts');

    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1643]);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'kal mene aik chair protection cover order kiya tha uska order number mujhe yad nahi araha'
    });

    expect(res.success).toBe(true);
    expect(catalogSpy).not.toHaveBeenCalled();
    expect(res.replyText).toContain('1643');
  });

  // =========================================================================
  // JOURNEY H — CUSTOMER DETAILS DIRECTORY LOOKUP NEVER DUMPS CATALOG
  // =========================================================================
  it('JOURNEY H: "mera name Ali hy aur address karachi hy apne directory main check karo mere details se jo order hy uska status btao" never returns Bath Brush catalog item', async () => {
    const convId = 'conv-journey-h';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    const catalogSpy = vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductBathBrush],
      totalFound: 1
    });

    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1643]);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'mera name Ali hy aur address karachi hy apne directory main check karo mere details se jo order hy uska status btao'
    });

    expect(res.success).toBe(true);
    expect(catalogSpy).not.toHaveBeenCalled();
    expect(res.replyText).not.toContain('Bath Brush');
    expect(res.replyText).toContain('1643');
  });

  // =========================================================================
  // JOURNEY I — MULTIPLE ORDERS CLARIFICATION
  // =========================================================================
  it('JOURNEY I: customer has two chair cover orders -> "chair cover wala order" asks for clarification instead of guessing', async () => {
    const convId = 'conv-journey-i';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1642, mockOrder1641]);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair cover wala order check karo'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('1642');
    expect(res.replyText).toContain('1641');
    expect(res.replyText).toContain('kis');
  });

  // =========================================================================
  // JOURNEY J — ORDER STATUS LOOKUP
  // =========================================================================
  it('JOURNEY J: "mera order kahan pohcha" triggers grounded order status lookup', async () => {
    const convId = 'conv-journey-j';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1643]);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'mera order kahan pohcha'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('1643');
    expect(res.replyText.toLowerCase()).toContain('dispatch');
  });

  // =========================================================================
  // JOURNEY K — PRODUCT PRICE
  // =========================================================================
  it('JOURNEY K: "chair protection cover ki price?" returns product price', async () => {
    const convId = 'conv-journey-k';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover ki price?'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('Chair Protection Cover');
    expect(res.replyText).toContain('499');
  });

  // =========================================================================
  // JOURNEY L — ORDER PRICE / TOTAL
  // =========================================================================
  it('JOURNEY L: "order 1643 ka total?" resolves exact order total', async () => {
    const convId = 'conv-journey-l';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(WhatsAppAgentService, 'resolveOrderByNumber').mockResolvedValue(mockOrder1643);

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'order 1643 ka total kitna hai?'
    });

    expect(res.success).toBe(true);
    expect(res.replyText).toContain('1643');
    expect(res.replyText).toContain('698');
  });

  // =========================================================================
  // JOURNEY M — PRONOUN CONTINUITY
  // =========================================================================
  it('JOURNEY M: "chair protection cover" -> "iska link" -> "iski price" -> "iska total" maintains same entity', async () => {
    const convId = 'conv-journey-m';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    // 1. Text inquiry
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });

    // 2. Pronoun link
    const rLink = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska link'
    });
    expect(rLink.replyText).toContain(mockProductChair.url);

    // 3. Pronoun price
    const rPrice = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price'
    });
    expect(rPrice.replyText).toContain('499');

    // 4. Pronoun total
    const rTotal = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska total'
    });
    expect(rTotal.replyText).toContain('698');
  });

  // =========================================================================
  // JOURNEY N — TOPIC INTERRUPTION SURVIVAL
  // =========================================================================
  it('JOURNEY N: product inquiry -> chitchat topic interruption -> "iski price kya hai" remembers chair product', async () => {
    const convId = 'conv-journey-n';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    // 1. Product discussion
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover dikhao'
    });

    // 2. Casual interruption
    const rChit = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'yr meri girlfriend naraz hai'
    });
    expect(rChit.replyText).toContain('girlfriend');

    // 3. Pronoun question refers back to chair cover
    const rPrice = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price kya hai'
    });
    expect(rPrice.replyText).toContain('Chair Protection Cover');
    expect(rPrice.replyText).toContain('499');
  });

  // =========================================================================
  // JOURNEY O — NEGATION SAFETY
  // =========================================================================
  it('JOURNEY O: negation phrases "confirm nahi karna", "cancel nahi karna" do not trigger confirmation or cancellation', () => {
    const neg1 = IntentResolver.resolveIntent('confirm nahi karna', {}, {});
    expect(neg1.intent).toBe('CONFIRM_NEGATED');

    const neg2 = IntentResolver.resolveIntent('abhi confirm nahi karna', {}, {});
    expect(neg2.intent).toBe('CONFIRM_NEGATED');

    const neg3 = IntentResolver.resolveIntent('cancel nahi karna order', {}, {});
    expect(neg3.intent).toBe('CANCEL_NEGATED');

    const neg4 = IntentResolver.resolveIntent('order cancel mat karna', {}, {});
    expect(neg4.intent).toBe('CANCEL_NEGATED');
  });

  // =========================================================================
  // JOURNEY P — HESITATION SAFETY
  // =========================================================================
  it('JOURNEY P: hesitation phrases "shayad confirm karun", "soch kar batata hoon" do not confirm orders', () => {
    const hes1 = IntentResolver.resolveIntent('shayad confirm karun', {}, {});
    expect(hes1.intent).not.toBe('CONFIRM');

    const hes2 = IntentResolver.resolveIntent('soch kar batata hoon', {}, {});
    expect(hes2.intent).not.toBe('CONFIRM');

    const hes3 = IntentResolver.resolveIntent('baad mein karunga abhi nahi', {}, {});
    expect(hes3.intent).not.toBe('CONFIRM');
  });

  // =========================================================================
  // JOURNEY Q — EXPLICIT CONFIRMATION
  // =========================================================================
  it('JOURNEY Q: "haan yehi chair wala order confirm kar do" triggers confirmation flow', () => {
    const det = IntentResolver.resolveIntent('haan yehi chair wala order confirm kar do', {}, {});
    expect(det.intent).toBe('CONFIRM');
  });

  // =========================================================================
  // JOURNEY R — CANCELLATION SAFETY
  // =========================================================================
  it('JOURNEY R: "chair wala order cancel kar do" targets chair order, not arbitrary orders', async () => {
    const convId = 'conv-journey-r';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1643]);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);

    const det = IntentResolver.resolveIntent('chair wala order cancel kar do', {}, {});
    expect(det.intent).toBe('CANCEL');

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair wala order cancel kar do'
    });
    expect(res.success).toBe(true);
    expect(res.replyText).toContain('1643');
  });

  // =========================================================================
  // JOURNEY S — WRONG PRODUCT PROTECTION
  // =========================================================================
  it('JOURNEY S: active product = chair cover -> voice "iski price" NEVER returns Bath Brush or Nasal Dilator', async () => {
    const convId = 'conv-journey-s';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    const catalogSpy = vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });

    catalogSpy.mockClear();

    const resVoice = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price',
      isVoiceInbound: true
    });

    expect(catalogSpy).not.toHaveBeenCalled();
    expect(resVoice.replyText).toContain('Chair Protection Cover');
    expect(resVoice.replyText).not.toContain('Bath Brush');
    expect(resVoice.replyText).not.toContain('Nasal Dilator');
  });

  // =========================================================================
  // JOURNEY T — SEAMLESS VOICE/TEXT MODALITY SWITCHING
  // =========================================================================
  it('JOURNEY T: text product -> voice price -> text delivery -> voice total -> text link retains 100% entity continuity', async () => {
    const convId = 'conv-journey-t';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      totalFound: 1
    });

    // 1. Text product
    const r1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover'
    });
    expect(r1.replyText).toContain('Chair Protection Cover');

    // 2. Voice price
    const r2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price kya hai',
      isVoiceInbound: true
    });
    expect(r2.isVoiceResponse).toBe(true);
    expect(r2.replyText).toContain('499');

    // 3. Text delivery
    const r3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'delivery?'
    });
    expect(r3.isVoiceResponse).not.toBe(true);
    expect(r3.replyText).toContain('199');

    // 4. Voice total
    const r4 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'delivery mila k total kitna?',
      isVoiceInbound: true
    });
    expect(r4.isVoiceResponse).toBe(true);
    expect(r4.replyText).toContain('698');

    // 5. Text link
    const r5 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: 'shop-1',
      shopDomain: 'sundaybazaaar.store',
      sessionId: '2cmrlo',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska link'
    });
    expect(r5.isVoiceResponse).not.toBe(true);
    expect(r5.replyText).toContain(mockProductChair.url);
  });

  // =========================================================================
  // REALISTIC PAKISTANI LANGUAGE MATRIX TESTS
  // =========================================================================
  it('LANGUAGE MATRIX: accurately resolves realistic Pakistani Roman Urdu and English phrases', () => {
    const matrix = [
      { text: 'iski price kya hai', intent: 'PRODUCT_DETAIL' },
      { text: 'iska rate?', intent: 'PRODUCT_DETAIL' },
      { text: 'ye kitne ka hai', intent: 'PRODUCT_DETAIL' },
      { text: 'yeh kitnay ka paray ga', intent: 'PRODUCT_DETAIL' },
      { text: 'iska total?', intent: 'TOTAL_INQUIRY' },
      { text: 'delivery kitni hai', intent: 'DELIVERY_INQUIRY' },
      { text: 'delivery mila k kitna?', intent: 'TOTAL_INQUIRY' },
      { text: 'link bhejo', intent: 'PRODUCT_LINK' },
      { text: 'iska link', intent: 'PRODUCT_LINK' },
      { text: 'ye wala confirm karo', intent: 'CONFIRM' },
      { text: 'mera order confirm krdo', intent: 'CONFIRM' },
      { text: 'cnfrm krdo', intent: 'CONFIRM' },
      { text: 'mera order kidhar pohancha', intent: 'ORDER_STATUS' },
      { text: 'mera parcel kahan hai', intent: 'ORDER_STATUS' },
      { text: 'kal wala order', intent: 'ORDER_SUMMARY' },
      { text: 'jo order mene kal kiya tha', intent: 'ORDER_SUMMARY' },
      { text: 'mere number se check karo', intent: 'ORDER_LOOKUP_BY_DETAILS' },
      { text: 'meri details se check karo', intent: 'ORDER_LOOKUP_BY_DETAILS' },
      { text: 'order number yad nahi', intent: 'ORDER_SUMMARY' },
      { text: 'order no yaad nahi', intent: 'ORDER_SUMMARY' },
      { text: '123', intent: 'ORDER_NUMBER_INPUT' },
      { text: '#1643', intent: 'ORDER_NUMBER_INPUT' },
      { text: '1643 wala', intent: 'ORDER_NUMBER_INPUT' },
      { text: 'haan yehi', intent: 'CONFIRM' },
      { text: 'nahi ye nahi chahiye', intent: 'PRODUCT_REJECTION' },
      { text: 'rehne do', intent: 'PRODUCT_REJECTION' },
      { text: 'cancel nahi karna', intent: 'CANCEL_NEGATED' },
      { text: 'confirm nahi karna', intent: 'CONFIRM_NEGATED' },
      { text: 'delivery included hai?', intent: 'DELIVERY_INQUIRY' },
      { text: 'total with delivery?', intent: 'TOTAL_INQUIRY' },
      { text: 'please mera order confirm kar do', intent: 'CONFIRM' },
      { text: 'can you check my last order?', intent: 'ORDER_SUMMARY' },
      { text: 'mera previous order check karo', intent: 'ORDER_LOOKUP_BY_DETAILS' }
    ];

    for (const item of matrix) {
      const resolved = IntentResolver.resolveIntent(item.text, {}, {});
      if (item.intent === 'TOTAL_INQUIRY') {
        expect(['TOTAL_INQUIRY', 'ORDER_TOTAL']).toContain(resolved.intent);
      } else if (item.intent === 'DELIVERY_INQUIRY') {
        expect(['DELIVERY_INQUIRY', 'ORDER_DELIVERY_CHARGES']).toContain(resolved.intent);
      } else if (item.text === 'iska link') {
        expect(['PRODUCT_LINK', 'ORDINAL_REFERENCE']).toContain(resolved.intent);
      } else if (item.text === 'mera parcel kahan hai') {
        expect(['ORDER_STATUS', 'ORDER_SUMMARY']).toContain(resolved.intent);
      } else {
        expect(resolved.intent, `Failed for phrase: "${item.text}"`).toBe(item.intent);
      }
    }
  });
});