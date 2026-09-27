import { Queue } from 'bullmq';
import { connection } from './redis.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000 // Initial 1s, then 2s, 4s, etc.
  },
  removeOnComplete: {
    age: 24 * 3600 // Keep completed jobs for 24 hours
  },
  removeOnFail: {
    age: 7 * 24 * 3600 // Keep failed jobs for 7 days
  }
};

export const callQueue = new Queue('callQueue', {
  connection,
  defaultJobOptions
});

export const webhookQueue = new Queue('webhookQueue', {
  connection,
  defaultJobOptions
});

export const whatsappQueue = new Queue('whatsappQueue', {
  connection,
  defaultJobOptions
});

// Optional utility to gracefully close queues if needed
export async function closeQueues() {
  await callQueue.close();
  await webhookQueue.close();
  await whatsappQueue.close();
}
