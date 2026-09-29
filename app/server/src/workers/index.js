import 'dotenv/config';
import { Worker } from 'bullmq';
import { connection } from '../lib/redis.js';
import { whatsappDeadLetterQueue } from '../lib/queues.js';

import { processCallJob } from './callWorker.js';
import { processWebhookJob } from './webhookWorker.js';
import { processWhatsAppJob } from './whatsappWorker.js';

console.log('🚀 Starting Background Workers...');

const callWorker = new Worker('callQueue', processCallJob, {
  connection,
  concurrency: 5 // Process up to 5 calls concurrently
});

const webhookWorker = new Worker('webhookQueue', processWebhookJob, {
  connection,
  concurrency: 10 // Handle webhooks slightly faster
});

const whatsappWorker = new Worker('whatsappQueue', processWhatsAppJob, {
  connection,
  concurrency: 1 // Sequential processing to prevent state race conditions
});

// Setup error handlers
callWorker.on('error', err => {
  console.error('❌ [CallWorker] Core error:', err.message);
});

callWorker.on('failed', (job, err) => {
  console.error(`❌ [CallWorker] Job ${job?.id} failed:`, err.message);
});

callWorker.on('completed', job => {
  console.log(`✅ [CallWorker] Job ${job.id} completed successfully`);
});

webhookWorker.on('error', err => {
  console.error('❌ [WebhookWorker] Core error:', err.message);
});

webhookWorker.on('failed', (job, err) => {
  console.error(`❌ [WebhookWorker] Job ${job?.id} failed:`, err.message);
});

webhookWorker.on('completed', job => {
  console.log(`✅ [WebhookWorker] Job ${job.id} completed successfully`);
});

whatsappWorker.on('error', err => {
  console.error('❌ [WhatsAppWorker] Core error:', err.message);
});

whatsappWorker.on('failed', async (job, err) => {
  const attemptsMade = job?.attemptsMade || 1;
  const maxAttempts = job?.opts?.attempts || 3;
  console.error(`❌ [WhatsAppWorker] Job ${job?.id} failed (${attemptsMade}/${maxAttempts}):`, err.message);

  if (job && attemptsMade >= maxAttempts) {
    console.error(`🚨 [WhatsAppWorker] Job ${job.id} exhausted all ${maxAttempts} retries. Enqueueing to Dead Letter Queue.`);
    try {
      await whatsappDeadLetterQueue.add('dead-letter-wa-message', {
        originalJobId: job.id,
        data: job.data,
        failedReason: err.message,
        failedAt: new Date().toISOString(),
        attemptsMade
      });
    } catch (dlqErr) {
      console.error('❌ [WhatsAppWorker] Failed to write to DLQ:', dlqErr.message);
    }
  }
});

whatsappWorker.on('completed', job => {
  console.log(`✅ [WhatsAppWorker] Job ${job.id} completed successfully`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('🛑 Shutting down workers...');
  await callWorker.close();
  await webhookWorker.close();
  await whatsappWorker.close();
  await whatsappDeadLetterQueue.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
