import { redis } from '../lib/redis.js';

const CHAT_STATE_PREFIX = 'wa_chat:';
const DEFAULT_TTL_SECONDS = 86400; // 24 hours for chat memory

export const ChatStateService = {
  async save(chatKey, history) {
    if (!chatKey) return;
    const key = `${CHAT_STATE_PREFIX}${chatKey}`;
    // History can be relatively large, so setting a 24-hour expiration
    await redis.set(key, JSON.stringify(history), 'EX', DEFAULT_TTL_SECONDS);
  },

  async load(chatKey) {
    if (!chatKey) return null;
    const key = `${CHAT_STATE_PREFIX}${chatKey}`;
    const data = await redis.get(key);
    if (!data) return null;
    
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error(`?O Failed to parse chat state for ${chatKey}:`, e);
      return null;
    }
  },

  async clear(chatKey) {
    if (!chatKey) return;
    const key = `${CHAT_STATE_PREFIX}${chatKey}`;
    await redis.del(key);
  }
};
