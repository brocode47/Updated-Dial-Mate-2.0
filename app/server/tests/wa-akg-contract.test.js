import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { prisma } from '../src/lib/db.js';
import { whatsappQueue } from '../src/lib/queues.js';
import { webhooksRouter } from '../src/routes/webhooks.js';
import { processWhatsAppJob } from '../src/workers/whatsappWorker.js';
import { ChatStateService } from '../src/services/chatState.js';

// Mock everything external
vi.mock('../src/lib/db.js', () => ({
  prisma: {
    whatsAppIntegration: { findUnique: vi.fn() },
    order: { findFirst: vi.fn() }
  }
}));

vi.mock('../src/lib/queues.js', () => ({
  whatsappQueue: { add: vi.fn() }
}));

// Mock waClient and AI client for the worker test

const { mockSendMessage, mockDownloadMedia, mockSendMessageAI, mockGetHistory } = vi.hoisted(() => ({
    mockSendMessage: vi.fn(),
    mockDownloadMedia: vi.fn(),
    mockSendMessageAI: vi.fn(),
    mockGetHistory: vi.fn().mockResolvedValue([])
}));

export { mockSendMessage, mockDownloadMedia, mockSendMessageAI, mockGetHistory };

vi.mock('../src/integrations/whatsapp/client.js', () => {
  return {
    WhatsAppClient: vi.fn().mockImplementation(function () {
      return {
        sendMessage: async (...args) => mockSendMessage(...args),
        downloadMedia: async (...args) => mockDownloadMedia(...args),
        _formatJid: (jid) => jid
      };
    })
  };
});

vi.mock('../src/integrations/ai/client.js', () => ({
  getAIClient: vi.fn().mockReturnValue({
    chats: {
      create: vi.fn().mockReturnValue({
        sendMessage: async (...args) => mockSendMessageAI(...args),
        getHistory: async (...args) => mockGetHistory(...args)
      })
    }
  }),
  generateContent: vi.fn()
}));

vi.mock('../src/integrations/ai/dispatcher.js', () => ({
  dispatchToolCall: vi.fn()
}));

import { MessageTrackerService } from '../src/services/messageTracker.js';

