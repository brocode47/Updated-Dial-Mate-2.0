import { GoogleGenAI } from '@google/genai';
import { AITools } from '../src/integrations/ai/tools.js';

async function testToolTrigger() {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });

  const availableTools = [
    AITools.search_shopify_products,
    AITools.confirm_order,
    AITools.cancel_order,
    AITools.request_human_transfer
  ];

  const systemInstruction = `You are Zara, customer support for Sunday Bazaaar.
If the customer asks about products, call search_shopify_products.
Answer politely in Roman Urdu.`;

  console.log(`\n--- TESTING gemini-3.5-flash-lite PRODUCT SEARCH TRIGGER ---`);
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: 'kya aapke pas chair protection cover ya perfume hai?',
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: availableTools }]
      }
    });
    const elapsed = Date.now() - t0;
    console.log(`✅ [gemini-3.5-flash-lite] SUCCESS in ${elapsed}ms!`);
    const candidate = res.candidates?.[0];
    const functionCalls = candidate?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall) || [];
    if (functionCalls.length > 0) {
      console.log(`   Tool call detected:`, JSON.stringify(functionCalls[0]));
    } else {
      console.log(`   Text:`, (res.text || '').trim().slice(0, 100));
    }
  } catch (err) {
    console.log(`❌ FAILED in ${Date.now() - t0}ms:`, err.message);
  }
}

testToolTrigger();
