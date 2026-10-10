import { redis } from '../lib/redis.js';
import crypto from 'crypto';

/**
 * ============================================================================
 * CONVERSATION LOCK SERVICE — PER-CONVERSATION MUTEX & SERIALIZATION
 * ============================================================================
 *
 * Guarantees:
 * 1. Per-conversation serialization: Messages for the same customer (shopId + phone)
 *    are processed sequentially, preventing race conditions and stale state overwrites.
 * 2. Multi-customer concurrency: Independent customers are processed in parallel without blocking.
 * 3. Bounded wait & automatic TTL: Worker crashes or timeouts cannot cause deadlocks.
 * 4. Atomic release: Uses Lua script in Redis so expired locks are never released by a delayed job.
 * 5. Robust in-memory fallback: Provides zero-dependency in-memory queueing when Redis is offline.
 */

const LOCK_PREFIX = 'conv_lock:';
const DEFAULT_TTL_MS = 15000;      // 15 seconds max lock lease
const DEFAULT_MAX_WAIT_MS = 8000;   // 8 seconds max wait for preceding turn
const DEFAULT_POLL_INTERVAL_MS = 150; // 150ms polling backoff

// In-memory mutex table for fallback / testing
const memoryLocks = new Map();

function cleanMemoryLocks() {
  const now = Date.now();
  for (const [key, lock] of memoryLocks.entries()) {
    if (lock.expiresAt <= now) {
      // Wake up next waiter if any
      if (lock.waiters && lock.waiters.length > 0) {
        const next = lock.waiters.shift();
        const fn = typeof next === 'function' ? next : next?.callback;
        const newToken = crypto.randomUUID();
        memoryLocks.set(key, {
          token: newToken,
          expiresAt: Date.now() + (lock.ttlMs || DEFAULT_TTL_MS),
          waiters: lock.waiters
        });
        if (fn) fn(newToken);
      } else {
        memoryLocks.delete(key);
      }
    }
  }
}

export class ConversationLockService {
  /**
   * Generates a unique lock key for a shop + customer
   *
   * @param {string} shopId
   * @param {string} phone
   * @returns {string}
   */
  static getLockKey(shopId, phone) {
    const cleanShop = String(shopId || 'default').trim().toLowerCase();
    const cleanPhone = String(phone || 'unknown').replace(/[^0-9]/g, '');
    return `${cleanShop}:${cleanPhone}`;
  }

