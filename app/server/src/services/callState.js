import { redis } from '../lib/redis.js';

const CALL_STATE_PREFIX = 'call_state:';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export const CallStateService = {
  async save(callSid, state) {
    if (!callSid) return;
    const key = `${CALL_STATE_PREFIX}${callSid}`;
    await redis.set(key, JSON.stringify(state), 'EX', DEFAULT_TTL_SECONDS);
  },

  async load(callSid) {
    if (!callSid) return null;
    const key = `${CALL_STATE_PREFIX}${callSid}`;
    const data = await redis.get(key);
    if (!data) return null;
    
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error(`❌ Failed to parse call state for ${callSid}:`, e);
      return null;
    }
  },

  async clear(callSid) {
    if (!callSid) return;
    const key = `${CALL_STATE_PREFIX}${callSid}`;
    await redis.del(key);
  }
};
