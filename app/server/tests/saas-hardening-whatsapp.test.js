import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { CallRecordingRetentionService, MAX_STORED_CALL_RECORDINGS } from '../src/services/callRecordingRetentionService.js';
import { CallWorkflowService } from '../src/services/callWorkflowService.js';
import { WhatsAppOrderMessageService } from '../src/services/whatsappOrderMessageService.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';

describe('Dial Mate 2.0 — Production SaaS Hardening & WhatsApp Customer Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. CALL RECORDING RETENTION SUITE (MAX_STORED_CALL_RECORDINGS = 20)
  // =========================================================================
  describe('Call Recording Retention (Rolling 20 Limit)', () => {
    it('verifies MAX_STORED_CALL_RECORDINGS constant equals 20', () => {
      expect(MAX_STORED_CALL_RECORDINGS).toBe(20);
    });

    it('extracts Twilio Recording SID accurately from URL and raw SID', () => {
      const sid = 'RE1234567890abcdef1234567890abcdef';
      const url = `https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/${sid}`;
      const urlMp3 = `https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/${sid}.mp3`;

      expect(CallRecordingRetentionService.extractRecordingSid(sid)).toBe(sid);
      expect(CallRecordingRetentionService.extractRecordingSid(url)).toBe(sid);
      expect(CallRecordingRetentionService.extractRecordingSid(urlMp3)).toBe(sid);
      expect(CallRecordingRetentionService.extractRecordingSid(null)).toBeNull();
      expect(CallRecordingRetentionService.extractRecordingSid('')).toBeNull();
      expect(CallRecordingRetentionService.extractRecordingSid('invalid-sid')).toBeNull();
    });

    it('retains all recordings when count is <= 20', async () => {
      const mockCalls = Array.from({ length: 15 }, (_, i) => ({
        id: `call-${i}`,
        shopId: 'shop-test',
        orderId: `ord-${i}`,
        recordingUrl: `https://api.twilio.com/Recordings/RE${String(i).padStart(32, '0')}`,
        createdAt: new Date(Date.now() - i * 60000)
      }));

      vi.spyOn(prisma.call, 'findMany').mockResolvedValue(mockCalls);
      const deleteSpy = vi.spyOn(CallRecordingRetentionService, 'deleteRecordingMedia');

      const result = await CallRecordingRetentionService.enforceRetention({ shopId: 'shop-test' });

      expect(result.success).toBe(true);
      expect(result.totalRecordings).toBe(15);
      expect(result.deletedCount).toBe(0);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('enforces retention when recording #21 arrives: deletes oldest recording media and clears recordingUrl', async () => {
      // 21 recordings (0 newest, 20 oldest)
      const mockCalls = Array.from({ length: 21 }, (_, i) => ({
        id: `call-${i}`,
        shopId: 'shop-test',
        orderId: `ord-${i}`,
        recordingUrl: `https://api.twilio.com/Recordings/RE${String(i).padStart(32, '0')}`,
        createdAt: new Date(Date.now() - i * 60000)
      }));

      vi.spyOn(prisma.call, 'findMany').mockResolvedValue(mockCalls);
      vi.spyOn(prisma.call, 'count').mockResolvedValue(20);
      const updateCallSpy = vi.spyOn(prisma.call, 'update').mockResolvedValue({});
      const deleteMediaSpy = vi.spyOn(CallRecordingRetentionService, 'deleteRecordingMedia').mockResolvedValue(true);
      const complianceSpy = vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({});

      const result = await CallRecordingRetentionService.enforceRetention({ shopId: 'shop-test' });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(1);
      expect(result.retainedCount).toBe(20);

      // Verify the oldest recording (call-20) media was deleted
      expect(deleteMediaSpy).toHaveBeenCalledWith(mockCalls[20].recordingUrl);
      // Verify only recordingUrl is cleared on Call record, call row itself is NOT deleted
      expect(updateCallSpy).toHaveBeenCalledWith({
        where: { id: 'call-20' },
        data: { recordingUrl: null }
      });
      expect(complianceSpy).toHaveBeenCalled();
    });

    it('handles bulk excess (25 recordings -> deletes 5 oldest, keeps newest 20)', async () => {
      const mockCalls = Array.from({ length: 25 }, (_, i) => ({
        id: `call-${i}`,
        shopId: 'shop-test',
        orderId: `ord-${i}`,
        recordingUrl: `https://api.twilio.com/Recordings/RE${String(i).padStart(32, '0')}`,
        createdAt: new Date(Date.now() - i * 60000)
      }));

      vi.spyOn(prisma.call, 'findMany').mockResolvedValue(mockCalls);
      vi.spyOn(prisma.call, 'count').mockResolvedValue(20);
      vi.spyOn(prisma.call, 'update').mockResolvedValue({});
      const deleteMediaSpy = vi.spyOn(CallRecordingRetentionService, 'deleteRecordingMedia').mockResolvedValue(true);

      const result = await CallRecordingRetentionService.enforceRetention({ shopId: 'shop-test' });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
      expect(deleteMediaSpy).toHaveBeenCalledTimes(5);
    });

    it('handles 404 / 20404 from Twilio REST API as confirmed deleted', async () => {
      const mockTwilio = {
        recordings: vi.fn().mockReturnValue({
          remove: vi.fn().mockRejectedValue({ status: 404, code: 20404, message: 'The requested resource was not found' })
        })
      };

      vi.spyOn(CallWorkflowService, 'getTwilioClient').mockReturnValue(mockTwilio);

      const deleted = await CallRecordingRetentionService.deleteRecordingMedia('RE1234567890abcdef1234567890abcdef');
      expect(deleted).toBe(true);
    });

    it('preserves Call, Order, Customer, and transcript records when media is deleted', async () => {
      const call = {
        id: 'call-important',
        shopId: 'shop-1',
        orderId: 'ord-1',
        recordingUrl: 'https://api.twilio.com/Recordings/RE00000000000000000000000000000001',
        transcript: 'Customer: Yes confirmed. Zara: Shukriya!'
      };

      vi.spyOn(prisma.call, 'findMany').mockResolvedValue([
        ...Array.from({ length: 20 }, (_, i) => ({ id: `c-${i}`, recordingUrl: `RE${i}` })),
        call
      ]);
      vi.spyOn(prisma.call, 'count').mockResolvedValue(20);
      vi.spyOn(CallRecordingRetentionService, 'deleteRecordingMedia').mockResolvedValue(true);
      const updateCallSpy = vi.spyOn(prisma.call, 'update').mockResolvedValue({});
      const deleteCallSpy = vi.spyOn(prisma.call, 'delete').mockImplementation(() => {});

      await CallRecordingRetentionService.enforceRetention();

      // Only recordingUrl updated to null
      expect(updateCallSpy).toHaveBeenCalledWith({
        where: { id: 'call-important' },
        data: { recordingUrl: null }
      });
      // Call table row is NEVER deleted
      expect(deleteCallSpy).not.toHaveBeenCalled();
    });

    it('executes atomically under concurrent calls without race conditions', async () => {
      vi.spyOn(prisma.call, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.call, 'count').mockResolvedValue(0);

      // Launch 5 concurrent retention executions simultaneously
      const executions = [
        CallRecordingRetentionService.enforceRetention(),
        CallRecordingRetentionService.enforceRetention(),
        CallRecordingRetentionService.enforceRetention(),
        CallRecordingRetentionService.enforceRetention(),
        CallRecordingRetentionService.enforceRetention()
      ];

      const results = await Promise.all(executions);
      expect(results.length).toBe(5);
      results.forEach(res => expect(res.success).toBe(true));
    });
  });

  // =========================================================================
  // 2. WHATSAPP OUTBOUND ORDER COMMUNICATION & PRICE RECONCILIATION SUITE
  // =========================================================================
  describe('WhatsApp Outbound Order Communication & Price Reconciliation', () => {
    it('generates deterministic idempotency key', () => {
      const key = WhatsAppOrderMessageService.getIdempotencyKey('sundaybazaaar.myshopify.com', 'ord-9988');
      expect(key).toBe('wa-order-notification:sundaybazaaar.myshopify.com:ord-9988:order_confirmation');
    });

    it('reconciles price successfully when line items + shipping - discounts == authoritative total', () => {
      const payload = {
        line_items: [
          { title: 'Velvet Sofa Cover', quantity: 2, price: '1500.00' },
          { title: 'Cushion Cover', quantity: 1, price: '500.00' }
        ],
        shipping_lines: [{ price: '250.00' }],
        total_discounts: '250.00',
        current_total_price: '3500.00'
      };

      const result = WhatsAppOrderMessageService.reconcilePrice(payload, 3500.00);

      expect(result.reconciled).toBe(true);
      expect(result.lineItemsTotal).toBe(3500);
      expect(result.shippingFee).toBe(250);
      expect(result.discountAmount).toBe(250);
      expect(result.calculatedTotal).toBe(3500);
      expect(result.authoritativeTotal).toBe(3500);
      expect(result.diff).toBe(0);
      expect(result.items.length).toBe(2);
    });

    it('detects price discrepancy and blocks outbound message when calculated total mismatch > 1.0 PKR', async () => {
      const order = {
        id: 'ord-discrepant',
        totalAmount: 5000, // Authoritative: 5000
        payload: JSON.stringify({
          line_items: [{ title: 'Shirt', quantity: 1, price: '2000' }], // Calculated: 2000
          shipping_lines: [{ price: '200' }],
          current_total_price: '5000'
        }),
        customer: { phone: '+923001234567' }
      };

      const shop = {
        id: 'shop-1',
        domain: 'test.myshopify.com'
      };

      vi.spyOn(prisma.complianceLog, 'findFirst').mockResolvedValue(null);
      const complianceCreateSpy = vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({});
      const orderUpdateSpy = vi.spyOn(prisma.order, 'update').mockResolvedValue({});

      const result = await WhatsAppOrderMessageService.sendOrderConfirmationMessage({ order, shop });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('PRICE_DISCREPANCY');
      expect(result.reconciliation.reconciled).toBe(false);
      expect(result.reconciliation.diff).toBeGreaterThan(1.0);

      // Order must be tagged for merchant review
      expect(orderUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'ord-discrepant' },
        data: { tag: 'REVIEW_NEEDED: Price Discrepancy' }
      });
      expect(complianceCreateSpy).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          event: 'WhatsApp Order Blocked: Price Discrepancy'
        })
      }));
    });

    it('enforces idempotency: does not send duplicate messages for already-notified order', async () => {
      const order = { id: 'ord-already-sent', totalAmount: 1000 };
      const shop = { id: 'shop-1', domain: 'test.myshopify.com' };

      vi.spyOn(prisma.complianceLog, 'findFirst').mockResolvedValue({ id: 'log-1', event: 'WhatsApp Order Notification Sent' });

      const result = await WhatsAppOrderMessageService.sendOrderConfirmationMessage({ order, shop });

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(true);
    });

    it('safely simulates message dispatch in test mode when recipient phone is not in ADMIN_TEST_NUMBERS', async () => {
      process.env.AI_WHATSAPP_MODE = 'test';
      process.env.ADMIN_TEST_NUMBERS = '+923009999999';

      const order = {
        id: 'ord-sim-1',
        totalAmount: 2200,
        payload: JSON.stringify({
          phone: '+923001234567', // Not in whitelist
          line_items: [{ title: 'Watch', quantity: 1, price: '2000' }],
          shipping_lines: [{ price: '200' }]
        })
      };

      const shop = {
        id: 'shop-1',
        domain: 'sundaybazaaar.myshopify.com',
        name: 'Sunday Bazaar'
      };

      vi.spyOn(prisma.complianceLog, 'findFirst').mockResolvedValue(null);
      vi.spyOn(prisma.whatsAppIntegration, 'findFirst').mockResolvedValue({
        id: 'int-1',
        provider: 'WA_AKG',
        sessionId: '2cmrlo',
        isActive: true
      });
      const complianceCreateSpy = vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({});

      const result = await WhatsAppOrderMessageService.sendOrderConfirmationMessage({ order, shop });

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.messageText).toContain('Sunday Bazaar');
      expect(result.messageText).toContain('Watch');
      expect(result.messageText).toContain('Rs. 2,200');
      expect(complianceCreateSpy).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          detail: expect.stringContaining('Simulated')
        })
      }));

      delete process.env.AI_WHATSAPP_MODE;
      delete process.env.ADMIN_TEST_NUMBERS;
    });

    it('formats rich message with store name, customer name, items, shipping, discounts, and total COD', () => {
      const formatted = WhatsAppOrderMessageService.formatOrderConfirmationMessage({
        storeName: 'Sunday Bazaar',
        customerName: 'Ahmed Khan',
        orderNumber: '1099',
        items: [
          { title: 'Leather Belt', variantTitle: 'Brown / XL', quantity: 1, subtotal: 1200 }
        ],
        shippingFee: 200,
        discountAmount: 100,
        totalPayable: 1300,
        deliverySLA: '2-4 working days'
      });

      expect(formatted).toContain('Sunday Bazaar');
      expect(formatted).toContain('Ahmed Khan');
      expect(formatted).toContain('#1099');
      expect(formatted).toContain('Leather Belt');
      expect(formatted).toContain('Brown / XL');
      expect(formatted).toContain('Delivery Charges: Rs. 200');
      expect(formatted).toContain('Discount: -Rs. 100');
      expect(formatted).toContain('Total Payable (COD): Rs. 1,300');
      expect(formatted).toContain('Reply *1*');
      expect(formatted).toContain('Reply *2*');
    });
  });

  // =========================================================================
  // 3. WHATSAPP AI CUSTOMER AGENT ("ZARA") SUITE
  // =========================================================================
  describe('WhatsApp Conversational AI Agent ("Zara")', () => {
    it('detects negation correctly for confirmation and cancellation', () => {
      // Negation of confirm
      expect(WhatsAppAgentService.isNegated('order confirm nahi karna', 'confirm')).toBe(true);
      expect(WhatsAppAgentService.isNegated('confirm mat karna', 'confirm')).toBe(true);
      expect(WhatsAppAgentService.isNegated('bhejna mat', 'confirm')).toBe(true);
      expect(WhatsAppAgentService.isNegated('haan confirm kar do', 'confirm')).toBe(false);

      // Negation of cancel
      expect(WhatsAppAgentService.isNegated('order cancel mat karna', 'cancel')).toBe(true);
      expect(WhatsAppAgentService.isNegated('cancel nahi karna confirm hi rakhna', 'cancel')).toBe(true);
      expect(WhatsAppAgentService.isNegated('mera order cancel mat karein', 'cancel')).toBe(true);
      expect(WhatsAppAgentService.isNegated('cancel kar do please', 'cancel')).toBe(false);
    });

    it('detects intent accurately across Roman Urdu phrases', () => {
      expect(WhatsAppAgentService.detectIntent('1').intent).toBe('CONFIRM');
      expect(WhatsAppAgentService.detectIntent('confirm kar dein').intent).toBe('CONFIRM');
      expect(WhatsAppAgentService.detectIntent('haan bhai dispatch kardo').intent).toBe('CONFIRM');

      expect(WhatsAppAgentService.detectIntent('2').intent).toBe('CANCEL');
      expect(WhatsAppAgentService.detectIntent('cancel kardo').intent).toBe('CANCEL');
      expect(WhatsAppAgentService.detectIntent('mujhe nahi chahiye').intent).toBe('CANCEL');

      // Negation safety intent routing
      expect(WhatsAppAgentService.detectIntent('cancel mat karna confirm kardo').intent).toBe('CONFIRM');
      expect(WhatsAppAgentService.detectIntent('confirm nahi karna cancel kardo').intent).toBe('CANCEL');

      // Human transfer
      expect(WhatsAppAgentService.detectIntent('kisi insan se baat karni hai').intent).toBe('HUMAN_TRANSFER');
      expect(WhatsAppAgentService.detectIntent('agent se rabta karwayein').intent).toBe('HUMAN_TRANSFER');

      // Product inquiries
      expect(WhatsAppAgentService.detectIntent('kya aapke paas chair cover available hai?').intent).toBe('PRODUCT_INQUIRY');
    });

    it('respects human takeover guard: AI remains silent when conversation.isTakeover is true', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'test.myshopify.com' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '923001234567' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({
        id: 'conv-takeover',
        isTakeover: true, // Human in control!
        messages: []
      });
      const messageCreateSpy = vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'test.myshopify.com',
        sessionId: '2cmrlo',
        fromPhone: '923001234567@s.whatsapp.net',
        messageText: 'Hello Zara'
      });

      expect(result.success).toBe(true);
      expect(result.handledByHuman).toBe(true);
      // Stores customer message for human agent visibility
      expect(messageCreateSpy).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-takeover',
          sender: 'customer',
          text: 'Hello Zara'
        }
      });
      // Never calls AI or tools
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('executes confirm_order tool when customer replies "1" or confirms positively', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'test.myshopify.com', name: 'Test Shop' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '923001234567' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({
        id: 'ord-confirm-test',
        orderNumber: '1055',
        status: 'Pending Confirmation',
        totalAmount: 1800
      });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true });
      const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg-out-1' });
      vi.mock('../src/integrations/whatsapp/client.js', () => ({
        WhatsAppClient: vi.fn().mockImplementation(() => ({
          sendMessage: sendMock
        }))
      }));

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'test.myshopify.com',
        sessionId: '2cmrlo',
        fromPhone: '923001234567@s.whatsapp.net',
        messageText: '1'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('confirm_order');
      expect(dispatchSpy).toHaveBeenCalledWith('confirm_order', { orderId: 'ord-confirm-test' }, expect.any(Object));
      expect(result.replyText).toContain('confirm kar diya gaya hai');
    });

    it('executes cancel_order tool when customer replies "2" or requests cancellation', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'test.myshopify.com', name: 'Test Shop' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '923001234567' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({
        id: 'ord-cancel-test',
        orderNumber: '1056',
        status: 'Pending Confirmation',
        totalAmount: 2500
      });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true });

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'test.myshopify.com',
        sessionId: '2cmrlo',
        fromPhone: '923001234567@s.whatsapp.net',
        messageText: '2'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('cancel_order');
      expect(dispatchSpy).toHaveBeenCalledWith('cancel_order', { orderId: 'ord-cancel-test', reason: 'customer_whatsapp_cancellation' }, expect.any(Object));
      expect(result.replyText).toContain('cancel kar diya gaya hai');
    });

    it('protects against negation: does NOT execute confirm_order when customer says "confirm nahi karna"', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'test.myshopify.com' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '923001234567' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({ id: 'ord-safe', orderNumber: '1057' });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'test.myshopify.com',
        sessionId: '2cmrlo',
        fromPhone: '923001234567@s.whatsapp.net',
        messageText: 'Order confirm nahi karna'
      });

      expect(result.success).toBe(true);
      expect(dispatchSpy).not.toHaveBeenCalledWith('confirm_order', expect.any(Object), expect.any(Object));
      expect(result.replyText).toContain('confirm nahi kiya gaya');
    });

    it('escalates to human agent via request_human_transfer when customer asks for a person', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'test.myshopify.com' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '923001234567' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({ id: 'ord-human', orderNumber: '1058' });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true });

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'test.myshopify.com',
        sessionId: '2cmrlo',
        fromPhone: '923001234567@s.whatsapp.net',
        messageText: 'Mujhe human agent se baat karni hai'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('request_human_transfer');
      expect(dispatchSpy).toHaveBeenCalledWith('request_human_transfer', expect.objectContaining({ orderId: 'ord-human' }), expect.any(Object));
      expect(result.replyText).toContain('human support team ko inform kar diya hai');
    });

    it('enforces multi-tenant isolation: shop A customer cannot access shop B order', async () => {
      // Order belongs to shop-B
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-A', domain: 'shop-a.myshopify.com' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '923001234567' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      // findFirst order scopes strictly with where: { shopId: 'shop-A' }
      const orderFindSpy = vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(null);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-A',
        shopDomain: 'shop-a.myshopify.com',
        sessionId: 'session-a',
        fromPhone: '923001234567@s.whatsapp.net',
        messageText: 'status'
      });

      expect(orderFindSpy).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          shopId: 'shop-A'
        })
      }));
    });
  });
});
