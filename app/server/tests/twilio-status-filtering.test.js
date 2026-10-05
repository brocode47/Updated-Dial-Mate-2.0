import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import expressWs from 'express-ws';
import request from 'supertest';

// Hoist mock functions
const {
  mockHandleCallResult,
  mockCallQueueAdd,
  mockPrismaOrderFindUnique,
  mockPrismaOrderUpdate,
  mockPrismaCallUpdate,
  mockPrismaCallFindUnique
} = vi.hoisted(() => ({
  mockHandleCallResult: vi.fn().mockResolvedValue({ success: true }),
  mockCallQueueAdd: vi.fn().mockResolvedValue({ id: 'retry-job-1' }),
  mockPrismaOrderFindUnique: vi.fn(),
  mockPrismaOrderUpdate: vi.fn(),
  mockPrismaCallUpdate: vi.fn().mockResolvedValue({ id: 'call-1' }),
  mockPrismaCallFindUnique: vi.fn().mockResolvedValue({ id: 'call-1', transcript: 'Customer confirmed order' })
}));

vi.mock('../src/services/callWorkflowService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    CallWorkflowService: {
      ...actual.CallWorkflowService,
      handleCallResult: mockHandleCallResult
    }
  };
});

vi.mock('../src/lib/queues.js', () => ({
  callQueue: { add: mockCallQueueAdd },
  webhookQueue: { add: vi.fn() },
  whatsappQueue: { add: vi.fn() }
}));

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    order: {
      findUnique: mockPrismaOrderFindUnique,
      update: mockPrismaOrderUpdate
    },
    shop: {
      findUnique: vi.fn().mockResolvedValue({ id: 'shop-1', domain: 'test.myshopify.com' })
    },
    call: {
      findUnique: mockPrismaCallFindUnique,
      update: mockPrismaCallUpdate
    },
    complianceLog: {
      create: vi.fn().mockResolvedValue({ id: 'comp-1' })
    }
  }
}));

import { twilioRouter } from '../src/routes/twilio.js';

