import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';
import { OrderResolver } from '../src/services/orderResolver.js';

describe('Dial Mate 2.0 — Phase 1 Production Execution Path Audit', () => {
  const mockShop = {
    id: 'shop-1',
    domain: 'sundaybazaaar.store',
    name: 'Sunday Bazaaar Official',
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
    description: 'Anti snoring magnetic nasal dilator.'
  };

  const mockProductWaterBrush = {
    id: 'prod-brush-1',
    title: 'Water Bottle Cleaning Brush',
    price: 'Rs. 399',
    formattedPrice: 'Rs. 399',
    numericPrice: 399,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/water-bottle-brush',
    available: true,
    description: 'Long handle water bottle brush.'
  };

  const mockOrder1643 = {
    id: 'order-1643-uuid',
    orderId: 'order-1643-uuid',
    orderNumber: '1643',
    items: 'Wooden Silicone Chair Protection Cover',
    totalAmount: 698,
    shippingFee: 199,
    status: 'In Transit',
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
    vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998', firstName: 'Arslan' });
    vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'cust-1', phone: '+923333255998', firstName: 'Arslan' });
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([mockOrder1643]);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockOrder1643);
    vi.spyOn(prisma.order, 'findUnique').mockResolvedValue(mockOrder1643);

    if (prisma.message) vi.spyOn(prisma.message, 'create').mockResolvedValue({});
    if (prisma.aIInteractionLog) vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // STEP 3: JOURNEYS A THROUGH G (REAL PRODUCTION ENTRY POINT)
  // =========================================================================

  it('JOURNEY A: Full 5-turn continuity on Chair Cover through WhatsAppAgentService', async () => {
    const convId = 'conv-audit-journey-a';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      count: 1
    });

    // Turn 1: "Chair protection cover ka batao"
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-a',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'Chair protection cover ka batao'
    });
    expect(t1.replyText).toContain('Chair Protection Cover');
    expect(t1.replyText).not.toContain('Ji, main samajh gayi hoon');

    // Turn 2: "iski price kya hai"
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-a',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price kya hai'
    });
    expect(t2.replyText).toContain('499');
    expect(t2.replyText).toContain('Chair Protection Cover');

    // Turn 3: "dc?"
    const t3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-a',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'dc?'
    });
    expect(t3.replyText).toContain('199');
    expect(t3.replyText).not.toContain('Ji, main samajh gayi hoon');

    // Turn 4: "total?"
    const t4 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-a',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'total?'
    });
    expect(t4.replyText).toContain('698');

    // Turn 5: "iska link?"
    const t5 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-a',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iska link?'
    });
    expect(t5.replyText).toContain(mockProductChair.url);
  });

  it('JOURNEY B: Context switch between two products (Chair -> Snoring -> "iski price?")', async () => {
    const convId = 'conv-audit-journey-b';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });

    // Turn 1: Chair cover
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValueOnce({
      products: [mockProductChair],
      count: 1
    });
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-b',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover ka batao'
    });

    // Turn 2: Switch to anti snoring
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValueOnce({
      products: [mockProductSnoring],
      count: 1
    });
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-b',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'anti snoring wala dikhao'
    });
    expect(t2.replyText).toContain('Anti Snoring');

    // Turn 3: "iski price?" must resolve to Anti Snoring (Rs. 999), NOT Chair Cover (Rs. 499)!
    const t3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-b',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price?'
    });
    expect(t3.replyText).toContain('999');
    expect(t3.replyText).not.toContain('499');
  });

  it('JOURNEY C: Context switch from Product -> Order ("chair cover" -> "mera order check karo" -> "yeh kab pohanchega?")', async () => {
    const convId = 'conv-audit-journey-c';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });

    // Turn 1: Chair cover inquiry
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValueOnce({
      products: [mockProductChair],
      count: 1
    });
    await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-c',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover ka batao'
    });

    // Turn 2: Switch to order
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-c',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'mera order check karo'
    });
    expect(t2.replyText).toContain('1643');

    // Turn 3: Follow-up on the order: "yeh kab pohanchega?"
    const t3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-c',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'yeh kab pohanchega?'
    });
    expect(t3.replyText).toContain('1643');
    expect(t3.replyText.toLowerCase()).toContain('working days');
    expect(t3.replyText).not.toContain('Rs. 499');
  });

  it('JOURNEY D: Emotional / Casual chitchat ("main upset hun") does NOT search catalog or recommend products', async () => {
    const convId = 'conv-audit-journey-d';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });
    const searchSpy = vi.spyOn(ShopifyCatalogService, 'searchProducts');

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-d',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'main upset hun'
    });

    expect(searchSpy).not.toHaveBeenCalled();
    expect(res.replyText).not.toContain('Rs.');
    expect(res.replyText).not.toContain('https://');
    expect(res.replyText).toContain('upset');
  });

  it('JOURNEY E: Natural Greeting ("hello") returns natural greeting without random product insertion', async () => {
    const convId = 'conv-audit-journey-e';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });
    const searchSpy = vi.spyOn(ShopifyCatalogService, 'searchProducts');

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-e',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'hello'
    });

    expect(searchSpy).not.toHaveBeenCalled();
    expect(res.replyText).not.toContain('Rs. 499');
    expect(res.replyText).not.toContain('Chair Protection Cover');
  });

  it('JOURNEY F: "dc?" with NO product context answers general delivery policy without inventing a product', async () => {
    const convId = 'conv-audit-journey-f';
    const testPhone = '923333255996@s.whatsapp.net';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });

    const res = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-f',
      fromPhone: testPhone,
      messageText: 'dc?'
    });

    expect(res.replyText).toContain('199');
    expect(res.replyText).not.toContain('DC Motor');
    expect(res.replyText).not.toContain('Ji, main samajh gayi hoon');
  });

  it('JOURNEY G: Order check -> "1643" -> "yeh kab pohanchega?" maintains order #1643 continuity', async () => {
    const convId = 'conv-audit-journey-g';
    const testPhone = '923333255995@s.whatsapp.net';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });

    // Turn 1: "mene jo order kiya tha wo check karo"
    vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValueOnce({
      found: false,
      orders: [],
      count: 0
    });
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-g',
      fromPhone: testPhone,
      messageText: 'mene jo order kiya tha wo check karo'
    });
    expect(t1.replyText).toContain('order number');

    // Turn 2: "1643"
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-g',
      fromPhone: testPhone,
      messageText: '1643'
    });
    expect(t2.replyText).toContain('1643');

    // Turn 3: "yeh kab pohanchega?"
    const t3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-g',
      fromPhone: testPhone,
      messageText: 'yeh kab pohanchega?'
    });
    expect(t3.replyText).toContain('1643');
    expect(t3.replyText.toLowerCase()).toContain('working days');
  });

  // =========================================================================
  // STEP 6: MODALITY CONTINUITY (TEXT -> VOICE -> TEXT -> VOICE)
  // =========================================================================
  it('CROSS-MODALITY: Unified conversation state survives text <-> voice alternation seamlessly', async () => {
    const convId = 'conv-audit-modality';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      count: 1
    });

    // 1. Text: "chair protection cover dikhao"
    const r1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-mod',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'chair protection cover dikhao',
      isVoiceInbound: false
    });
    expect(r1.isVoiceResponse).toBe(false);
    expect(r1.replyText).toContain('Chair Protection Cover');

    // 2. Voice: "iski price kya hai"
    const r2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-mod',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'iski price kya hai',
      isVoiceInbound: true
    });
    expect(r2.isVoiceResponse).toBe(true);
    expect(r2.spokenText).toContain('499');

    // 3. Text: "delivery kitni hai?"
    const r3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-mod',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'delivery kitni hai?',
      isVoiceInbound: false
    });
    expect(r3.isVoiceResponse).toBe(false);
    expect(r3.replyText).toContain('199');

    // 4. Voice: "acha total kitna banega?"
    const r4 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-mod',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'acha total kitna banega?',
      isVoiceInbound: true
    });
    expect(r4.isVoiceResponse).toBe(true);
    expect(r4.spokenText).toContain('698');
  });

  // =========================================================================
  // STEP 7: HUMAN ESCALATION CONTINUITY
  // =========================================================================
  it('HUMAN ESCALATION: normal messages continue after human escalation without repeating canned escalation', async () => {
    const convId = 'conv-audit-escalation';
    const testPhone = '923333255994@s.whatsapp.net';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, isEscalated: false, messages: [] });

    // Turn 1: "owner ka number do" -> Triggers escalation
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-esc',
      fromPhone: testPhone,
      messageText: 'owner ka number do'
    });
    expect(t1.action).toBe('request_human_transfer');
    expect(t1.replyText.toLowerCase()).toContain('human support team');

    // Turn 2: Subsequent normal question: "acha chair cover ki price kya hai?"
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      count: 1
    });
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-esc',
      fromPhone: testPhone,
      messageText: 'acha chair cover ki price kya hai?'
    });
    // Zara MUST answer the product price and NOT repeat the canned escalation string
    expect(t2.replyText).toContain('499');
    expect(t2.replyText).not.toContain('Maine aapki request hamari customer support team ko forward kar di');
  });

  // =========================================================================
  // STEP 8: PRODUCT REJECTION LIFECYCLE
  // =========================================================================
  it('PRODUCT REJECTION: rejected product is removed from active context and not re-promoted', async () => {
    const convId = 'conv-audit-rejection';
    const testPhone = '923333255993@s.whatsapp.net';
    vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });

    // Turn 1: "water bottle brush dikhao"
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValueOnce({
      products: [mockProductWaterBrush],
      count: 1
    });
    const t1 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-rej',
      fromPhone: testPhone,
      messageText: 'water bottle brush dikhao'
    });
    expect(t1.replyText).toContain('Water Bottle');

    // Turn 2: "nahi chahiye"
    const t2 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-rej',
      fromPhone: testPhone,
      messageText: 'nahi chahiye'
    });
    expect(t2.action).toBe('product_rejected');

    // Turn 3: "delivery charges?"
    const t3 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-rej',
      fromPhone: testPhone,
      messageText: 'delivery charges?'
    });
    // Must NOT insert the rejected Water Bottle Brush into the response
    expect(t3.replyText).not.toContain('Water Bottle Cleaning Brush');
    expect(t3.replyText).toContain('199');

    // Turn 4: "acha chair cover dikhao"
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValueOnce({
      products: [mockProductChair],
      count: 1
    });
    const t4 = await WhatsAppAgentService.handleIncomingMessage({
      shopId: mockShop.id,
      sessionId: 'sess-rej',
      fromPhone: '923333255998@s.whatsapp.net',
      messageText: 'acha chair cover dikhao'
    });
    expect(t4.replyText).toContain('Chair Protection Cover');
    expect(t4.replyText).not.toContain('Water Bottle Cleaning Brush');
  });
});
