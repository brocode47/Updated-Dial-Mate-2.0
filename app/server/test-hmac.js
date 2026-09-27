import express from 'express';
import crypto from 'crypto';
import request from 'supertest';
import { webhooksRouter } from './src/routes/webhooks.js';
import { whatsappQueue } from './src/lib/queues.js';

// Mock queue
whatsappQueue.add = async () => {};

const app = express();
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use('/webhooks', webhooksRouter());

const secret = 'test-secret';
process.env.WA_AKG_WEBHOOK_SECRET = secret;

async function runTests() {
  const payload = JSON.stringify({ event: 'message.received', data: { messageId: '123' } });
  
  // Test 1: Missing signature (should fail 401)
  let res = await request(app).post('/webhooks/wa-akg').send(payload).set('Content-Type', 'application/json');
  console.log('Test 1 Missing Sig:', res.status === 401 ? 'PASS' : `FAIL (${res.status})`);
  
  // Test 2: Invalid signature (should fail 401)
  res = await request(app).post('/webhooks/wa-akg').send(payload).set('Content-Type', 'application/json').set('X-Webhook-Signature', 'sha256=invalid');
  console.log('Test 2 Invalid Sig:', res.status === 401 ? 'PASS' : `FAIL (${res.status})`);
  
  // Test 3: Valid signature (should pass 200)
  const validSig = crypto.createHmac('sha256', secret).update(Buffer.from(payload)).digest('hex');
  res = await request(app)
    .post('/webhooks/wa-akg')
    .send(Buffer.from(payload))
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', `sha256=${validSig}`);
  console.log('Test 3 Valid Sig:', res.status === 200 ? 'PASS' : `FAIL (${res.status})`);
}

runTests().then(() => process.exit(0)).catch(console.error);
