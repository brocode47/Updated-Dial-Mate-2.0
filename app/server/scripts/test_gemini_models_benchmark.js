import { GoogleGenAI } from '@google/genai';

async function benchmark() {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });

  const candidateModels = [
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash'
  ];

  console.log('--- TESTING FLASH MODELS LATENCY ---');
  for (const model of candidateModels) {
    const t0 = Date.now();
    try {
      const res = await ai.models.generateContent({
        model,
        contents: 'Reply with only the word OK.'
      });
      const elapsed = Date.now() - t0;
      console.log(`✅ [${model}] SUCCESS in ${elapsed}ms -> "${(res.text || '').trim()}"`);
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.log(`❌ [${model}] FAILED in ${elapsed}ms -> ${err.message}`);
    }
  }
}

benchmark();
