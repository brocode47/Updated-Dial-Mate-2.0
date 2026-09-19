import { getAIClient } from './client.js';
import { AITools } from './tools.js';
import { getPrompt } from './prompts.js';

export class Agent {
  constructor(options = {}) {
    this.ai = getAIClient();
    this.model = options.model || 'gemini-2.5-flash';
    this.promptType = options.promptType || 'orderConfirmation';
    this.session = null;
    this.tools = options.tools || [AITools.confirm_cod_order, AITools.cancel_order, AITools.transfer_to_human, AITools.get_order_status];
  }

  async startConversation(initialContext = '') {
    const systemInstruction = getPrompt(this.promptType) + '\n\n' + initialContext;

    // We can't use live bidirectional streaming with the basic `generateContent` or basic `chat` in the standard gemini SDK easily yet,
    // so we'll simulate a conversational interface by keeping track of history or using the chat session.

    const chat = this.ai.chats.create({
      model: this.model,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ functionDeclarations: Object.values(this.tools) }]
      }
    });

    this.session = chat;
    return this.session;
  }

  async sendMessage(message) {
    if (!this.session) {
      throw new Error('Session not started. Call startConversation first.');
    }

    const response = await this.session.sendMessage({ message });
    return this.handleResponse(response);
  }

  handleResponse(response) {
    const text = response.text;
    const functionCalls = response.functionCalls || [];
    
    return {
      text,
      functionCalls
    };
  }

  async sendToolResponse(functionCallsResponse) {
    if (!this.session) {
      throw new Error('Session not started.');
    }

    const response = await this.session.sendMessage(functionCallsResponse);
    return this.handleResponse(response);
  }
}
