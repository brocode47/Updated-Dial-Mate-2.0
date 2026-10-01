/**
 * AI Call Interpretation Service for Dial Mate 2.0
 * 
 * Classifies customer responses and telephony outcomes into structured confirmation decisions.
 * 
 * Target Results:
 * - CONFIRMED: Customer explicitly approved order dispatch.
 * - REJECTED: Customer requested cancellation.
 * - CALLBACK_REQUESTED: Customer requested a later call.
 * - NO_ANSWER: Call rang without pickup.
 * - BUSY: Callee line was busy.
 * - FAILED: Telephony network error or unallocated number.
 * - UNKNOWN: Indeterminate or ambiguous response requiring human review.
 */

export class AICallInterpretationService {
  /**
   * Helper to accurately detect customer response language
   */
  static detectLanguage(text = '', fallback = 'roman_urdu') {
    if (/[\u0600-\u06FF]/.test(text)) {
      return 'urdu';
    }
    const romanUrduMarkers = /\b(ji|jee|bilkul|haan|han|bhej|bhejdein|bhej dein|bhejo|dein|kardo|kar do|karna|nahi|nhi|nh|nahin|theek|sahi|hai|hain|mat|mujhe|yeh|baad|mein|me|busy|hoon|hu|masroof|shaam|kal|phir|thori|der|bhai|ap|aap|ka|ki|ke|ko|karo)\b/i;
    if (romanUrduMarkers.test(text)) {
      return 'roman_urdu';
    }
    const englishMarkers = /\b(yes|confirm|confirmed|cancel|please|send|deliver|order|wrong|fake|dont|do not)\b/i;
    if (englishMarkers.test(text)) {
      return 'english';
    }
    return fallback;
  }

  /**
   * Deterministic pattern classification for fast, zero-latency evaluation
   */
  static classifyText(text = '', language = 'roman_urdu') {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) {
      return {
        result: 'UNKNOWN',
        confidence: 0.0,
        language,
        reason: 'Empty customer utterance',
        callbackRequestedMinutes: null
      };
    }

    const detectedLanguage = this.detectLanguage(raw, language);

    // 1. Rejection / Cancellation patterns
    const rejectPatterns = [
      /\b(cancel|cancel kar do|cancel kardo|nahi chahiye|nh chahiye|mat bhejo|nhi chahiye|mat bhein|mana kar diya|galti se|order cancel)\b/i,
      /\b(do not send|dont send|cancel order|wrong order|fake order)\b/i,
      /(منسوخ|کینسل|نہیں چاہیے|مت بھیجو|کینسل کر دیں|کینسل کردیں)/i
    ];

