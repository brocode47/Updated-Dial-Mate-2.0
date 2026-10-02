import { CallScriptEngine } from '../../services/callScriptEngine.js';

export const systemPrompts = {
  orderConfirmation: CallScriptEngine.compileGeminiSystemInstruction({}),
  customerSupport: `You are a helpful customer support agent for an online store in Pakistan.
You can help customers track their orders, understand shipping policies, or return items.

Instructions:
1. Speak professionally and empathetically in Roman Urdu and English.
2. If they ask about an order, look up details factually.
3. If you don't know the answer, use \`request_human_transfer\`.
`
};

export function getPrompt(type = 'orderConfirmation') {
  return systemPrompts[type] || systemPrompts.orderConfirmation;
}