describe('Twilio Status Callback Filtering & Retry Protection', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    expressWs(app);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/twilio', twilioRouter());

    mockPrismaOrderFindUnique.mockResolvedValue({
      id: 'ord-1642',
      status: 'Pending Confirmation',
      retryCount: 0,
      shop: { id: 'shop-1', domain: 'test.myshopify.com', settings: JSON.stringify({ aiCalling: { maxAttempts: 3, retryDelayMinutes: 15 } }) }
    });
  });

  describe('Non-Terminal Statuses MUST NOT call handleCallResult()', () => {
    it('1. ignores "initiated" status and updates telemetry without calling handleCallResult()', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_INIT_123',
          CallStatus: 'initiated'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).not.toHaveBeenCalled();
      expect(mockPrismaCallUpdate).toHaveBeenCalledWith({
        where: { id: 'call-123' },
        data: { providerCallSid: 'CA_INIT_123' }
      });
    });

    it('2. ignores "ringing" status without calling handleCallResult()', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_RING_123',
          CallStatus: 'ringing'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).not.toHaveBeenCalled();
      expect(mockPrismaCallUpdate).toHaveBeenCalledWith({
        where: { id: 'call-123' },
        data: { providerCallSid: 'CA_RING_123' }
      });
    });

    it('3. ignores "queued" status without calling handleCallResult()', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_QUEUE_123',
          CallStatus: 'queued'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).not.toHaveBeenCalled();
      expect(mockPrismaCallUpdate).toHaveBeenCalledWith({
        where: { id: 'call-123' },
        data: { providerCallSid: 'CA_QUEUE_123' }
      });
    });

    it('4. ignores "in-progress" and "in_progress" status without calling handleCallResult()', async () => {
      const res1 = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_PROG_123',
          CallStatus: 'in-progress'
        });

      expect(res1.status).toBe(200);
      expect(mockHandleCallResult).not.toHaveBeenCalled();

      const res2 = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_PROG_456',
          CallStatus: 'in_progress'
        });

      expect(res2.status).toBe(200);
      expect(mockHandleCallResult).not.toHaveBeenCalled();
    });
  });

  describe('Terminal Statuses MUST call handleCallResult()', () => {
    it('5. "busy" DOES call handleCallResult() with normalized status', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_BUSY_123',
          CallStatus: 'busy',
          CallDuration: '0'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).toHaveBeenCalledTimes(1);
      expect(mockHandleCallResult).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'ord-1642',
        callId: 'call-123',
        callStatus: 'busy'
      }));
    });

    it('6. "no-answer" DOES call handleCallResult() with normalized status', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_NOANS_123',
          CallStatus: 'no-answer',
          CallDuration: '0'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).toHaveBeenCalledTimes(1);
      expect(mockHandleCallResult).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'ord-1642',
        callId: 'call-123',
        callStatus: 'no-answer'
      }));
    });

    it('7. "failed" DOES call handleCallResult() with normalized status', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_FAIL_123',
          CallStatus: 'failed',
          CallDuration: '0'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).toHaveBeenCalledTimes(1);
      expect(mockHandleCallResult).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'ord-1642',
        callId: 'call-123',
        callStatus: 'failed'
      }));
    });

    it('8. "canceled" DOES call handleCallResult() with normalized status', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_CANCEL_123',
          CallStatus: 'canceled',
          CallDuration: '0'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).toHaveBeenCalledTimes(1);
      expect(mockHandleCallResult).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'ord-1642',
        callId: 'call-123',
        callStatus: 'canceled'
      }));
    });

    it('9. "completed" is handled correctly according to existing application behavior', async () => {
      const res = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({
          CallSid: 'CA_COMP_123',
          CallStatus: 'completed',
          CallDuration: '45',
          RecordingUrl: 'https://api.twilio.com/recordings/RE123'
        });

      expect(res.status).toBe(200);
      expect(mockHandleCallResult).toHaveBeenCalledTimes(1);
      expect(mockHandleCallResult).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'ord-1642',
        callId: 'call-123',
        callStatus: 'completed',
        durationSec: 45,
        recordingUrl: 'https://api.twilio.com/recordings/RE123',
        transcript: 'Customer confirmed order'
      }));
    });
  });

  describe('CallWorkflowService Defense-in-Depth & Single Retry Invariant', () => {
    it('10. CallWorkflowService.handleCallResult directly ignores non-terminal statuses without mutating order', async () => {
      const { CallWorkflowService } = await vi.importActual('../src/services/callWorkflowService.js');

      const nonTerminalStatuses = ['initiated', 'ringing', 'queued', 'in-progress', 'in_progress'];
      for (const status of nonTerminalStatuses) {
        const result = await CallWorkflowService.handleCallResult({
          orderId: 'ord-1642',
          callStatus: status
        });

        expect(result).toEqual({ success: true, nonTerminal: true, callStatus: status });
        expect(mockPrismaOrderUpdate).not.toHaveBeenCalled();
        expect(mockCallQueueAdd).not.toHaveBeenCalled();
      }
    });

    it('11. verifies that ONE failed call attempt increments retryCount exactly once and creates exactly ONE retry job across multi-event lifecycle', async () => {
      const { CallWorkflowService } = await vi.importActual('../src/services/callWorkflowService.js');

      // Wire mockHandleCallResult to delegate to the real handleCallResult for this test
      mockHandleCallResult.mockImplementation((args) => CallWorkflowService.handleCallResult(args));

      let currentRetryCount = 0;
      mockPrismaOrderFindUnique.mockImplementation(() => Promise.resolve({
        id: 'ord-1642',
        status: 'Pending Confirmation',
        retryCount: currentRetryCount,
        shop: {
          id: 'shop-1',
          domain: 'test.myshopify.com',
          settings: JSON.stringify({ aiCalling: { maxAttempts: 3, retryDelayMinutes: 15 } })
        }
      }));

      mockPrismaOrderUpdate.mockImplementation((args) => {
        if (args.data?.retryCount !== undefined) {
          currentRetryCount = args.data.retryCount;
        }
        return Promise.resolve({ id: 'ord-1642', retryCount: currentRetryCount });
      });

      // Step 1: Twilio sends 'initiated'
      const resInit = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({ CallSid: 'CA_ATTEMPT_1', CallStatus: 'initiated' });
      expect(resInit.status).toBe(200);

      // Verify no retry mutation or queueing on 'initiated'
      expect(currentRetryCount).toBe(0);
      expect(mockCallQueueAdd).not.toHaveBeenCalled();
      expect(mockPrismaOrderUpdate).not.toHaveBeenCalled();

      // Step 2: Twilio sends 'ringing'
      const resRing = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({ CallSid: 'CA_ATTEMPT_1', CallStatus: 'ringing' });
      expect(resRing.status).toBe(200);
      expect(currentRetryCount).toBe(0);
      expect(mockCallQueueAdd).not.toHaveBeenCalled();

      // Step 3: Twilio sends 'in-progress'
      const resProg = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({ CallSid: 'CA_ATTEMPT_1', CallStatus: 'in-progress' });
      expect(resProg.status).toBe(200);
      expect(currentRetryCount).toBe(0);
      expect(mockCallQueueAdd).not.toHaveBeenCalled();

      // Step 4: Carrier finally returns 'busy' (terminal outcome)
      const resBusy = await request(app)
        .post('/twilio/status?orderId=ord-1642&callId=call-123')
        .send({ CallSid: 'CA_ATTEMPT_1', CallStatus: 'busy', CallDuration: '0' });
      expect(resBusy.status).toBe(200);

      // Verify that after all 4 callbacks for this single call attempt:
      // 1. retryCount incremented EXACTLY once (from 0 to 1)
      expect(currentRetryCount).toBe(1);
      expect(mockPrismaOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ord-1642' },
        data: expect.objectContaining({
          retryCount: 1,
          callStatus: 'pending'
        })
      }));

      // 2. Exactly ONE delayed retry job was created in BullMQ
      expect(mockCallQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockCallQueueAdd).toHaveBeenCalledWith(
        'retry-call',
        expect.objectContaining({
          orderId: 'ord-1642',
          shopId: 'shop-1',
          attempt: 2
        }),
        expect.objectContaining({
          delay: 15 * 60 * 1000,
          jobId: 'retry-shop-1-ord-1642-1'
        })
      );
    });
  });
});

