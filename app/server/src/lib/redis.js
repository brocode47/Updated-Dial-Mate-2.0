import Redis from 'ioredis';

let REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
if (REDIS_URL.includes('redis:6379')) {
  REDIS_URL = REDIS_URL.replace('redis:6379', 'localhost:6379');
}

// Singleton Redis connection for general app use
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false
});

// A separate connection is often recommended for BullMQ workers vs queue management
export const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

redis.on('error', (err) => {
  console.warn('⚠️ Redis Connection Error:', err.message);
});

connection.on('error', (err) => {
  console.warn('⚠️ BullMQ Redis Error:', err.message);
});

redis.on('ready', () => {
  console.log('✅ Connected to Redis successfully');
});
