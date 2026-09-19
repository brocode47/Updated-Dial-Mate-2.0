import { GoogleGenAI } from '@google/genai';

/**
 * Initialize and get the Gemini client
 */
export function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Basic generate helper for simple prompts
 */
export async function generateContent(prompt, model = 'gemini-2.5-flash') {
  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  return response.text;
}
