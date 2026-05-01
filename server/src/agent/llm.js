// Provider-agnostic LLM interface.
// Current Dial Mate production flow uses Twilio IVR.
// This file is prepared for future AI conversation mode.

export async function generateAgentReply({ systemPrompt, userText, context } = {}) {
  const safeUserText = String(userText || '').trim();

  if (!safeUserText) {
    return {
      text: 'Assalam o Alaikum. Main aap ke order ki tasdeeq ke liye call kar raha/rahi hoon. Confirm karne ke liye 1 dabayein, cancel karne ke liye 2 dabayein.',
      confidence: 0.7,
      provider: 'fallback'
    };
  }

  // Future provider integration example:
  // if (process.env.OPENAI_API_KEY) {
  //   return await generateWithOpenAI({ systemPrompt, userText: safeUserText, context });
  // }

  return generateFallbackReply({
    userText: safeUserText,
    context
  });
}

function generateFallbackReply({ userText, context } = {}) {
  const text = String(userText || '').toLowerCase();

  if (
    text.includes('confirm') ||
    text.includes('ok') ||
    text.includes('okay') ||
    text.includes('theek') ||
    text.includes('haan') ||
    text.includes('han') ||
    text.includes('ji')
  ) {
    return {
      text: 'Shukriya. Aapka order confirm kar diya gaya hai.',
      confidence: 0.75,
      intent: 'Confirm',
      provider: 'fallback'
    };
  }

  if (
    text.includes('cancel') ||
    text.includes('nahi') ||
    text.includes('nahi chahiye') ||
    text.includes('galti') ||
    text.includes('ghalti')
  ) {
    return {
      text: 'Theek hai. Aapka order cancel kar diya gaya hai.',
      confidence: 0.75,
      intent: 'Cancel',
      provider: 'fallback'
    };
  }

  if (
    text.includes('kal') ||
    text.includes('shaam') ||
    text.includes('baad') ||
    text.includes('later') ||
    text.includes('reschedule')
  ) {
    return {
      text: 'Theek hai. Is order ko review ke liye mark kar diya gaya hai taake team aap se baad mein rabta kar sake.',
      confidence: 0.65,
      intent: 'Reschedule',
      provider: 'fallback'
    };
  }

  return {
    text: 'Maaf kijiye, main aapki baat poori tarah samajh nahi saka/saki. Order confirm karne ke liye 1 dabayein, cancel karne ke liye 2 dabayein.',
    confidence: 0.4,
    intent: 'Unknown',
    provider: 'fallback'
  };
}