describe('WA-AKG API Contract Mismatch Fixes', () => {
  let app;
  const SECRET = 'test-secret';

  beforeEach(async () => {
    process.env.WA_AKG_WEBHOOK_SECRET = SECRET;
    
    app = express();
    // Raw body parser exactly as in production
    app.use('/webhooks', express.raw({ type: 'application/json' }));
    app.use('/webhooks', webhooksRouter());

    try {
      await MessageTrackerService.reset('msg-id-123');
      await MessageTrackerService.reset('msg-id-text');
      await MessageTrackerService.reset('msg-1');
    } catch (_) {}

    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.WA_AKG_WEBHOOK_SECRET;
  });

  const createSignature = (rawString) => {
    return crypto.createHmac('sha256', SECRET).update(rawString).digest('hex');
  };

  it('Mismatch 1 & 2: Webhook accepts payload, extracts exact sessionId, and uses key.id for queue idempotency', async () => {
    prisma.whatsAppIntegration.findUnique.mockResolvedValue({
      status: 'CONNECTED',
      isActive: true,
      shop: { id: 'shop-1', domain: 'test-shop.myshopify.com', status: 'ACTIVE', isActive: true }
    });

    const payload = {
      event: 'message.received',
      sessionId: 'session-123',
      timestamp: new Date().toISOString(),
      data: {
        key: { id: 'msg-id-123', remoteJid: '1234567890@s.whatsapp.net', fromMe: false },
        from: 'system',
        receiver: '1234567890@s.whatsapp.net',
        sender: '1234567890@s.whatsapp.net',
        isGroup: false,
        chatType: 'PERSONAL',
        type: 'TEXT',
        content: 'Hello AI',
        fileUrl: null,
        caption: null,
        quoted: null
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('X-Webhook-Signature', `sha256=${signature}`)
      .set('Content-Type', 'application/json').send(rawBody);

    expect(res.status).toBe(200);

    expect(prisma.whatsAppIntegration.findUnique).toHaveBeenCalledWith({
      where: { provider_sessionId: { provider: 'WA_AKG', sessionId: 'session-123' } },
      include: { shop: true }
    });

    expect(whatsappQueue.add).toHaveBeenCalledWith(
      'wa-message',
      {
        shopId: 'shop-1',
        shopDomain: 'test-shop.myshopify.com',
        sessionId: 'session-123',
        payload: payload.data
      },
      {
        // THIS IS THE IDEMPOTENCY FIX VERIFICATION
        jobId: 'msg-id-123'
      }
    );
  });

  it('Mismatch 3 & 4: Worker extracts content instead of message, and sends response', async () => {
    const jobData = {
      shopDomain: 'test-shop.myshopify.com',
      sessionId: 'session-123',
      payload: {
        key: { id: 'msg-id-123', remoteJid: '1234567890@s.whatsapp.net', fromMe: false },
        type: 'voice',
        content: '',
        fileUrl: 'http://example.com/media'
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agent: 'support', intent: 'voice_note', confidence: 0.9, response: 'AI response' })
    });
    global.fetch = mockFetch;

    await processWhatsAppJob({ data: jobData });

    // Verify AI engine was called with extracted phone and voice prompt
    expect(mockFetch).toHaveBeenCalled();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.customer_phone).toBe('1234567890');

    // Verify outgoing message used correct JID
    expect(mockSendMessage).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'AI response', expect.any(Object));
  });
  
  it('Worker correctly extracts text from payload.content', async () => {
    const jobData = {
      shopDomain: 'test-shop.myshopify.com',
      sessionId: 'session-123',
      payload: {
        key: { id: 'msg-id-text', remoteJid: '1234567890@s.whatsapp.net', fromMe: false },
        type: 'TEXT',
        content: 'I want to ask about my order',
        fileUrl: null
      }
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agent: 'order_agent', intent: 'order_status', confidence: 0.95, response: 'Sure!' })
    });
    global.fetch = mockFetch;

    await processWhatsAppJob({ data: jobData });

    expect(mockFetch).toHaveBeenCalled();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.message).toBe('I want to ask about my order');
    expect(mockSendMessage).toHaveBeenCalledWith('1234567890@s.whatsapp.net', 'Sure!', expect.any(Object));
  });

  it('Missing HMAC remains rejected (Security Regression Test)', async () => {
    const payload = { event: 'message.received', sessionId: 'session-123', data: {} };
    
    const rawBody = JSON.stringify(payload);
    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('Content-Type', 'application/json').send(rawBody);

    expect(res.status).toBe(401);
    expect(whatsappQueue.add).not.toHaveBeenCalled();
  });

  it('Malicious payload cannot inject tenant (Tenant Mapping Regression Test)', async () => {
    prisma.whatsAppIntegration.findUnique.mockResolvedValue({
      status: 'CONNECTED',
      isActive: true,
      shop: { id: 'shop-1', domain: 'test-shop.myshopify.com', status: 'ACTIVE', isActive: true }
    });

    const payload = {
      event: 'message.received',
      sessionId: 'session-123',
      shopDomain: 'malicious-shop.myshopify.com', // Attempting to inject
      data: {
        key: { id: 'msg-1' },
        shopDomain: 'another-malicious.myshopify.com'
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    await request(app)
      .post('/webhooks/wa-akg')
      .set('X-Webhook-Signature', `sha256=${signature}`)
      .set('Content-Type', 'application/json').send(rawBody);

    expect(whatsappQueue.add).toHaveBeenCalledWith(
      'wa-message',
      expect.objectContaining({
        shopDomain: 'test-shop.myshopify.com' // Should remain the DB resolved one
      }),
      expect.any(Object)
    );
  });
});
