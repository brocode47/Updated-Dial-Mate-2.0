import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallScriptEngine } from '../src/services/callScriptEngine.js';
import { AICallInterpretationService } from '../src/services/aiCallInterpretationService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';
import { tools } from '../src/integrations/ai/tools.js';
import { AudioCodec } from '../src/utils/audioCodec.js';
import { Agent } from '../src/integrations/ai/agent.js';
import { prisma } from '../src/lib/db.js';

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    shop: { findUnique: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
    call: {
      create: vi.fn().mockResolvedValue({ id: 'call-mock-123' }),
      update: vi.fn().mockResolvedValue({ id: 'call-mock-123' }),
      count: vi.fn().mockResolvedValue(0)
    },
    customer: { findUnique: vi.fn() },
    complianceLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) }
  }
}));

vi.mock('../src/lib/queues.js', () => ({
  callQueue: { add: vi.fn().mockResolvedValue({ id: 'job-mock-cb-123' }) },
  whatsappQueue: { add: vi.fn().mockResolvedValue({ id: 'job-mock-wa-123' }) }
}));

describe('AI Conversational Agent ("Zara") - Comprehensive Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. System Prompt & Grounding Tests
  // =========================================================================
  describe('Phase 1-3: Free-form Grounded System Prompt & Rules', () => {
    it('compiles a structured conversational instruction with full factual order grounding', () => {
      const instruction = CallScriptEngine.compileGeminiSystemInstruction({
        agentName: 'Zara',
        shopName: 'Sunday Bazaar',
        customerName: 'Ahmad Khan',
        orderNumber: 'SB-9872',
        productName: 'Wireless Earbuds',
        productPrice: '2800',
        lineItems: [
          { title: 'Wireless Earbuds Pro', variantTitle: 'Black Edition', quantity: 2, price: '1400' }
        ],
        shippingAddress: 'House 42, Street 5, Gulberg III, Lahore',
        subtotalPrice: '2800',
        shippingPrice: '200',
        totalPrice: '3000',
        paymentMethod: 'Cash on Delivery (COD)',
        deliverySLA: '3 to 4 working days',
        openParcelPolicy: 'Courier does not allow open parcel before payment',
        returnPolicy: '7-day replacement warranty for manufacturing defects'
      });

      // Role & Identity
      expect(instruction).toContain('Zara');
      expect(instruction).toContain('Sunday Bazaar');
      expect(instruction).toContain('Ahmad Khan');
      expect(instruction).toContain('SB-9872');

      // Factual order data
      expect(instruction).toContain('Wireless Earbuds Pro');
      expect(instruction).toContain('Black Edition');
      expect(instruction).toContain('House 42, Street 5, Gulberg III, Lahore');
      expect(instruction).toContain('3 to 4 working days');
      expect(instruction).toContain('Courier does not allow open parcel');
      expect(instruction).toContain('7-day replacement warranty');

      // Rules & Safety
      expect(instruction).toContain('Never invent delivery dates');
      expect(instruction).toContain('STRICT ACTION SAFETY & NEGATION RULES');
      expect(instruction).toContain('OUT-OF-SCOPE INQUIRIES');
      expect(instruction).toContain('FREE-FORM DYNAMIC BEHAVIOR & RULES');
    });

    it('falls back safely when optional order metadata is not provided', () => {
      const instruction = CallScriptEngine.compileGeminiSystemInstruction({
        agentName: 'Zara',
        shopName: 'Store PK',
        customerName: 'Customer',
        orderNumber: '1001',
        productName: 'T-Shirt',
        productPrice: '1200'
      });

      expect(instruction).toContain('T-Shirt');
      expect(instruction).toContain('1200');
      expect(instruction).toContain('3 to 5 business days');
      expect(instruction).toContain('Never invent delivery dates');
    });

    it('generates natural conversational closings for distinct outcomes', () => {
      expect(CallScriptEngine.generateClosing('CONFIRMED', { customerName: 'Zain' })).toContain('confirm ho gaya hai');
      expect(CallScriptEngine.generateClosing('CANCELLED')).toContain('cancel kar diya hai');
      expect(CallScriptEngine.generateClosing('CALL_BACK')).toContain('dobara call karein ge');
      expect(CallScriptEngine.generateClosing('WRONG_NUMBER')).toContain('remove kar rahe hain');
      expect(CallScriptEngine.generateClosing('HUMAN_TRANSFER')).toContain('representative se connect');
    });
  });

  // =========================================================================
  // 2. Canonical Tool Schema & Dispatcher Tests
  // =========================================================================
  describe('Phase 4: Tool Schema Synchronization & Canonical Dispatcher', () => {
    it('defines synchronized tool schemas with canonical parameters', () => {
      const callbackTool = tools.find(t => t.name === 'schedule_callback');
      expect(callbackTool).toBeDefined();
      expect(callbackTool.parameters.properties.delay_minutes).toBeDefined();
      expect(callbackTool.parameters.properties.requestedTime).toBeDefined();

      const confirmTool = tools.find(t => t.name === 'confirm_order');
      expect(confirmTool).toBeDefined();

      const cancelTool = tools.find(t => t.name === 'cancel_order');
      expect(cancelTool).toBeDefined();

      const orderTool = tools.find(t => t.name === 'get_order');
      expect(orderTool).toBeDefined();
    });

    it('dispatches schedule_callback with canonical delay_minutes', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-cb-1',
        customerPhone: '+923001234567',
        shop: { domain: 'test.myshopify.com' }
      });

      const res = await ToolDispatcher.dispatch(
        'schedule_callback',
        { orderId: 'ord-cb-1', delay_minutes: 60, reason: 'Customer busy driving' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-cb-1', eventId: 'evt-cb-1' }
      );

      expect(res.success).toBe(true);
      expect(res.delayMinutes).toBe(60);
    });

    it('translates natural language requestedTime into canonical delay_minutes', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-cb-2',
        customerPhone: '+923001234567',
        shop: { domain: 'test.myshopify.com' }
      });

      const res = await ToolDispatcher.dispatch(
        'schedule_callback',
        { orderId: 'ord-cb-2', requestedTime: 'kal dopahar call karna', reason: 'Customer at work' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-cb-2', eventId: 'evt-cb-2' }
      );

      expect(res.success).toBe(true);
      expect(res.delayMinutes).toBe(1440); // 24 hours for tomorrow
    });

    it('dispatches get_order returning grounded product and delivery data', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-go-1',
        orderNumber: '9901',
        totalPrice: '4500',
        customerFirstName: 'Bilal',
        customerLastName: 'Saeed',
        customerPhone: '+923001234567',
        lineItemsSummary: 'Leather Jacket (Brown, Large)',
        payload: JSON.stringify({
          line_items: [{ title: 'Leather Jacket', variant_title: 'Brown / L', quantity: 1, price: '4500' }],
          shipping_address: { address1: 'Plot 10, DHA Phase 6', city: 'Karachi' }
        }),
        shop: { domain: 'test.myshopify.com' }
      });

      const res = await ToolDispatcher.dispatch(
        'get_order',
        { orderId: 'ord-go-1' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-go-1' }
      );

      expect(res.success).toBe(true);
      expect(res.orderNumber).toBe('9901');
      expect(res.totalPrice).toBe('4500');
      expect(res.lineItems[0].variantTitle).toBe('Brown / L');
      expect(res.shippingAddress).toContain('Karachi');
    });

    it('dispatches request_human_transfer and tags order appropriately', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-ht-1',
        status: 'Pending Confirmation',
        shop: { domain: 'test.myshopify.com' }
      });
      prisma.order.update.mockResolvedValueOnce({ id: 'ord-ht-1', status: 'Human Transfer' });

      const res = await ToolDispatcher.dispatch(
        'request_human_transfer',
        { orderId: 'ord-ht-1', reason: 'Customer wants custom discount' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-ht-1' }
      );

      expect(res.success).toBe(true);
      expect(res.transferred).toBe(true);
      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ord-ht-1' },
        data: expect.objectContaining({ status: 'Human Transfer' })
      }));
    });
  });

  // =========================================================================
  // 3. Negation Regression Tests (Audit Finding #6)
  // =========================================================================
  describe('Phase 5-6: Strict Negation & Intent Safety Tests', () => {
    it('MUST NOT cancel on "cancel nahi karna"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Bhai mera order cancel nahi karna, bilkul mat karna.',
        callDurationSec: 15
      });
      expect(res.intent).not.toBe('CANCELLED');
    });

    it('MUST NOT cancel on "main cancel nahi karna chahta"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Main cancel nahi karna chahta, mujhe chahiye ye parcel.',
        callDurationSec: 18
      });
      expect(res.intent).not.toBe('CANCELLED');
    });

    it('MUST NOT cancel on "order cancel nahi hai"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Bhai order cancel nahi hai, ye confirm hai bhej do.',
        callDurationSec: 20
      });
      expect(res.intent).not.toBe('CANCELLED');
      expect(res.intent).toBe('CONFIRMED');
    });

    it('MUST NOT cancel on "cancel mat karna"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Suno ghalti se bhi cancel mat karna, main kal paise de dunga.',
        callDurationSec: 12
      });
      expect(res.intent).not.toBe('CANCELLED');
    });

    it('MUST NOT cancel on "maine cancel karne ko nahi kaha"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Maine cancel karne ko nahi kaha, aap bhej dein.',
        callDurationSec: 16
      });
      expect(res.intent).not.toBe('CANCELLED');
    });

    it('MUST NOT cancel on "cancel ka nahi kaha"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Maine cancel ka nahi kaha bhai.',
        callDurationSec: 10
      });
      expect(res.intent).not.toBe('CANCELLED');
    });

    it('MUST NOT confirm on "confirm nahi karna"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Mujhe abhi confirm nahi karna, main baad mein soch ke bataunga.',
        callDurationSec: 14
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    it('MUST NOT confirm on "main confirm nahi karta"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Main confirm nahi karta abhi.',
        callDurationSec: 10
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    it('MUST NOT confirm on "order confirm nahi hai"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Order confirm nahi hai abhi, hold pe rakhein.',
        callDurationSec: 12
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    it('MUST NOT confirm on "abhi confirm nahi kar sakta"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Main abhi confirm nahi kar sakta, ghar pe baat karni hai.',
        callDurationSec: 15
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    it('MUST NOT confirm on "confirm mat karna"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Abhi confirm mat karna please.',
        callDurationSec: 8
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    it('MUST NOT confirm on "confirm ka nahi kaha"', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Maine confirm ka nahi kaha tha.',
        callDurationSec: 9
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    it('MUST NOT confirm or cancel on hesitant language ("Shayad... dekhna parega")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Hmm shayad... mujhe thora dekhna parega...',
        callDurationSec: 10
      });
      expect(res.intent).toBe('UNKNOWN');
      expect(res.confidence).toBeLessThan(0.7);
    });
  });

  // =========================================================================
  // 4. The 25-Point Conversational Matrix
  // =========================================================================
  describe('Phase 14: Audit 25-Point Test Matrix', () => {
    // 1. Normal confirmation
    it('Scenario 1: Normal confirmation ("Jee bilkul order confirm hai")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Jee bilkul order confirm hai.',
        callDurationSec: 20
      });
      expect(res.intent).toBe('CONFIRMED');
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    // 2. Natural confirmation
    it('Scenario 2: Natural confirmation ("Haan bhai bhej do intezar hai")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Haan bhai bilkul bhej do intezar hai mujhe parcel ka.',
        callDurationSec: 22
      });
      expect(res.intent).toBe('CONFIRMED');
    });

    // 3. Natural cancellation
    it('Scenario 3: Natural cancellation ("Nahi chahiye mujhe order cancel kardo")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Nahi chahiye mujhe, order cancel kardo meharbani karke.',
        callDurationSec: 18
      });
      expect(res.intent).toBe('CANCELLED');
    });

    // 4. Callback
    it('Scenario 4: Callback ("Bhai abhi driving kar raha hoon kal call karna")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Bhai abhi driving kar raha hoon, kal call kar lena.',
        callDurationSec: 12
      });
      expect(res.intent).toBe('CALL_BACK');
    });

    // 5. Wrong number
    it('Scenario 5: Wrong number ("Bhai ghalat number hai maine koi cheez order nahi ki")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Bhai ghalat number par call kiya hai, maine koi cheez order nahi ki.',
        callDurationSec: 15
      });
      expect(res.intent).toBe('WRONG_NUMBER');
    });

    // 6. Product question
    it('Scenario 6: Product question ("Order mein kya hai?") does not trigger confirmation/cancellation', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Ji pehle ye bataiye ke order mein kya hai?',
        callDurationSec: 10
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 7. Price question
    it('Scenario 7: Price question ("Total kitne paise hue?") does not trigger confirmation/cancellation', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Total kitne paise hue COD ke?',
        callDurationSec: 11
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 8. Quantity question
    it('Scenario 8: Quantity question ("Kitni items hain parcel mein?") does not trigger premature action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Parcel mein kitni items hain total?',
        callDurationSec: 9
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 9. Delivery question
    it('Scenario 9: Delivery question ("Delivery kab tak hogi?") does not trigger premature action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Delivery kab tak pohnche gi mere ghar?',
        callDurationSec: 12
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 10. Payment question
    it('Scenario 10: Payment question ("Payment cash pe hogi ya card?") does not trigger premature action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Payment cash pe deni hogi rider ko ya online transfer?',
        callDurationSec: 10
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 11. Address question
    it('Scenario 11: Address question ("Konsa address likha hua hai?") does not trigger premature action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Zara bataiye mere paas konsa address likha hua hai?',
        callDurationSec: 13
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 12. Why are you calling?
    it('Scenario 12: Why are you calling? ("Aap call kyun kar rahe ho?") does not trigger premature action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Ji lekin pehle bataiye aap call kyun kar rahe hain?',
        callDurationSec: 14
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 13. Interruption
    it('Scenario 13: Interruption ("Ruko ruko zara suno") does not trigger premature action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Ruko ruko ek minute zara suno...',
        callDurationSec: 6
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 14. Topic change
    it('Scenario 14: Topic change ("Haan lekin pehle address change karna hai") does not confirm blindly', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Haan lekin pehle address change karna hai mujhe.',
        callDurationSec: 15
      });
      expect(res.intent).not.toBe('CONFIRMED');
    });

    // 15. Roman Urdu
    it('Scenario 15: Roman Urdu confirmation ("Theek hai bhej dein shukriya")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Theek hai bhej dein shukriya.',
        callDurationSec: 20
      });
      expect(res.intent).toBe('CONFIRMED');
    });

    // 16. Urdu script
    it('Scenario 16: Urdu script confirmation ("جی بالکل آرڈر کنفرم کر دیں")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: جی بالکل آرڈر کنفرم کر دیں، شکریہ۔',
        callDurationSec: 22
      });
      expect(res.intent).toBe('CONFIRMED');
    });

    // 17. English
    it('Scenario 17: English confirmation ("Yes please confirm my order, thanks")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Yes please confirm my order, thank you.',
        callDurationSec: 18
      });
      expect(res.intent).toBe('CONFIRMED');
    });

    // 18. Mixed language
    it('Scenario 18: Mixed language ("Yes order confirm kardo please")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Yes order confirm kardo please.',
        callDurationSec: 19
      });
      expect(res.intent).toBe('CONFIRMED');
    });

    // 19. Unclear response
    it('Scenario 19: Unclear response ("Hello? Aawaz nahi aa rahi")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Hello? Aawaz nahi aa rahi... kon?',
        callDurationSec: 8
      });
      expect(res.intent).toBe('UNKNOWN');
      expect(res.confidence).toBeLessThan(0.7);
    });

    // 20. Low confidence
    it('Scenario 20: Low confidence / hesitation ("Soch kar bataunga")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Main thora soch kar bataunga aapko.',
        callDurationSec: 11
      });
      expect(res.intent).toBe('UNKNOWN');
      expect(res.confidence).toBeLessThan(0.7);
    });

    // 21. Customer refuses
    it('Scenario 21: Customer refuses ("Main ye parcel nahi loonga, wapis bhejo")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Main ye parcel nahi loonga, wapis bhej do cancel karke.',
        callDurationSec: 16
      });
      expect(res.intent).toBe('CANCELLED');
    });

    // 22. Unsupported policy question
    it('Scenario 22: Unsupported question ("Parcel khol ke check kar sakta hoon?") does not auto-confirm', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Kya main rider ke samne parcel khol kar check kar sakta hoon?',
        callDurationSec: 14
      });
      expect(res.intent).not.toBe('CONFIRMED');
      expect(res.intent).not.toBe('CANCELLED');
    });

    // 23. Unrelated / out of scope question
    it('Scenario 23: Unrelated question ("Lahore mein mausam kaisa hai?") does not trigger order action', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Waise Lahore mein aaj mausam kaisa hai?',
        callDurationSec: 10
      });
      expect(res.intent).toBe('UNKNOWN');
    });

    // 24. Human transfer request
    it('Scenario 24: Human request ("Kisi human agent se baat karwa do")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Mujhe kisi human agent ya manager se baat karwa dein.',
        callDurationSec: 15
      });
      expect(res.intent).toBe('HUMAN_TRANSFER');
    });

    // 25. Do-not-call-again request
    it('Scenario 25: Do-not-call request ("Mujhe dobara call mat karna")', async () => {
      const res = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Mera number delete karein, mujhe dobara call mat karna!',
        callDurationSec: 12
      });
      expect(res.intent).toBe('DO_NOT_CALL');
    });
  });

  // =========================================================================
  // 5. Audio Codec & Barge-in / Interruption Buffer Tests
  // =========================================================================
  describe('Phase 9: Barge-in Audio Buffer Flush', () => {
    it('resets polyphase resamplers on customer barge-in via codec.reset()', () => {
      const codec = new AudioCodec();

      // Encode some samples to prime internal buffers
      const fakePcm16 = Buffer.alloc(320); // 160 16-bit samples
      const ulaw = codec.geminiToTwilio(fakePcm16);
      expect(ulaw).toBeDefined();

      // Ensure reset() exists and clears without exception
      expect(typeof codec.reset).toBe('function');
      codec.reset();

      // Verify codec operates cleanly after reset
      const postResetUlaw = codec.geminiToTwilio(fakePcm16);
      expect(postResetUlaw).toBeDefined();
    });
  });

  // =========================================================================
  // 6. Transcript Persistence & Turn Recording Tests
  // =========================================================================
  describe('Phase 7: Live Transcript Accumulation', () => {
    it('records and formats multi-turn dialogue chronologically', () => {
      const agent = new Agent({
        shopDomain: 'test.myshopify.com',
        systemInstruction: 'Test instruction'
      });

      agent.recordTurn('assistant', 'Assalam o Alaikum! Main Zara baat kar rahi hoon Sunday Bazaar se.');
      agent.recordTurn('user', 'Walaikum Assalam, jee farmaiye.');
      agent.recordTurn('assistant', 'Aap ne Leather Wallet ka order place kiya tha, kya confirm kar dein?');
      agent.recordTurn('user', 'Jee bilkul confirm hai.');

      const transcript = agent.getFormattedTranscript();

      expect(transcript).toContain('Zara: Assalam o Alaikum!');
      expect(transcript).toContain('Customer: Walaikum Assalam');
      expect(transcript).toContain('Zara: Aap ne Leather Wallet');
      expect(transcript).toContain('Customer: Jee bilkul confirm hai.');
      expect(agent.getTurns()).toHaveLength(4);
    });

    it('connects to live session passing callbacks and handles tool responses correctly', async () => {
      let passedCallbacks = null;
      let sentToolResponses = null;
      let sentRealtimeInputs = [];

      const mockSession = {
        sendRealtimeInput: (payload) => sentRealtimeInputs.push(payload),
        sendToolResponse: (payload) => { sentToolResponses = payload; },
        close: vi.fn()
      };

      const mockAi = {
        live: {
          connect: vi.fn().mockImplementation(async (params) => {
            passedCallbacks = params.callbacks;
            return mockSession;
          })
        }
      };

      const executedTools = [];
      const agent = new Agent({
        ai: mockAi,
        shopDomain: 'test.myshopify.com',
        context: { orderId: 'ord-test-101' },
        onToolExecuted: (name, res) => executedTools.push({ name, res })
      });

      await agent.connect('Initial Test Context');

      expect(mockAi.live.connect).toHaveBeenCalled();
      expect(passedCallbacks).toBeDefined();
      expect(typeof passedCallbacks.onmessage).toBe('function');

      // Test sendText and sendAudio
      agent.sendText('Test message');
      expect(sentRealtimeInputs).toContainEqual({ text: 'Test message' });

      agent.sendAudio('fakeBase64Pcm');
      expect(sentRealtimeInputs).toContainEqual({
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: 'fakeBase64Pcm'
        }
      });

      // Test toolCall execution and response routing via sendToolResponse
      await passedCallbacks.onmessage({
        toolCall: {
          functionCalls: [{
            id: 'call_123',
            name: 'confirm_order',
            args: { orderId: 'ord-test-101' }
          }]
        }
      });

      expect(sentToolResponses).toBeDefined();
      expect(sentToolResponses.functionResponses).toHaveLength(1);
      expect(sentToolResponses.functionResponses[0].id).toBe('call_123');
      expect(sentToolResponses.functionResponses[0].name).toBe('confirm_order');
      expect(sentToolResponses.functionResponses[0].response).toBeDefined();

      agent.close();
      expect(mockSession.close).toHaveBeenCalled();
    });
  });
});

