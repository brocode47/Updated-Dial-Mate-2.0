import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallScriptEngine } from '../src/services/callScriptEngine.js';
import { AICallInterpretationService } from '../src/services/aiCallInterpretationService.js';
import { CallWorkflowService } from '../src/services/callWorkflowService.js';
import { prisma } from '../src/lib/db.js';

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    shop: { findUnique: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
    call: {
      create: vi.fn().mockResolvedValue({ id: 'call-uuid-phase6' }),
      update: vi.fn().mockResolvedValue({ id: 'call-uuid-phase6' }),
      count: vi.fn().mockResolvedValue(0)
    },
    complianceLog: { create: vi.fn().mockResolvedValue({ id: 'comp-1' }) }
  }
}));

describe('PHASE 6: Real AI Calling Activation & Script Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CallScriptEngine', () => {
    it('generates natural Urdu opening greeting with customer and order context', () => {
      const opening = CallScriptEngine.generateOpening({
        agentName: 'Zara',
        shopName: 'Sunday Bazaar',
        customerName: 'Usman Ali',
        orderNumber: '1099',
        productName: 'Leather Wallet',
        productPrice: '1500'
      });

      expect(opening).toContain('Zara');
      expect(opening).toContain('Sunday Bazaar');
      expect(opening).toContain('Usman Ali');
      expect(opening).toContain('Leather Wallet');
      expect(opening).toContain('1500');
      expect(opening).toContain('Assalam o Alaikum');
    });

    it('compiles Gemini Live 2.0 system instruction containing 5-step conversational protocol', () => {
      const instruction = CallScriptEngine.compileGeminiSystemInstruction({
        agentName: 'Zara',
        shopName: 'Sunday Bazaar',
        customerName: 'Hamza Khan',
        orderNumber: '1100',
        productName: 'Smart Watch',
        productPrice: '3500'
      });

      expect(instruction).toContain('You are Zara');
      expect(instruction).toContain('Step 1: GREETING & IDENTITY CONFIRMATION');
      expect(instruction).toContain('Step 2: ORDER REFERENCE');
      expect(instruction).toContain('Step 3: PRODUCT & COD AMOUNT CONFIRMATION');
      expect(instruction).toContain('Step 4: DELIVERY CONFIRMATION');
      expect(instruction).toContain('Step 5: CLOSING');
      expect(instruction).toContain('confirm_order');
      expect(instruction).toContain('cancel_order');
      expect(instruction).toContain('schedule_callback');
    });

    it('generates appropriate closing responses across all intents', () => {
      expect(CallScriptEngine.generateClosing('CONFIRMED', { customerName: 'Ali' })).toContain('confirm ho gaya hai');
      expect(CallScriptEngine.generateClosing('CANCELLED')).toContain('cancel kar diya hai');
      expect(CallScriptEngine.generateClosing('CALL_BACK')).toContain('dobara call karein ge');
      expect(CallScriptEngine.generateClosing('WRONG_NUMBER')).toContain('remove kar rahe hain');
    });
  });

  describe('AI Conversation Intelligence & Interpretation', () => {
    it('detects CONFIRMED intent with positive sentiment', async () => {
      const result = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Jee bilkul, main Usman baat kar raha hoon. Mera order confirm kar dein please.',
        callDurationSec: 25
      });

      expect(result.intent).toBe('CONFIRMED');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.customerEmotion).toBe('Positive');
    });

    it('detects CANCELLED intent when customer refuses', async () => {
      const result = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Nahi bhai, mujhe nahi chahiye. Order cancel kardo meharbani karke.',
        callDurationSec: 15
      });

      expect(result.intent).toBe('CANCELLED');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects CALL_BACK when customer is busy or driving', async () => {
      const result = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Bhai main abhi driving kar raha hoon, bohat masroof hoon. Baad me call karna.',
        callDurationSec: 10
      });

      expect(result.intent).toBe('CALL_BACK');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.customerEmotion).toBe('Busy');
    });

    it('detects WRONG_NUMBER when customer indicates wrong recipient', async () => {
      const result = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Aap ka wrong number hai, maine koi cheez order nahi ki. Ghalat number dial kiya hai.',
        callDurationSec: 12
      });

      expect(result.intent).toBe('WRONG_NUMBER');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('Whitelist & Production Safety Controls', () => {
    it('blocks call if emergency stop switch is engaged', async () => {
      const prevStop = process.env.EMERGENCY_STOP;
      process.env.EMERGENCY_STOP = 'true';

      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        shop: { id: 's-1', domain: 'test.myshopify.com', settings: {} },
        customer: { phone: '+923001234567' }
      });

      const res = await CallWorkflowService.initiateCall({
        orderId: 'ord-1',
        shopDomain: 'test.myshopify.com'
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('EMERGENCY_STOP_ACTIVE');

      process.env.EMERGENCY_STOP = prevStop || '';
    });

    it('diverts non-whitelisted numbers to safe simulation in test mode', async () => {
      const prevMode = process.env.AI_CALL_MODE;
      const prevAdmin = process.env.ADMIN_TEST_NUMBERS;
      const prevDryRun = process.env.DRY_RUN_CALLS;

      process.env.AI_CALL_MODE = 'test';
      process.env.ADMIN_TEST_NUMBERS = '+923009999999';
      process.env.DRY_RUN_CALLS = 'false';

      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-test-1',
        totalAmount: 2500,
        callStatus: 'pending',
        shop: { id: 's-1', domain: 'test.myshopify.com', settings: { autoCallEnabled: true } },
        customer: { phone: '+923001234567' }, // Not in ADMIN_TEST_NUMBERS!
        payload: JSON.stringify({ line_items: [{ title: 'Shoes' }], total_price: '2500' })
      });

      const res = await CallWorkflowService.initiateCall({
        orderId: 'ord-test-1',
        shopDomain: 'test.myshopify.com',
        force: true
      });

      expect(res.success).toBe(true);
      expect(res.dryRun).toBe(true); // Safely simulated!
      expect(res.providerCallSid).toMatch(/dry[-_]run/i);

      process.env.AI_CALL_MODE = prevMode;
      process.env.ADMIN_TEST_NUMBERS = prevAdmin;
      process.env.DRY_RUN_CALLS = prevDryRun;
    });
  });
});
