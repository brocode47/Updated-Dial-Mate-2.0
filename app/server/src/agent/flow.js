// Urdu-first call flow helpers.
// Current system uses Twilio IVR: 1 = Confirm, 2 = Cancel.
// This file is ready for future ASR / LLM / TTS expansion.

export function buildSystemPrompt({ shopName = 'the store', policiesSummary = '' } = {}) {
  return `
You are Dial Mate, an Urdu-first AI order confirmation agent for ${shopName}.

Rules:
- Speak politely in natural Urdu.
- Keep responses short and clear.
- Confirm the customer's order.
- If customer confirms, mark order Confirmed.
- If customer cancels, mark order Cancelled.
- If customer asks for delivery, explain estimated delivery if available.
- If customer is angry, confused, or asks something sensitive, suggest human support.
- Never make promises about refunds, delivery dates, or discounts unless provided in store policy.
- Never ask for OTP, card number, password, or private account information.

Available policies:
${policiesSummary || 'No store policies provided yet.'}
`.trim();
}

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ');
}

export function detectIntent(text) {
  const t = normalizeText(text);

  const cancelWords = [
    'cancel',
    'cancel karo',
    'cancel kar',
    'nahi chahiye',
    'order nahi chahiye',
    'ghalti se',
    'galti se',
    'mansookh'
  ];

  const confirmWords = [
    'confirm',
    'ok',
    'okay',
    'theek',
    'theek hai',
    'haan',
    'han',
    'yes',
    'ji',
    'bilkul',
    'kar dein',
    'bhej dein'
  ];

  const rescheduleWords = [
    'baad',
    'baad mein',
    'shaam',
    'kal',
    'reschedule',
    'dobara call',
    'later',
    'evening',
    'morning'
  ];

  const editWords = [
    'change',
    'tabdeel',
    'size',
    'color',
    'colour',
    'address',
    'phone',
    'quantity',
    'variant'
  ];

  if (cancelWords.some((word) => t.includes(word))) return 'Cancel';
  if (confirmWords.some((word) => t.includes(word))) return 'Confirm';
  if (rescheduleWords.some((word) => t.includes(word))) return 'Reschedule';
  if (editWords.some((word) => t.includes(word))) return 'Edit';

  return 'Unknown';
}

export function detectSentiment(text) {
  const t = normalizeText(text);

  const negativeWords = [
    'ghalat',
    'galat',
    'bakwas',
    'fraud',
    'scam',
    'angry',
    'naraz',
    'naraaz',
    'complaint',
    'shikayat',
    'fake'
  ];

  const positiveWords = [
    'shukriya',
    'thank',
    'thanks',
    'theek',
    'acha',
    'accha',
    'good',
    'best',
    'bilkul'
  ];

  if (negativeWords.some((word) => t.includes(word))) return 'Negative';
  if (positiveWords.some((word) => t.includes(word))) return 'Positive';

  return 'Neutral';
}

export function shouldEscalateToHuman({ intent, sentiment, confidence = 1 } = {}) {
  if (sentiment === 'Negative') return true;
  if (intent === 'Unknown' && confidence < 0.6) return true;
  if (confidence < 0.4) return true;

  return false;
}

export function mapDigitToIntent(digit) {
  if (String(digit) === '1') return 'Confirm';
  if (String(digit) === '2') return 'Cancel';
  return 'Unknown';
}

export function mapIntentToOrderStatus(intent) {
  if (intent === 'Confirm') {
    return {
      status: 'Confirmed',
      tag: 'Confirmed'
    };
  }

  if (intent === 'Cancel') {
    return {
      status: 'Cancelled',
      tag: 'Cancelled'
    };
  }

  if (intent === 'Reschedule') {
    return {
      status: 'Reschedule Requested',
      tag: 'Reschedule'
    };
  }

  if (intent === 'Edit') {
    return {
      status: 'Needs Review',
      tag: 'Edit Requested'
    };
  }

  return {
    status: 'No Response',
    tag: 'No Response'
  };
}