import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'fake' });
const chat = ai.chats.create({ model: 'gemini-2.5-flash' });
try {
  await chat.sendMessage({ message: 'Hello' });
  console.log('Object message works');
} catch (e) {
  console.log('Error 4:', e.stack);
}
