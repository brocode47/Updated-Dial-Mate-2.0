import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'fake' });
const chat = ai.chats.create({ model: 'gemini-2.5-flash' });
try {
  await chat.sendMessage([{ text: 'Hello' }]);
  console.log('Array of parts works');
} catch (e) {
  console.log('Error 1:', e.message);
}
try {
  await chat.sendMessage({ parts: [{ text: 'Hello' }] });
  console.log('Object with parts works');
} catch (e) {
  console.log('Error 2:', e.message);
}
try {
  await chat.sendMessage('Hello');
  console.log('String works');
} catch (e) {
  console.log('Error 3:', e.stack);
}
