/**
 * AI Call Interpretation Service for Dial Mate 2.0
 * 
 * Classifies customer responses, dialogue transcripts, and telephony outcomes
 * into structured confirmation decisions and emotional analytics.
 * 
 * Target Intents:
 * - CONFIRMED: Customer explicitly approved order dispatch.
 * - CANCELLED: Customer requested order cancellation.
 * - CALL_BACK: Customer was busy or requested a later call.
 * - WRONG_NUMBER: Callee stated wrong person or order never placed.
 * - UNKNOWN: Indeterminate or ambiguous response requiring merchant review.
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
   * Detect customer sentiment / emotion from speech text
   */
  static detectEmotion(text = '') {
    const raw = String(text || '').toLowerCase();
    if (!raw) return 'Neutral';

    // Frustrated / Angry markers
    if (/\b(bakwas|bakwaas|tang mat karo|dimagh mat khao|gussa|stop calling|harass|angry|annoyed|bad service|fraud)\b/i.test(raw)) {
      return 'Frustrated';
    }

    // Busy markers
    if (/\b(busy|masroof|driving|meeting|office|baad mein|after some time|later)\b/i.test(raw)) {
      return 'Busy';
    }

    // Hesitant markers
    if (/\b(shayad|pata nahi|dekh kar|soch kar|sochta hoon|not sure|confused|maybe)\b/i.test(raw)) {
      return 'Hesitant';
    }

    // Positive markers
    if (/\b(bohat shukriya|great|shukriya|bilkul|zaroor|jaldi bhej do|perfect|excellent|haan jee|jee haan)\b/i.test(raw)) {
      return 'Positive';
    }

    return 'Neutral';
  }

  /**
   * Deterministic pattern classification for fast, zero-latency evaluation
   */
  static classifyText(text = '', language = 'roman_urdu') {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) {
      return {
        intent: 'UNKNOWN',
        result: 'UNKNOWN',
        confidence: 0.0,
        language,
        summary: 'No customer utterance recorded',
        customerEmotion: 'Neutral',
        reason: 'Empty customer utterance',
        callbackRequestedMinutes: null
      };
    }

    const detectedLanguage = this.detectLanguage(raw, language);
    const customerEmotion = this.detectEmotion(raw);

    // 1. Wrong Number / Identity Mismatch
    const wrongNumberPatterns = [
      /\b(wrong number|ghalat number|galat number|wrong person|maine order nahi kiya|main nahi hoon|kisi aur ka hai|not my order|fake order|maine nahi mangwaya)\b/i,
      /(غلط نمبر|میں نہیں ہوں|میرا آرڈر نہیں)/i
    ];
    for (const pattern of wrongNumberPatterns) {
      if (pattern.test(raw)) {
        return {
          intent: 'WRONG_NUMBER',
          result: 'WRONG_NUMBER',
          confidence: 0.98,
          language: detectedLanguage,
          summary: 'Customer stated this is a wrong number or order was not placed by them',
          customerEmotion,
          reason: `Matched wrong number pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // 2. Rejection / Cancellation patterns
    const rejectPatterns = [
      /\b(cancel|cancel kar do|cancel kardo|nahi chahiye|nh chahiye|mat bhejo|nhi chahiye|mat bhein|mana kar diya|galti se|order cancel)\b/i,
      /\b(do not send|dont send|cancel order|decline)\b/i,
      /(منسوخ|کینسل|نہیں چاہیے|مت بھیجو|کینسل کر دیں|کینسل کردیں)/i
    ];
    for (const pattern of rejectPatterns) {
      if (pattern.test(raw)) {
        return {
          intent: 'CANCELLED',
          result: 'CANCELLED',
          confidence: 0.98,
          language: detectedLanguage,
          summary: 'Customer explicitly requested cancellation of the order',
          customerEmotion,
          reason: `Matched cancellation pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // 3. Callback requested patterns
    const callbackPatterns = [
      /\b(baad me|baad mein|busy hoon|busy hu|masroof|shaam ko|shaam me|kal call|phir call|thori der baad|after some time|call back|call later)\b/i,
      /(بعد میں|مصروف ہوں|شام کو|کل کال کریں|دوبارہ کال)/i
    ];
    for (const pattern of callbackPatterns) {
      if (pattern.test(raw)) {
        let delayMinutes = 60; // Default 1 hour
        if (/\b(shaam|evening)\b/i.test(raw)) delayMinutes = 180;
        if (/\b(kal|tomorrow)\b/i.test(raw)) delayMinutes = 1440;
        if (/\b(15|20|30)\b/.test(raw)) delayMinutes = 30;

        return {
          intent: 'CALL_BACK',
          result: 'CALLBACK_REQUESTED',
          confidence: 0.95,
          language: detectedLanguage,
          summary: `Customer is busy and requested a callback in approximately ${delayMinutes} minutes`,
          customerEmotion: 'Busy',
          reason: `Customer requested callback: ${pattern.source}`,
          callbackRequestedMinutes: delayMinutes
        };
      }
    }

    // 4. Confirmation patterns
    const confirmPatterns = [
      /\b(jee|ji|haan|bhej do|bhejdein|bhej dein|theek hai|confirm|bhejo|sahi hai|ok hai|pakka bhej do|han bhej do)\b/i,
      /\b(yes|confirm|confirmed|send it|please deliver|go ahead|proceed)\b/i,
      /(جی بالکل|کنفرم|بھیج دیں|ٹھیک ہے|ہاں بھیج دیں|بھیجو)/i
    ];
    for (const pattern of confirmPatterns) {
      if (pattern.test(raw)) {
        return {
          intent: 'CONFIRMED',
          result: 'CONFIRMED',
          confidence: 0.96,
          language: detectedLanguage,
          summary: 'Customer confirmed order delivery and accepted Cash on Delivery total',
          customerEmotion: customerEmotion === 'Neutral' ? 'Positive' : customerEmotion,
          reason: `Matched confirmation pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // 5. Ambiguous / Indeterminate
    return {
      intent: 'UNKNOWN',
      result: 'UNKNOWN',
      confidence: 0.4,
      language: detectedLanguage,
      summary: 'Customer response was ambiguous; requires human merchant verification',
      customerEmotion,
      reason: 'Utterance did not match confident confirmation or rejection pattern',
      callbackRequestedMinutes: null
    };
  }

  /**
   * Async conversational interpretation entrypoint
   */
  static async interpretConversation({ transcript, speechText, digits, toolExecuted, callStatus, callDurationSec = 0 }) {
    return this.interpret({ transcript, speechText, digits, toolExecuted, callStatus });
  }

  /**
   * Main interpretation entrypoint combining telephony events, DTMF digits, and AI dialogue
   */
  static interpret({ digits, transcript, speechText, toolExecuted, callStatus, telephonyStatus }) {
    const effectiveTranscript = transcript || speechText;
    const effectiveCallStatus = callStatus || telephonyStatus;

    // 1. Direct AI agent tool execution takes top priority
    if (toolExecuted === 'confirm_order') {
      return {
        intent: 'CONFIRMED',
        result: 'CONFIRMED',
        confidence: 1.0,
        source: 'AI_TOOL_EXECUTION',
        summary: 'Customer confirmed delivery via conversational AI agent',
        customerEmotion: 'Positive',
        reason: 'Customer explicitly confirmed order via conversational agent'
      };
    }

    if (toolExecuted === 'cancel_order') {
      return {
        intent: 'CANCELLED',
        result: 'CANCELLED',
        confidence: 1.0,
        source: 'AI_TOOL_EXECUTION',
        summary: 'Customer requested order cancellation via conversational AI agent',
        customerEmotion: 'Neutral',
        reason: 'Customer requested order cancellation via conversational agent'
      };
    }

    if (toolExecuted === 'schedule_callback') {
      return {
        intent: 'CALL_BACK',
        result: 'CALLBACK_REQUESTED',
        confidence: 1.0,
        source: 'AI_TOOL_EXECUTION',
        summary: 'Customer requested callback via conversational AI agent',
        customerEmotion: 'Busy',
        reason: 'Customer requested callback via conversational agent',
        callbackRequestedMinutes: 60
      };
    }

    // 2. DTMF keypad input (reliable IVR response)
    if (digits === '1') {
      return {
        intent: 'CONFIRMED',
        result: 'CONFIRMED',
        confidence: 1.0,
        source: 'DTMF_KEYPAD',
        summary: 'Customer confirmed order by pressing 1 on keypad',
        customerEmotion: 'Positive',
        reason: 'Customer pressed 1 on telephone keypad to confirm order'
      };
    }

    if (digits === '2') {
      return {
        intent: 'CANCELLED',
        result: 'CANCELLED',
        confidence: 1.0,
        source: 'DTMF_KEYPAD',
        summary: 'Customer cancelled order by pressing 2 on keypad',
        customerEmotion: 'Neutral',
        reason: 'Customer pressed 2 on telephone keypad to cancel order'
      };
    }

    // 3. Transcript / NLP interpretation
    if (effectiveTranscript && effectiveTranscript.trim()) {
      const nlpDecision = this.classifyText(effectiveTranscript);
      if (nlpDecision.confidence >= 0.85 || nlpDecision.intent === 'CALL_BACK' || nlpDecision.intent === 'WRONG_NUMBER') {
        return {
          ...nlpDecision,
          source: 'TRANSCRIPT_NLP'
        };
      }
    }

    // 4. Telephony failure statuses (busy, no-answer, failed)
    if (effectiveCallStatus && ['busy', 'no-answer', 'failed', 'canceled'].includes(effectiveCallStatus.toLowerCase())) {
      const s = effectiveCallStatus.toLowerCase();
      const mappedIntent = s === 'busy' ? 'CALL_BACK' : (s === 'no-answer' ? 'CALL_BACK' : 'UNKNOWN');
      const mappedResult = s === 'busy' ? 'BUSY' : (s === 'no-answer' ? 'NO_ANSWER' : 'FAILED');

      return {
        intent: mappedIntent,
        result: mappedResult,
        confidence: 1.0,
        source: 'TWILIO_STATUS',
        summary: `Call ended with carrier status: ${effectiveCallStatus}`,
        customerEmotion: 'Neutral',
        reason: `Telephony ended with status ${effectiveCallStatus}`
      };
    }

    // 5. Safe fallback
    return {
      intent: 'UNKNOWN',
      result: 'UNKNOWN',
      confidence: 0.0,
      source: 'FALLBACK',
      summary: 'Could not confidently determine customer decision; safe human review recommended',
      customerEmotion: 'Neutral',
      reason: 'Could not confidently determine customer decision; safe human review recommended'
    };
  }
}

export const aiCallInterpretationService = AICallInterpretationService;
export default AICallInterpretationService;
