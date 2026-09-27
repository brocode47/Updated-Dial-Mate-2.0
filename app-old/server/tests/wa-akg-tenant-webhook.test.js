import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

// Mock the dependencies before importing the router
vi.mock('../src/lib/queues.js', () => ({
  whatsappQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' })
  },
  webhookQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-2' })
  }
}));

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    whatsAppIntegration: {
      findUnique: vi.fn()
    },
    webhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    shop: {
      findUnique: vi.fn()
    },
    complianceLog: {
      create: vi.fn()
    }
  }
}));

import { webhooksRouter } from '../src/routes/webhooks.js';
import { whatsappQueue } from '../src/lib/queues.js';
import { prisma } from '../src/lib/db.js';

const app = express();
app.use(express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.body && Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
  }
  next();
});
app.use('/webhooks', webhooksRouter());

describe('WA-AKG Tenant Mapping Webhook', () => {
  const secret = 'test-secret';
  
  beforeAll(() => {
    process.env.WA_AKG_WEBHOOK_SECRET = secret;
  });
  
  afterAll(() => {
    delete process.env.WA_AKG_WEBHOOK_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSignature(payloadStr) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  }

  it('Reject missing sessionId', async () => {
    const payload = { event: 'message.received', data: { key: { id: '123' } } }; // missing sessionId
    const payloadStr = JSON.stringify(payload);
    
    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', makeSignature(payloadStr))
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(200); // Quarantine
    expect(prisma.whatsAppIntegration.findUnique).not.toHaveBeenCalled();
    expect(whatsappQueue.add).not.toHaveBeenCalled();
  });

  it('Reject unknown sessionId', async () => {
    prisma.whatsAppIntegration.findUnique.mockResolvedValue(null);

    const payload = { event: 'message.received', sessionId: 'unknown', data: { key: { id: '123' } } };
    const payloadStr = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', makeSignature(payloadStr))
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(200); // Quarantine
    expect(prisma.whatsAppIntegration.findUnique).toHaveBeenCalledWith({
      where: { provider_sessionId: { provider: 'WA_AKG', sessionId: 'unknown' } },
      include: { shop: true }
    });
    expect(whatsappQueue.add).not.toHaveBeenCalled();
  });

  it('Reject inactive integration', async () => {
    prisma.whatsAppIntegration.findUnique.mockResolvedValue({
      id: 'int-1',
      isActive: false,
      shop: { id: 'shop-1', domain: 'tenant.myshopify.com', isActive: true }
    });

    const payload = { event: 'message.received', sessionId: 'inactive', data: { key: { id: '123' } } };
    const payloadStr = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', makeSignature(payloadStr))
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(200); // Quarantine
    expect(whatsappQueue.add).not.toHaveBeenCalled();
  });

  it('Reject inactive shop', async () => {
    prisma.whatsAppIntegration.findUnique.mockResolvedValue({
      id: 'int-1',
      isActive: true,
      shop: { id: 'shop-1', domain: 'tenant.myshopify.com', isActive: false }
    });

    const payload = { event: 'message.received', sessionId: 'bad-shop', data: { key: { id: '123' } } };
    const payloadStr = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', makeSignature(payloadStr))
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(200); // Quarantine
    expect(whatsappQueue.add).not.toHaveBeenCalled();
  });

  it('Success resolves shopDomain correctly regardless of payload (malicious payload)', async () => {
    prisma.whatsAppIntegration.findUnique.mockResolvedValue({
      id: 'int-1',
      isActive: true,
      shop: { id: 'shop-1', domain: 'tenantA.myshopify.com', isActive: true }
    });

    // Malicious payload trying to override tenant
    const payload = { 
      event: 'message.received', 
      sessionId: 'valid-session',
      shopDomain: 'tenantB.myshopify.com', 
      data: { key: { id: '123' } } 
    };
    const payloadStr = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', makeSignature(payloadStr))
      .set('x-shop-domain', 'tenantB.myshopify.com') // Malicious header
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(200);
    expect(whatsappQueue.add).toHaveBeenCalledWith('wa-message', {
      shopId: 'shop-1',
      shopDomain: 'tenantA.myshopify.com',
      sessionId: 'valid-session',
      payload: { key: { id: '123' } }
    }, {
      jobId: '123'
    });
  });

  it('Reject invalid HMAC signature', async () => {
    const payload = { event: 'message.received', sessionId: 'valid-session', data: { key: { id: '123' } } };
    const payloadStr = JSON.stringify(payload);
    
    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', 'sha256=invalid-signature')
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(401);
  });

  it('Reject missing HMAC signature', async () => {
    const payload = { event: 'message.received', sessionId: 'valid-session', data: { key: { id: '123' } } };
    const payloadStr = JSON.stringify(payload);
    
    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('Content-Type', 'application/json')
      .send(payloadStr);

    expect(res.status).toBe(401);
  });

  it('Reject modified body with valid signature', async () => {
    const payload = { event: 'message.received', sessionId: 'valid-session', data: { key: { id: '123' } } };
    const payloadStr = JSON.stringify(payload);
    
    // Generate signature for the original payload
    const signature = makeSignature(payloadStr);

    // Modify the payload slightly
    const modifiedPayloadStr = JSON.stringify({ ...payload, sessionId: 'hacked-session' });

    const res = await request(app)
      .post('/webhooks/wa-akg')
      .set('x-webhook-signature', signature)
      .set('Content-Type', 'application/json')
      .send(modifiedPayloadStr);

    expect(res.status).toBe(401);
  });
});