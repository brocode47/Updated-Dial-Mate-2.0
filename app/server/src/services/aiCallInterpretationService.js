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

    // --- CONTEXTUAL NEGATION DETECTION (CRITICAL SAFETY GUARD) ---
    const negatedCancellationPatterns = [
      /\b(cancel\s*(karne\s*ko\s*|karne\s*ka\s*|karna\s*|ka\s*)?(nahi|nhi|nh|nahin|mat|na)\s*(karna|karo|karein|keh|kaha)?)\b/i,
      /\b((nahi|nhi|nh|nahin|mat|na)\s*cancel\b)/i,
      /\b(main\s+cancel\s+nahi\s+karna\s+chahta)\b/i,
      /\b(cancel\s+ka\s+nahi\s+kaha)\b/i,
      /\b(maine\s+cancel\s+(karne\s+ko\s+)?nahi\s+kaha)\b/i,
      /\b(order\s+cancel\s+nahi)\b/i,
      /\b(do\s*not\s+cancel|dont\s+cancel)\b/i,
      /(کینسل\s+نہیں|کینسل\s+مت|کینسل\s+کا\s+نہیں)/i
    ];

    const negatedConfirmationPatterns = [
      /\b(confirm\s*(nahi|nhi|nh|nahin|mat|na)\s*(karna|karo|karein|keh|kaha)?)\b/i,
      /\b((nahi|nhi|nh|nahin|mat|na)\s*confirm\b)/i,
      /\b(main\s+confirm\s+nahi\s+karta)\b/i,
      /\b(abhi\s+confirm\s+nahi\s+kar\s+sakta)\b/i,
      /\b(confirm\s+ka\s+nahi\s+kaha)\b/i,
      /\b(order\s+confirm\s+nahi)\b/i,
      /\b(do\s*not\s+confirm|dont\s+confirm)\b/i,
      /(کنفرم\s+نہیں|کنفرم\s+مت|کنفرم\s+کا\s+نہیں)/i
    ];

    const isNegatedCancellation = negatedCancellationPatterns.some(p => p.test(raw));
    const isNegatedConfirmation = negatedConfirmationPatterns.some(p => p.test(raw));

    // Hesitant / Uncertain markers (must never confirm or cancel automatically)
    const hesitantPatterns = [
      /\b(shayad|pata nahi|dekh kar|soch kar|sochta hoon|sochti hoon|not sure|confused|maybe|abhi nahi pata|baad me bataunga)\b/i
    ];
    const isHesitant = hesitantPatterns.some(p => p.test(raw));

    // Human transfer requests
    const humanTransferPatterns = [
      /\b(human agent|human representative|manager|agent se baat|insan se baat|representative|baat karwa do|baat karwa dein|kisi aur se baat)\b/i,
      /(نمائندے سے بات|انسان سے بات|منیجر)/i
    ];
    for (const pattern of humanTransferPatterns) {
      if (pattern.test(raw)) {
        return {
          intent: 'HUMAN_TRANSFER',
          result: 'HUMAN_TRANSFER',
          confidence: 0.95,
          language: detectedLanguage,
          summary: 'Customer requested transfer to a human representative or manager',
          customerEmotion,
          reason: `Matched human transfer pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // Do-not-call requests
    const doNotCallPatterns = [
      /\b(dobara call mat|dubara call mat|kabhi call mat|dont call again|do not call again|remove my number|number delete|blacklist)\b/i,
      /(دوبارہ کال مت کرنا|کبھی کال مت کرنا)/i
    ];
    for (const pattern of doNotCallPatterns) {
      if (pattern.test(raw)) {
        return {
          intent: 'DO_NOT_CALL',
          result: 'DO_NOT_CALL',
          confidence: 0.98,
          language: detectedLanguage,
          summary: 'Customer explicitly requested not to be called again',
          customerEmotion: 'Upset',
          reason: `Matched do-not-call pattern: ${pattern.source}`,
          callbackRequestedMinutes: null
        };
      }
    }

    // 2. Callback requested patterns
    const callbackPatterns = [
      /\b(baad me|baad mein|busy hoon|busy hu|masroof|shaam ko|shaam me|kal shaam|kal call|call kar lena|\bkal\b|phir call|thori der baad|after some time|call back|call later)\b/i,
      /\b(driving|driving kar|baad call|ghante baad|ghanta baad|office mein)\b/i,
      /(بعد میں|مصروف ہوں|شام کو|کل کال کریں|دوبارہ کال|ڈرائیونگ|کل شام|(?<=^|[\s،۔])کل(?=[\s،۔]|$))/i
    ];
    for (const pattern of callbackPatterns) {
      if (pattern.test(raw) && !isNegatedCancellation) {
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

    // 3. Rejection / Cancellation patterns (ONLY if not negated!)
    if (!isNegatedCancellation) {
      const rejectPatterns = [
        /\b(cancel kar do|cancel kardo|nahi chahiye|nh chahiye|mat bhejo|nhi chahiye|mat bhein|mana kar diya|galti se|order cancel|cancel order|decline)\b/i,
        /\b(do not send|dont send)\b/i,
        /(منسوخ|نہیں چاہیے|مت بھیجو|کینسل کر دیں|کینسل کردیں)/i
      ];
      // Standalone cancel (not part of "cancel nahi")
      const standaloneCancel = /\bcancel\b/i.test(raw);

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

      if (standaloneCancel && !isHesitant) {
        return {
          intent: 'CANCELLED',
          result: 'CANCELLED',
          confidence: 0.95,
          language: detectedLanguage,
          summary: 'Customer requested cancellation of the order',
          customerEmotion,
          reason: 'Matched explicit cancel request',
          callbackRequestedMinutes: null
        };
      }
    }

    // If customer said "confirm nahi karna", and did not provide an explicit cancellation,
    // it MUST NOT confirm, but should remain UNKNOWN or CANCELLED based on context.
    if (isNegatedConfirmation) {
      return {
        intent: 'UNKNOWN',
        result: 'UNKNOWN',
        confidence: 0.85,
        language: detectedLanguage,
        summary: 'Customer explicitly stated NOT to confirm; order confirmation withheld',
        customerEmotion,
        reason: 'Customer negated confirmation ("confirm nahi karna")',
        callbackRequestedMinutes: null
      };
    }

    // 4. Confirmation patterns (ONLY if not negated and not hesitant!)
    if (!isNegatedConfirmation && !isHesitant) {
      const confirmPatterns = [
        /\b(bhej do|bhejdein|bhej dein|bhejo|bhejna hai|sahi hai|ok hai|pakka bhej do|han bhej do|bilkul bhej do)\b/i,
        /\b(confirm\s*(kar\s*do|kardo|kar\s*dein|kardein|karein|karna|hai)?)\b/i,
        /\b(order\s*(bhi\s*)?confirm(\s*hai|\s*kardo|\s*kar\s*do|\s*kar\s*dein)?)\b/i,
        /\b(dispatch\s*(it|kardo|kar\s*do|kar\s*dein|karein)?|please\s*dispatch)\b/i,
        /\b(please deliver|go ahead|proceed|send it|please confirm|confirm my order|confirm the order|confirm order|yes please confirm|confirm it)\b/i,
        /(جی بالکل|بھیج دیں|ٹھیک ہے|ہاں بھیج دیں|بھیجو|کنفرم ہے|آرڈر کنفرم)/i
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

      // Exact or clear affirmative tokens
      const isAffirmative = /\b(jee haan|haan jee|jee bilkul|yes confirm|yes confirmed|bilkul|theek hai|sahi hai)\b/i.test(raw) ||
        /^(\s*(jee|ji|haan|yes)\s*[\.!]?\s*)$/i.test(raw);

      if (isAffirmative || (/\b(confirm)\b/i.test(raw) && isNegatedCancellation)) {
        return {
          intent: 'CONFIRMED',
          result: 'CONFIRMED',
          confidence: 0.95,
          language: detectedLanguage,
          summary: 'Customer confirmed order delivery',
          customerEmotion: customerEmotion === 'Neutral' ? 'Positive' : customerEmotion,
          reason: 'Matched unambiguous affirmative confirmation',
          callbackRequestedMinutes: null
        };
      }
    }

    // 5. Hesitant / Ambiguous / Indeterminate
    return {
      intent: 'UNKNOWN',
      result: 'UNKNOWN',
      confidence: isHesitant ? 0.7 : 0.4,
      language: detectedLanguage,
      summary: isHesitant
        ? 'Customer was hesitant or tentative; human confirmation required'
        : 'Customer response was ambiguous; requires human merchant verification',
      customerEmotion: isHesitant ? 'Hesitant' : customerEmotion,
      reason: isHesitant
        ? 'Customer expressed uncertainty or hesitation ("shayad / soch kar")'
        : 'Utterance did not match confident confirmation or rejection pattern',
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
    if (effectiveCallStatus && ['busy', 'no-answer', 'no_answer', 'failed', 'canceled'].includes(effectiveCallStatus.toLowerCase())) {
      const s = effectiveCallStatus.toLowerCase().replace('_', '-');
      const mappedResult = s === 'busy' ? 'BUSY' : (s === 'no-answer' ? 'NO_ANSWER' : 'FAILED');
      const mappedIntent = mappedResult;

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
