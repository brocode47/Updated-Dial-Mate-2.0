import { getAIClient } from './client.js';
import { AITools } from './tools.js';
import { getPrompt } from './prompts.js';
import { dispatchToolCall } from './dispatcher.js';

export class Agent {
  constructor(options = {}) {
    this.ai = getAIClient();
    this.model = options.model || 'gemini-3.1-flash-live-preview';
    this.promptType = options.promptType || 'orderConfirmation';
    this.tools = options.tools || Object.values(AITools);
    
    this.session = null;
    this.onAudioOut = options.onAudioOut || (() => {});
    this.onClear = options.onClear || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onToolExecuted = options.onToolExecuted || (() => {});
    
    this.systemInstruction = options.systemInstruction || null;
    this.shopDomain = options.shopDomain || null;
    this.context = options.context || {};
  }

  async connect(initialContext = '') {
    const systemInstruction = this.systemInstruction || (getPrompt(this.promptType) + '\n\n' + initialContext);

    this.session = await this.ai.live.connect({
      model: this.model,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools: [{ functionDeclarations: this.tools }],
        responseModalities: ['AUDIO']
      }
    });
    
    // Wire up event listeners
    this.session.on('content', (content) => this.handleContent(content));
    this.session.on('toolCall', (toolCall) => this.handleToolCall(toolCall));
    this.session.on('close', () => this.onClose());
    this.session.on('error', (err) => {
      console.error('❌ Gemini Live error:', err);
      this.onClose(err);
    });
    
    return this.session;
  }

  startConversation(text = 'The customer has answered the call. Please speak your opening greeting now.') {
    if (!this.session) return;
    try {
      if (typeof this.session.sendClientContent === 'function') {
        this.session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true
        });
      } else if (typeof this.session.sendRealtimeInput === 'function') {
        this.session.sendRealtimeInput([{ text }]);
      }
    } catch (err) {
      console.warn('⚠️ Could not send startConversation prompt to Gemini:', err.message);
    }
  }

  sendAudio(pcm16Base64) {
    if (!this.session || !pcm16Base64) return;
    this.session.sendRealtimeInput([{
      mimeType: 'audio/pcm;rate=16000',
      data: pcm16Base64
    }]);
  }

  handleContent(response) {
    const content = response?.serverContent;
    
    if (content?.interrupted) {
      this.onClear();
    }
    
    if (content?.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData) {
          // Output audio base64 payload
          this.onAudioOut(part.inlineData.data);
        }
      }
    }
  }

  async handleToolCall(toolCallEvent) {
    const functionCalls = toolCallEvent?.functionCalls || [];
    if (!functionCalls.length) return;
    
    const toolResponses = [];
    
    for (const call of functionCalls) {
      console.log(`🤖 Live Tool Dispatch [${call.name}] for shop [${this.shopDomain}]`);
      try {
        const result = await dispatchToolCall(this.shopDomain, call.name, call.args, this.context);
        toolResponses.push({
          id: call.id, 
          name: call.name,
          response: result
        });
        // Fire callback if it was successful
        if (result.success) {
          this.onToolExecuted(call.name, result);
        }
      } catch (err) {
        console.error(`❌ Tool [${call.name}] failed:`, err.message);
        toolResponses.push({
          id: call.id,
          name: call.name,
          response: { error: err.message }
        });
      }
    }
    
    if (toolResponses.length > 0 && this.session) {
      try {
        this.session.sendRealtimeInput([{
          toolResponses: toolResponses
        }]);
      } catch(err) {
        console.error('❌ Failed to send tool response back to Gemini:', err);
      }
    }
  }

  close() {
    if (this.session && typeof this.session.close === 'function') {
      try { this.session.close(); } catch(e) {}
    }
  }
}
