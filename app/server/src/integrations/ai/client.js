import { GoogleGenAI } from '@google/genai';

let cachedAIClient = null;

/**
 * Initialize and get the Gemini client
 */
export function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  if (!cachedAIClient) {
    cachedAIClient = new GoogleGenAI({ apiKey });
  }
  return cachedAIClient;
}

/**
 * Basic generate helper for simple prompts
 */
export async function generateContent(prompt, model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') {
  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  return response.text;
}