  /**
   * Acquires a distributed lock for a specific conversation
   *
   * @param {string} conversationKey - Identifier (e.g. "shop123:923001234567")
   * @param {object} [options]
   * @param {number} [options.ttlMs=15000] - Lock expiration in milliseconds
   * @param {number} [options.maxWaitMs=8000] - Maximum duration to wait before timing out
   * @param {number} [options.pollIntervalMs=150] - Polling interval while waiting
   * @returns {Promise<{ acquired: boolean, token: string|null, lockKey: string, timeout?: boolean }>}
   */
  static async acquireLock(conversationKey, options = {}) {
    if (!conversationKey) {
      return { acquired: false, token: null, lockKey: '' };
    }

    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const maxWaitMs = options.maxWaitMs || DEFAULT_MAX_WAIT_MS;
    const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    const lockKey = `${LOCK_PREFIX}${conversationKey}`;
    const token = crypto.randomUUID();
    const startTime = Date.now();
    const seqScore = Number(options.messageTimestamp) || startTime;

    const isRedisReady = redis && (redis.status === 'ready' || redis.status === 'connect');
    const isStrict = options.strictDistributed ?? (process.env.NODE_ENV === 'production' && process.env.ALLOW_IN_MEMORY_LOCK !== 'true');

    if (isRedisReady) {
      const queueKey = `${lockKey}:queue`;
      try {
        // Enqueue into Redis sorted set with timestamp score for strict FIFO / sequence ordering
        await redis.zadd(queueKey, seqScore, token);
        await redis.expire(queueKey, Math.ceil(maxWaitMs / 1000) + 15);
      } catch (_) {}

      while (Date.now() - startTime < maxWaitMs) {
        try {
          // Check if this token is at the head of the waiter queue
          const head = await redis.zrange(queueKey, 0, 0);
          const isAtHead = !head || head.length === 0 || head[0] === token;

          if (isAtHead) {
            // SET key token PX ttl NX
            const result = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
            if (result === 'OK') {
              await redis.zrem(queueKey, token).catch(() => {});
              return { acquired: true, token, lockKey };
            }
          }
        } catch (err) {
          console.warn(`⚠️ [ConversationLockService] Redis lock attempt error: ${err.message}`);
          if (isStrict) {
            await redis.zrem(queueKey, token).catch(() => {});
            throw new Error(`[ConversationLockService] Redis error in strict distributed mode: ${err.message}`);
          }
          break; // Fallback to memory
        }

        // Wait before next attempt
        await new Promise(r => setTimeout(r, pollIntervalMs));
      }

      // Cleanup from waiter queue on timeout
      try {
        await redis.zrem(queueKey, token);
      } catch (_) {}

      // If Redis timed out
      return { acquired: false, token: null, lockKey, timeout: true };
    }

    if (isStrict) {
      throw new Error(`[ConversationLockService] Distributed lock unavailable (Redis offline) in strict/production mode for key: ${conversationKey}`);
    }

    // =========================================================================
    // IN-MEMORY MUTEX FALLBACK (TIMESTAMP ORDERED)
    // =========================================================================
    cleanMemoryLocks();
    const now = Date.now();
    const existing = memoryLocks.get(lockKey);

    if (!existing || existing.expiresAt <= now) {
      memoryLocks.set(lockKey, {
        token,
        expiresAt: now + ttlMs,
        ttlMs,
        waiters: []
      });
      return { acquired: true, token, lockKey };
    }

    // Wait in queue ordered by message timestamp
    return new Promise((resolve) => {
      let resolved = false;

      const waiterItem = {
        timestamp: seqScore,
        callback: (assignedToken) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutTimer);
            resolve({ acquired: true, token: assignedToken, lockKey });
          }
        }
      };

      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Remove from waiters if still present
          const cur = memoryLocks.get(lockKey);
          if (cur && cur.waiters) {
            cur.waiters = cur.waiters.filter(w => w !== waiterItem);
          }
          resolve({ acquired: false, token: null, lockKey, timeout: true });
        }
      }, maxWaitMs);

      existing.waiters.push(waiterItem);
      existing.waiters.sort((a, b) => a.timestamp - b.timestamp);
    });
  }

  /**
   * Renews an existing lock lease (heartbeat)
   *
   * @param {string} conversationKey
   * @param {string} token
   * @param {number} [ttlMs=15000]
   * @returns {Promise<boolean>}
   */
  static async renewLock(conversationKey, token, ttlMs = DEFAULT_TTL_MS) {
    if (!conversationKey || !token) return false;
    const lockKey = conversationKey.startsWith(LOCK_PREFIX) ? conversationKey : `${LOCK_PREFIX}${conversationKey}`;

    const isRedisReady = redis && (redis.status === 'ready' || redis.status === 'connect');

    if (isRedisReady) {
      try {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("pexpire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        const result = await redis.eval(luaScript, 1, lockKey, token, String(ttlMs));
        return result === 1;
      } catch (err) {
        console.warn(`⚠️ [ConversationLockService] Redis renew error: ${err.message}`);
        return false;
      }
    }

    // In-memory renewal
    const existing = memoryLocks.get(lockKey);
    if (existing && existing.token === token && existing.expiresAt > Date.now()) {
      existing.expiresAt = Date.now() + ttlMs;
      existing.ttlMs = ttlMs;
      return true;
    }
    return false;
  }

  /**
   * Checks whether a lock is currently held by a specific token
   *
   * @param {string} conversationKey
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  static async isLockHeld(conversationKey, token) {
    if (!conversationKey || !token) return false;
    const lockKey = conversationKey.startsWith(LOCK_PREFIX) ? conversationKey : `${LOCK_PREFIX}${conversationKey}`;

    const isRedisReady = redis && (redis.status === 'ready' || redis.status === 'connect');
    if (isRedisReady) {
      try {
        const currentToken = await redis.get(lockKey);
        return currentToken === token;
      } catch (_) {
        return false;
      }
    }

    const existing = memoryLocks.get(lockKey);
    return Boolean(existing && existing.token === token && existing.expiresAt > Date.now());
  }

  /**
   * Releases a distributed lock using atomic Lua script (Redis) or memory check
   *
   * @param {string} conversationKey
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  static async releaseLock(conversationKey, token) {
    if (!conversationKey || !token) return false;
    const lockKey = conversationKey.startsWith(LOCK_PREFIX) ? conversationKey : `${LOCK_PREFIX}${conversationKey}`;

    const isRedisReady = redis && (redis.status === 'ready' || redis.status === 'connect');

    if (isRedisReady) {
      try {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        const result = await redis.eval(luaScript, 1, lockKey, token);
        return result === 1;
      } catch (err) {
        console.warn(`⚠️ [ConversationLockService] Redis release error: ${err.message}`);
      }
    }

    // In-memory release
    cleanMemoryLocks();
    const existing = memoryLocks.get(lockKey);
    if (existing && existing.token === token) {
      if (existing.waiters && existing.waiters.length > 0) {
        const next = existing.waiters.shift();
        const fn = typeof next === 'function' ? next : next?.callback;
        const newToken = crypto.randomUUID();
        memoryLocks.set(lockKey, {
          token: newToken,
          expiresAt: Date.now() + (existing.ttlMs || DEFAULT_TTL_MS),
          waiters: existing.waiters
        });
        if (fn) fn(newToken);
      } else {
        memoryLocks.delete(lockKey);
      }
      return true;
    }

    return false;
  }

  /**
   * Helper to execute an async action inside a safe, bounded conversation lock with auto-renewing lease
   *
   * @param {string} conversationKey
   * @param {(lockContext: { token: string, lockKey: string, isLocked: () => boolean }) => Promise<any>} fn
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  static async withLock(conversationKey, fn, options = {}) {
    const lock = await this.acquireLock(conversationKey, options);
    if (!lock.acquired) {
      throw new Error(`[ConversationLockService] Could not acquire lock for ${conversationKey} within ${options.maxWaitMs || DEFAULT_MAX_WAIT_MS}ms`);
    }

    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const renewIntervalMs = options.renewIntervalMs || Math.max(1000, Math.floor(ttlMs / 3));
    let isLost = false;

    // Background lease renewal (heartbeat)
    const renewalTimer = setInterval(async () => {
      if (isLost) return;
      try {
        const renewed = await ConversationLockService.renewLock(conversationKey, lock.token, ttlMs);
        if (!renewed) {
          isLost = true;
          console.warn(`⚠️ [ConversationLockService] Lock renewal failed for ${conversationKey}. Lock lost or expired.`);
        }
      } catch (err) {
        isLost = true;
      }
    }, renewIntervalMs);

    const lockContext = {
      token: lock.token,
      lockKey: lock.lockKey,
      isLocked: () => !isLost
    };

    try {
      return await fn(lockContext);
    } finally {
      clearInterval(renewalTimer);
      await this.releaseLock(conversationKey, lock.token);
    }
  }

  /**
   * Clear in-memory locks (useful for test teardown)
   */
  static clearMemory() {
    memoryLocks.clear();
  }
}

export default ConversationLockService;
