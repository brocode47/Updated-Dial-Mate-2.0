import 'dotenv/config';
import { Worker } from 'bullmq';
import { connection } from '../lib/redis.js';

import { processCallJob } from './callWorker.js';
import { processWebhookJob } from './webhookWorker.js';
import { processWhatsAppJob } from './whatsappWorker.js';

console.log('ðŸš€ Starting Background Workers...');

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
  console.error('âŒ [CallWorker] Core error:', err.message);
});

callWorker.on('failed', (job, err) => {
  console.error(`âŒ [CallWorker] Job ${job?.id} failed:`, err.message);
});

callWorker.on('completed', job => {
  console.log(`âœ… [CallWorker] Job ${job.id} completed successfully`);
});

webhookWorker.on('error', err => {
  console.error('âŒ [WebhookWorker] Core error:', err.message);
});

webhookWorker.on('failed', (job, err) => {
  console.error(`âŒ [WebhookWorker] Job ${job?.id} failed:`, err.message);
});

webhookWorker.on('completed', job => {
  console.log(`âœ… [WebhookWorker] Job ${job.id} completed successfully`);
});

whatsappWorker.on('error', err => {
  console.error('âŒ [WhatsAppWorker] Core error:', err.message);
});

whatsappWorker.on('failed', (job, err) => {
  console.error(`âŒ [WhatsAppWorker] Job ${job?.id} failed:`, err.message);
});

whatsappWorker.on('completed', job => {
  console.log(`âœ… [WhatsAppWorker] Job ${job.id} completed successfully`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('ðŸ›‘ Shutting down workers...');
  await callWorker.close();
  await webhookWorker.close();
  await whatsappWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('ðŸ›‘ Shutting down workers...');
  await callWorker.close();
  await webhookWorker.close();
  await whatsappWorker.close();
  process.exit(0);
});

