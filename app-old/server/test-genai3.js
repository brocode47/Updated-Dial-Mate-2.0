import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'fake' });
const chat = ai.chats.create({ model: 'gemini-2.5-flash' });
try {
  await chat.sendMessage({ message: [{ text: 'Hello' }] });
  console.log('Object message with parts works');
} catch (e) {
  console.log('Error 5:', e.message);
}