    for (const pattern of rejectPatterns) {
      if (pattern.test(raw)) {
        return {
          result: 'CANCELLED',
          confidence: 0.98,
          language: detectedLanguage,
          reason: `Matched cancellation pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // 2. Callback requested patterns
    const callbackPatterns = [
      /\b(baad me|baad mein|busy hoon|busy hu|masroof|shaam ko|shaam me|kal call|phir call|thori der baad|after some time|call back|call later)\b/i,
      /(بعد میں|مصروف ہوں|شام کو|کل کال کریں|دوبارہ کال)/i
    ];

    for (const pattern of callbackPatterns) {
      if (pattern.test(raw)) {
        // Extract delay if specified (e.g. "1 ghante baad", "shaam ko")
        let delayMinutes = 60; // Default 1 hour
        if (/\b(shaam|evening)\b/i.test(raw)) delayMinutes = 180;
        if (/\b(kal|tomorrow)\b/i.test(raw)) delayMinutes = 1440;
        if (/\b(15|20|30)\b/.test(raw)) delayMinutes = 30;

        return {
          result: 'CALLBACK_REQUESTED',
          confidence: 0.95,
          language: detectedLanguage,
          reason: `Customer requested callback: ${pattern.source}`,
          callbackRequestedMinutes: delayMinutes
        };
      }
    }

    // 3. Confirmation patterns
    const confirmPatterns = [
      /\b(jee|ji|haan|bhej do|bhejdein|bhej dein|theek hai|confirm|bhejo|sahi hai|ok hai|pakka bhej do|han bhej do)\b/i,
      /\b(yes|confirm|confirmed|send it|please deliver|go ahead|proceed)\b/i,
      /(جی بالکل|کنفرم|بھیج دیں|ٹھیک ہے|ہاں بھیج دیں|بھیجو)/i
    ];

    for (const pattern of confirmPatterns) {
      if (pattern.test(raw)) {
        return {
          result: 'CONFIRMED',
          confidence: 0.96,
          language: detectedLanguage,
          reason: `Matched confirmation pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // 4. Ambiguous / Indeterminate
    return {
      result: 'UNKNOWN',
      confidence: 0.4,
      language: detectedLanguage,
      reason: 'Utterance did not match confident confirmation or rejection pattern',
      callbackRequestedMinutes: null
    };
  }

  /**
   * Evaluates telephony call status into structured outcome
   */
  static interpretCallStatus(callStatus = '') {
    const s = String(callStatus).toLowerCase().trim();

    switch (s) {
      case 'completed':
        return { result: 'COMPLETED', confidence: 1.0, isTerminalFailure: false };
      case 'busy':
        return { result: 'BUSY', confidence: 1.0, isTerminalFailure: false };
      case 'no-answer':
        return { result: 'NO_ANSWER', confidence: 1.0, isTerminalFailure: false };
      case 'failed':
      case 'canceled':
      case 'cancelled':
        return { result: 'FAILED', confidence: 1.0, isTerminalFailure: true };
      default:
        return { result: 'UNKNOWN', confidence: 0.5, isTerminalFailure: false };
    }
  }

  /**
   * Main interpretation entrypoint combining telephony events, DTMF digits, and AI dialogue
   * 
   * @param {Object} input
   * @param {string} [input.digits] - DTMF digits pressed by customer ('1' or '2')
   * @param {string} [input.transcript] - Call transcript or utterance
   * @param {string} [input.toolExecuted] - Direct AI tool called ('confirm_order', 'cancel_order', 'schedule_callback')
   * @param {string} [input.callStatus] - Twilio status ('completed', 'busy', 'no-answer', 'failed')
   * @returns {Object} Structured decision contract
   */
  static interpret({ digits, transcript, speechText, toolExecuted, callStatus, telephonyStatus, callDurationSec }) {
    const effectiveTranscript = transcript || speechText;
    const effectiveCallStatus = callStatus || telephonyStatus;

    // 1. Direct AI agent tool execution takes top priority
    if (toolExecuted === 'confirm_order') {
      return {
        result: 'CONFIRMED',
        confidence: 1.0,
        source: 'AI_TOOL_EXECUTION',
        reason: 'Customer explicitly confirmed order via conversational agent'
      };
    }

    if (toolExecuted === 'cancel_order') {
      return {
        result: 'CANCELLED',
        confidence: 1.0,
        source: 'AI_TOOL_EXECUTION',
        reason: 'Customer requested order cancellation via conversational agent'
      };
    }

    if (toolExecuted === 'schedule_callback') {
      return {
        result: 'CALLBACK_REQUESTED',
        confidence: 1.0,
        source: 'AI_TOOL_EXECUTION',
        reason: 'Customer requested callback via conversational agent'
      };
    }

    // 2. DTMF keypad input (reliable IVR response)
    if (digits === '1') {
      return {
        result: 'CONFIRMED',
        confidence: 1.0,
        source: 'DTMF_KEYPAD',
        reason: 'Customer pressed 1 on telephone keypad to confirm order'
      };
    }

    if (digits === '2') {
      return {
        result: 'CANCELLED',
        confidence: 1.0,
        source: 'DTMF_KEYPAD',
        reason: 'Customer pressed 2 on telephone keypad to cancel order'
      };
    }

    // 3. Transcript / NLP interpretation
    if (effectiveTranscript && effectiveTranscript.trim()) {
      const nlpDecision = this.classifyText(effectiveTranscript);
      if (nlpDecision.confidence >= 0.85) {
        return {
          ...nlpDecision,
          source: 'TRANSCRIPT_NLP'
        };
      }
      if (nlpDecision.result === 'CALLBACK_REQUESTED') {
        return {
          ...nlpDecision,
          source: 'TRANSCRIPT_NLP'
        };
      }
    }

    // 4. Telephony failure statuses (busy, no-answer, failed)
    if (effectiveCallStatus && ['busy', 'no-answer', 'failed', 'canceled'].includes(effectiveCallStatus.toLowerCase())) {
      const statusDecision = this.interpretCallStatus(effectiveCallStatus);
      return {
        result: statusDecision.result,
        confidence: 1.0,
        source: 'TWILIO_STATUS',
        reason: `Telephony ended with status ${effectiveCallStatus}`
      };
    }

    // 5. Safe fallback
    return {
      result: 'UNKNOWN',
      confidence: 0.0,
      source: 'FALLBACK',
      reason: 'Could not confidently determine customer decision; safe human review recommended'
    };
  }
}

export const aiCallInterpretationService = AICallInterpretationService;
export default AICallInterpretationService;
