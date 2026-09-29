/**
 * Structured WhatsApp Lifecycle Logger
 * Standardized events:
 * - MSG_RECEIVED
 * - MSG_QUEUED
 * - AI_REQUEST_START
 * - AI_RESPONSE_RECEIVED
 * - REPLY_SENT
 * - FAILED
 */

export const waLogger = {
  log(traceId, event, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      traceId: traceId || 'no-trace-id',
      event,
      ...data
    };
    const prefix = getEventEmoji(event);
    console.log(`${prefix} [WA:${event}] [trace:${entry.traceId}]`, JSON.stringify(data));
    return entry;
  },

  received(traceId, data) {
    return this.log(traceId, 'MSG_RECEIVED', data);
  },

  queued(traceId, data) {
    return this.log(traceId, 'MSG_QUEUED', data);
  },

  aiRequestStart(traceId, data) {
    return this.log(traceId, 'AI_REQUEST_START', data);
  },

  aiResponseReceived(traceId, data) {
    return this.log(traceId, 'AI_RESPONSE_RECEIVED', data);
  },

  replySent(traceId, data) {
    return this.log(traceId, 'REPLY_SENT', data);
  },

  failed(traceId, data) {
    return this.log(traceId, 'FAILED', data);
  }
};

function getEventEmoji(event) {
  switch (event) {
    case 'MSG_RECEIVED': return '📥';
    case 'MSG_QUEUED': return '⏳';
    case 'AI_REQUEST_START': return '🚀';
    case 'AI_RESPONSE_RECEIVED': return '🧠';
    case 'REPLY_SENT': return '📤';
    case 'FAILED': return '❌';
    default: return 'ℹ️';
  }
}
