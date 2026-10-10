import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationLockService } from '../src/services/conversationLockService.js';
import { MessageTrackerService } from '../src/services/messageTracker.js';
import { isZaraAgentCoreEnabled } from '../src/config/features.js';
import { ZaraAgentCore } from '../src/services/zaraAgentCore.js';
import { SpokenResponsePlanner } from '../src/services/spokenResponsePlanner.js';
import { ZaraEvaluationHarness, HELD_OUT_SCENARIOS } from '../src/evaluation/zaraEvaluationHarness.js';

describe('ZARA AI — Phase 4 Production Readiness, Security Hardening & Concurrency Audit', () => {
  beforeEach(() => {
    ConversationLockService.clearMemory();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    ConversationLockService.clearMemory();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. CONCURRENCY & RENEWABLE LOCK LEASE AUDIT
  // ==========================================================================

  describe('1. Concurrency & Renewable Lock Lease Audit', () => {
    it('automatically renews lock lease via heartbeat while job is actively running', async () => {
      const convKey = 'shop1:923001111111';
      let wasCheckedDuringRun = false;

      // Acquire with a short TTL (100ms) and short renewal interval (30ms)
      const result = await ConversationLockService.withLock(
        convKey,
        async (lockContext) => {
          expect(lockContext.token).toBeDefined();
          expect(lockContext.isLocked()).toBe(true);

          // Sleep for 150ms — longer than initial TTL
          await new Promise(r => setTimeout(r, 150));

          // Because of heartbeat renewal, the lock should STILL be held and isLocked() true
          const held = await ConversationLockService.isLockHeld(convKey, lockContext.token);
          expect(held).toBe(true);
          expect(lockContext.isLocked()).toBe(true);
          wasCheckedDuringRun = true;
          return 'done';
        },
        { ttlMs: 100, renewIntervalMs: 30 }
      );

      expect(result).toBe('done');
      expect(wasCheckedDuringRun).toBe(true);
    });

    it('enforces strict distributed mode and fails safely if Redis is offline in production', async () => {
      const convKey = 'shop1:923001111111';

      // When strictDistributed: true is specified (or NODE_ENV=production), refusing in-memory fallback
      await expect(
        ConversationLockService.acquireLock(convKey, { strictDistributed: true })
      ).rejects.toThrow(/Distributed lock unavailable/i);
    });

    it('releases lock cleanly on completion allowing next message to acquire', async () => {
      const convKey = 'shop1:923002222222';
      let step = 0;

      await ConversationLockService.withLock(convKey, async () => {
        step = 1;
      });

      // Second withLock acquires immediately because previous released cleanly
      await ConversationLockService.withLock(convKey, async () => {
        step = 2;
      });

      expect(step).toBe(2);
    });
  });

  // ==========================================================================
  // 2. ATOMIC MESSAGE DEDUPLICATION
  // ==========================================================================

  describe('2. Atomic Message Deduplication', () => {
    it('guarantees only one worker claims processing when duplicate deliveries race', async () => {
      const messageId = `race_msg_${Date.now()}`;

      // Simulate simultaneous markProcessing attempts
      const [claimA, claimB] = await Promise.all([
        MessageTrackerService.markProcessing(messageId, { shopId: 'shop1' }),
        MessageTrackerService.markProcessing(messageId, { shopId: 'shop1' })
      ]);

      // Exactly one must succeed (true) and one must be rejected (false)
      expect(claimA !== claimB).toBe(true);
      expect(claimA || claimB).toBe(true);
      expect(claimA && claimB).toBe(false);

      // Subsequent checks confirm message is processing
      const already = await MessageTrackerService.isAlreadyProcessed(messageId);
      expect(already).toBe(true);
    });
  });

  // ==========================================================================
  // 3. HIGH-RISK BUSINESS ACTION SAFETY & IDEMPOTENCY
  // ==========================================================================

  describe('3. High-Risk Business Action Safety & Idempotency', () => {
    it('confirm_order is idempotent when order is already Confirmed', async () => {
      const authContext = {
        shopId: 'shop1',
        shopDomain: 'sundaybazaaar.store',
        fromPhone: '+923001234567'
      };

      const { OrderResolver } = await import('../src/services/orderResolver.js');
      vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValue({
        found: true,
        order: {
          id: 'ord-1643',
          orderNumber: '1643',
          status: 'Confirmed',
          totalAmount: 1499
        }
      });

      const res = await ZaraAgentCore.executeTool('confirm_order', { orderNumber: '1643' }, authContext);
      expect(res.success).toBe(true);
      expect(res.alreadyConfirmed).toBe(true);
      expect(res.status).toBe('Confirmed');
    });

    it('confirm_order refuses to confirm a previously Cancelled order', async () => {
      const authContext = {
        shopId: 'shop1',
        shopDomain: 'sundaybazaaar.store',
        fromPhone: '+923001234567'
      };

      const { OrderResolver } = await import('../src/services/orderResolver.js');
      vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValue({
        found: true,
        order: {
          id: 'ord-1643',
          orderNumber: '1643',
          status: 'Cancelled',
          totalAmount: 1499
        }
      });

      const res = await ZaraAgentCore.executeTool('confirm_order', { orderNumber: '1643' }, authContext);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/previously cancelled/i);
    });

    it('cancel_order is idempotent when order is already Cancelled', async () => {
      const authContext = {
        shopId: 'shop1',
        shopDomain: 'sundaybazaaar.store',
        fromPhone: '+923001234567'
      };

      const { OrderResolver } = await import('../src/services/orderResolver.js');
      vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValue({
        found: true,
        order: {
          id: 'ord-1643',
          orderNumber: '1643',
          status: 'Cancelled',
          totalAmount: 1499
        }
      });

      const res = await ZaraAgentCore.executeTool('cancel_order', { orderNumber: '1643', reason: 'customer_change' }, authContext);
      expect(res.success).toBe(true);
      expect(res.alreadyCancelled).toBe(true);
      expect(res.status).toBe('Cancelled');
    });

    it('cancel_order on a Confirmed or dispatched order escalates to human review instead of falsely confirming cancellation', async () => {
      const authContext = {
        shopId: 'shop1',
        shopDomain: 'sundaybazaaar.store',
        fromPhone: '+923001234567'
      };

      const { OrderResolver } = await import('../src/services/orderResolver.js');
      vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValue({
        found: true,
        order: {
          id: 'ord-1643',
          orderNumber: '1643',
          status: 'Confirmed',
          totalAmount: 1499
        }
      });

      const res = await ZaraAgentCore.executeTool('cancel_order', { orderNumber: '1643', reason: 'mind_changed' }, authContext);
      expect(res.success).toBe(false);
      expect(res.requiresHumanReview).toBe(true);
      expect(res.message).toMatch(/already confirmed.*forwarded to our management team/i);
    });

    it('strictly refuses side-effecting actions if lock lease was lost or expired', async () => {
      const authContextWithLostLock = {
        shopId: 'shop1',
        shopDomain: 'sundaybazaaar.store',
        fromPhone: '+923001234567',
        lockContext: { isLocked: () => false } // Lock expired / lost!
      };

      const resConfirm = await ZaraAgentCore.executeTool('confirm_order', { orderNumber: '1643' }, authContextWithLostLock);
      expect(resConfirm.success).toBe(false);
      expect(resConfirm.error).toMatch(/Lock lease expired or lost/i);

      const resCancel = await ZaraAgentCore.executeTool('cancel_order', { orderNumber: '1643', reason: 'changed' }, authContextWithLostLock);
      expect(resCancel.success).toBe(false);
      expect(resCancel.error).toMatch(/Lock lease expired or lost/i);

      const resEscalate = await ZaraAgentCore.executeTool('request_human_transfer', { reason: 'help' }, authContextWithLostLock);
      expect(resEscalate.success).toBe(false);
      expect(resEscalate.error).toMatch(/Lock lease expired or lost/i);
    });
  });

  // ==========================================================================
  // 4. SERVER-SIDE CANARY ALLOWLIST & FEATURE FLAG SAFETY
  // ==========================================================================

  describe('4. Server-Side Canary Allowlist & Feature Flag Safety', () => {
    it('defaults to disabled when USE_ZARA_AGENT_CORE is unset or false', () => {
      delete process.env.USE_ZARA_AGENT_CORE;
      delete process.env.ZARA_AGENT_TESTER_PHONES;
      expect(isZaraAgentCoreEnabled('+923001234567')).toBe(false);

      process.env.USE_ZARA_AGENT_CORE = 'false';
      expect(isZaraAgentCoreEnabled('+923001234567')).toBe(false);
    });

    it('canary mode activates ONLY for allowlisted numbers and denies real customers', () => {
      process.env.USE_ZARA_AGENT_CORE = 'canary';
      process.env.ZARA_AGENT_TESTER_PHONES = '923001112233,923334445566';

      // Tester 1 (with matching last digits/full number) -> ENABLED
      expect(isZaraAgentCoreEnabled('+923001112233')).toBe(true);
      // Tester 2 -> ENABLED
      expect(isZaraAgentCoreEnabled('03334445566')).toBe(true);

      // Real customer phone -> DENIED
      expect(isZaraAgentCoreEnabled('+923009998877')).toBe(false);
      expect(isZaraAgentCoreEnabled(null)).toBe(false);
    });

    it('canary mode defaults to deny if no allowlist is configured', () => {
      process.env.USE_ZARA_AGENT_CORE = 'canary';
      delete process.env.ZARA_AGENT_TESTER_PHONES;
      delete process.env.ZARA_AGENT_CORE_ALLOWLIST;

      expect(isZaraAgentCoreEnabled('+923001234567')).toBe(false);
    });
  });

  // ==========================================================================
  // 5. EVALUATION HARNESS & OBJECTIVE SCORECARD
  // ==========================================================================

  describe('5. Evaluation Harness & Objective Scorecard', () => {
    it('runs the full 31 held-out scenarios and outputs a 100% compliant protocol scorecard', async () => {
      const harness = new ZaraEvaluationHarness();
      const scorecard = await harness.runSuite();

      expect(scorecard.evaluationMode).toBe('MOCK_PROTOCOL');
      expect(scorecard.apiKeyProvided).toBe(false);
      expect(scorecard.metrics.totalScenarios).toBe(31);
      expect(scorecard.metrics.passedScenarios).toBe(31);
      expect(scorecard.metrics.failedScenarios).toBe(0);
      expect(scorecard.metrics.passRatePercent).toBe(100);

      // Verify specific scenarios
      const sc1 = scorecard.results.find(r => r.scenarioId === 'SCENARIO_01_CASUAL_GREETING_EVENING');
      expect(sc1.passed).toBe(true);
      expect(sc1.checks.noUnsolicitedSalesTools).toBe(true);

      const sc10 = scorecard.results.find(r => r.scenarioId === 'SCENARIO_10_PRONOUN_DISCOURSE_4_TURNS');
      expect(sc10.passed).toBe(true);
      expect(sc10.checks.quotedAccuratePrice).toBe(true);

      const sc18 = scorecard.results.find(r => r.scenarioId === 'SCENARIO_18_CROSS_CUSTOMER_DEFENSE');
      expect(sc18.passed).toBe(true);
      expect(sc18.checks.blockedUnauthorizedDisclosure).toBe(true);

      const sc31 = scorecard.results.find(r => r.scenarioId === 'SCENARIO_31_PROMPT_INJECTION_DEFENSE');
      expect(sc31.passed).toBe(true);
      expect(sc31.checks.promptInjectionDeflected).toBe(true);
    }, 20000);
  });

  // ==========================================================================
  // 6. VOICE NORMALIZATION & URL STRIPPING
  // ==========================================================================

  describe('6. Voice Normalization & URL Stripping', () => {
    it('normalizes spoken output by omitting raw URLs and converting Rs to rupay', () => {
      const rawText = 'Ji, Wooden Silicone Chair Protection Cover ki price Rs. 1499 hai.\n\n🔗 https://sundaybazaaar.store/products/chair-protection-cover';
      const spoken = SpokenResponsePlanner.normalizeSpokenText(rawText);

      expect(spoken).not.toMatch(/https?:\/\//i);
      expect(spoken).toMatch(/1499\s*rupay/i);
    });
  });
});
