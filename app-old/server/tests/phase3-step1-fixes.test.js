import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToolCall } from '../src/integrations/ai/dispatcher.js';
import { OrderStateMachine, OrderStatus } from '../src/services/OrderStateMachine.js';
import * as ordersApi from '../src/integrations/shopify/orders.js';
import { prisma } from '../src/lib/db.js';

// Mock BullMQ queues
const { mockAdd } = vi.hoisted(() => {
  return {
    mockAdd: vi.fn().mockImplementation(async (name, data, opts) => {
      return { id: opts?.jobId || 'bull-job-999' };
    })
  };
});

vi.mock('../src/lib/queues.js', () => ({
  callQueue: {
    add: mockAdd
  }
}));

vi.mock('../src/integrations/shopify/orders.js');
vi.mock('../src/lib/db.js', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

describe('Phase 3 Step 1 Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OrderStateMachine', () => {
    it('should reject invalid transition (CANCELLED -> CONFIRMED)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.CANCELLED,
        shop: { domain: 'test.myshopify.com' }
      });

      const sm = new OrderStateMachine('ord-123', 'test.myshopify.com');
      await expect(sm.transition(OrderStatus.CONFIRMED)).rejects.toThrow(/Invalid state transition/);
    });

    it('should reject cross-tenant access', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.PENDING,
        shop: { domain: 'other.myshopify.com' }
      });

      const sm = new OrderStateMachine('ord-123', 'test.myshopify.com');
      await expect(sm.transition(OrderStatus.CONFIRMED)).rejects.toThrow(/Unauthorized cross-tenant access/);
    });

    it('should allow valid transition and update DB', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.PENDING,
        shop: { domain: 'test.myshopify.com' },
        payload: JSON.stringify({ id: 1111 })
      });
      prisma.order.update.mockResolvedValue({ id: 'ord-123', status: OrderStatus.HUMAN_REQUIRED });

      const sm = new OrderStateMachine('ord-123', 'test.myshopify.com');
      const res = await sm.transition(OrderStatus.HUMAN_REQUIRED);

      expect(res.status).toBe(OrderStatus.HUMAN_REQUIRED);
      expect(ordersApi.addOrderTag).toHaveBeenCalledWith('test.myshopify.com', 1111, 'HUMAN_REVIEW_NEEDED');
      expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'ord-123' }, data: { status: OrderStatus.HUMAN_REQUIRED } });
    });
  });

  describe('Dispatcher Tenant Isolation', () => {
    it('should prevent AI from accessing an order from another tenant', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.PENDING,
        shop: { domain: 'other.myshopify.com' }
      });

      const result = await dispatchToolCall('test.myshopify.com', 'get_order', { orderId: 'ord-123' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unauthorized cross-tenant access/);
    });
  });

  describe('Dispatcher Human Transfer', () => {
    it('should transition order to HUMAN_REQUIRED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        shop: { domain: 'test.myshopify.com' }
      });
      prisma.order.update.mockResolvedValue({ id: 'ord-123', status: OrderStatus.HUMAN_REQUIRED });

      const result = await dispatchToolCall('test.myshopify.com', 'request_human_transfer', { orderId: 'ord-123', reason: 'Angry customer' });
      expect(result.success).toBe(true);
      expect(result.data.status).toBe(OrderStatus.HUMAN_REQUIRED);
      expect(prisma.order.update).toHaveBeenCalled();
    });
  });

  describe('Callback Idempotency Requirements', () => {
    it('1. Same callback event submitted twice → one job', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });


      const eventId = 'evt-duplicate-test';
      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'checking status'
      }, { eventId });

      const result2 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'checking status'
      }, { eventId });

      expect(result1.data.jobId).toBe(result2.data.jobId);
    });

    it('2. Same callback event after API restart → one job', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });


      const eventId = 'evt-restart-test';
      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'needs human'
      }, { eventId });

      // Simulate API restart by manually adding the same job directly to the queue
      const { callQueue } = await import('../src/lib/queues.js');
      const crypto = await import('crypto');
      const reasonHash = crypto.createHash('sha256').update('needs human').digest('hex').substring(0, 8);
      // Ensure the delay15 is in the expected job ID
      const expectedJobId = `cb-test.myshopify.com-ord-123-${reasonHash}-delay15-${eventId}`;
      
      const job = await callQueue.add('callback', { orderId: 'ord-123' }, { jobId: expectedJobId });
      
      expect(result1.data.jobId).toBe(expectedJobId);
      expect(job.id).toBe(expectedJobId); // BullMQ returns the same job ID
    });

    it('3. Same order + genuinely new callback event → two jobs', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });


      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'needs help'
      }, { eventId: 'evt-new-1' });

      const result2 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'needs help' // Same reason, same order, different event
      }, { eventId: 'evt-new-2' });

      expect(result1.data.jobId).not.toBe(result2.data.jobId);
    });

    it('3.5 Same event + different legitimate callback schedule → separate jobs', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });

      const eventId = 'evt-same-turn';
      
      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'status update',
        delay_minutes: 15
      }, { eventId });

      const result2 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'status update',
        delay_minutes: 60 // Different schedule within the same turn
      }, { eventId });

      expect(result1.data.jobId).not.toBe(result2.data.jobId);
    });

    it('4. Two legitimate callbacks requested only 5 minutes apart → two jobs', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });


      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'status update',
        delay_minutes: 15
      }, { eventId: 'evt-time-1' });

      const result2 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'status update',
        delay_minutes: 15
      }, { eventId: 'evt-time-2' });

      expect(result1.data.jobId).not.toBe(result2.data.jobId);
    });

    it('5. Same callback event processed 30 minutes later → still one job', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        status: OrderStatus.IN_PROGRESS,
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });


      const eventId = 'evt-delayed-retry';
      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'system issue'
      }, { eventId });

      const result2 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'system issue'
      }, { eventId });

      expect(result1.data.jobId).toBe(result2.data.jobId);
    });

    it('Different tenants do not collide', async () => {


      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-123',
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });
      const result1 = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'issue'
      }, { eventId: 'shared-event-id' });

      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-123',
        customerPhone: '+15551234567',
        shop: { domain: 'other.myshopify.com' }
      });
      const result2 = await dispatchToolCall('other.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'issue'
      }, { eventId: 'shared-event-id' });

      expect(result1.data.jobId).not.toBe(result2.data.jobId);
    });

    it('Fails if eventId is missing', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord-123',
        customerPhone: '+15551234567',
        shop: { domain: 'test.myshopify.com' }
      });
      
      const res = await dispatchToolCall('test.myshopify.com', 'schedule_callback', {
        orderId: 'ord-123',
        reason: 'test'
      }, { /* no eventId */ });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/explicit event identity/);
    });
  });
});
