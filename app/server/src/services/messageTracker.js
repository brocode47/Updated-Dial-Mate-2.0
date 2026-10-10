import { redis } from '../lib/redis.js';

const MSG_TRACK_PREFIX = 'wa:msg:state:';
const PROCESSING_TTL_SECONDS = 180; // 3 minutes max processing lease
const COMPLETED_TTL_SECONDS = 86400; // 24 hours completed state retention
const FAILED_TTL_SECONDS = 86400;    // 24 hours permanent failure retention

// In-memory fallback if Redis is unavailable
const memoryFallback = new Map();

function cleanMemoryFallback() {
  const now = Date.now();
  for (const [key, val] of memoryFallback.entries()) {
    if (val.expiresAt < now) {
      memoryFallback.delete(key);
    }
  }
}

export const MessageTrackerService = {
  /**
   * Check if a message has already been completed or permanently failed
   */
  async isAlreadyProcessed(messageId) {
    if (!messageId) return false;
    const key = `${MSG_TRACK_PREFIX}${messageId}`;

    try {
      if (redis.status === 'ready' || redis.status === 'connect') {
        const state = await redis.get(key);
        return state === 'COMPLETED' || state === 'PROCESSING' || state === 'FAILED';
      }
    } catch (err) {
      console.warn('⚠️ [MessageTracker] Redis read error, using memory fallback:', err.message);
    }

    // Memory fallback
    cleanMemoryFallback();
    const entry = memoryFallback.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.state === 'COMPLETED' || entry.state === 'PROCESSING' || entry.state === 'FAILED';
    }
    return false;
  },

  /**
   * Atomically mark a message as PROCESSING with a bounded lease (180s).
   * Returns true if successfully claimed, false if already claimed/processing/completed.
   */
  async markProcessing(messageId, metadata = {}) {
    if (!messageId) return true;
    const key = `${MSG_TRACK_PREFIX}${messageId}`;

    try {
      if (redis.status === 'ready' || redis.status === 'connect') {
        // SET NX: Only claim if key does not exist (not in PROCESSING, COMPLETED, or FAILED)
        const result = await redis.set(key, 'PROCESSING', 'NX', 'EX', PROCESSING_TTL_SECONDS);
        return result === 'OK';
      }
    } catch (err) {
      console.warn('⚠️ [MessageTracker] Redis set NX error, using memory fallback:', err.message);
    }

    // Memory fallback
    cleanMemoryFallback();
    const existing = memoryFallback.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return false; // Already claimed or completed
    }
    memoryFallback.set(key, { state: 'PROCESSING', expiresAt: Date.now() + PROCESSING_TTL_SECONDS * 1000 });
    return true;
  },

  /**
   * Mark message as COMPLETED with 24-hour retention
   */
  async markCompleted(messageId, metadata = {}) {
    if (!messageId) return;
    const key = `${MSG_TRACK_PREFIX}${messageId}`;

    try {
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.set(key, 'COMPLETED', 'EX', COMPLETED_TTL_SECONDS);
        return;
      }
    } catch (err) {
      console.warn('⚠️ [MessageTracker] Redis markCompleted error:', err.message);
    }

    memoryFallback.set(key, { state: 'COMPLETED', expiresAt: Date.now() + COMPLETED_TTL_SECONDS * 1000 });
  },

  /**
   * Handle failure: if recoverable, clear processing state so retry can re-process immediately.
   * If unrecoverable, mark as FAILED for 24 hours.
   */
  async handleFailure(messageId, recoverable = false) {
    if (!messageId) return;
    const key = `${MSG_TRACK_PREFIX}${messageId}`;

    try {
      if (redis.status === 'ready' || redis.status === 'connect') {
        if (recoverable) {
          await redis.del(key);
        } else {
          await redis.set(key, 'FAILED', 'EX', FAILED_TTL_SECONDS);
        }
        return;
      }
    } catch (err) {
      console.warn('⚠️ [MessageTracker] Redis failure cleanup error:', err.message);
    }

    if (recoverable) {
      memoryFallback.delete(key);
    } else {
      memoryFallback.set(key, { state: 'FAILED', expiresAt: Date.now() + FAILED_TTL_SECONDS * 1000 });
    }
  },

  /**
   * Reset tracking state for a message (used by test suites)
   */
  async reset(messageId) {
    if (!messageId) return;
    const key = `${MSG_TRACK_PREFIX}${messageId}`;
    try {
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.del(key);
      }
    } catch (_) {}
    memoryFallback.delete(key);
  }
};
