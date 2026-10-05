import axios from 'axios';
import FormData from 'form-data';

/**
 * Multi-Tenant WhatsApp AKG Client
 * 
 * Strict Isolation: Every outbound WhatsApp operation requires an explicit sessionId.
 * Never defaults to a global session ID when tenant sessionId is required.
 */
export class WhatsAppClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || process.env.WA_AKG_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    this.apiKey = options.apiKey || process.env.WA_AKG_API_KEY;
    this.sessionId = options.sessionId || null;
    this.shopId = options.shopId || null;
    this.timeout = options.timeout || 8000;

    if (!this.apiKey) {
      console.warn('⚠️ WA_AKG_API_KEY is not configured.');
    }
  }

  /**
   * Resolve sessionId with strict multi-tenant isolation
   */
  _resolveSessionId(options = {}) {
    const sessionId = options.sessionId || this.sessionId;
    if (!sessionId) {
      throw new Error('Multi-tenant error: WhatsApp sessionId is required.');
    }
    return String(sessionId);
  }

  /**
   * Format phone number to JID format
   */
  _formatJid(phoneNumber) {
    let jid = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us')) {
      jid = `${jid}@s.whatsapp.net`;
    }
    return jid;
  }

  /**
   * Send a text message via WA-AKG
   */
  async sendMessage(to, text, options = {}) {
    if (!this.apiKey) {
      throw new Error('WhatsApp (WA-AKG) API key is not configured.');
    }

    const sessionId = this._resolveSessionId(options);
    const jid = this._formatJid(to);
    const url = `${this.baseUrl}/api/messages/${sessionId}/${encodeURIComponent(jid)}/send`;

    try {
      const response = await axios.post(
        url,
        {
          message: text,
          mentions: options.mentions || [],
          quotedMessageId: options.quotedMessageId
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );
      return response.data;
    } catch (error) {
      const errMsg = error?.response?.data || error.message;
      console.error(`❌ [WhatsAppClient] sendMessage failed (session: ${sessionId}, to: ${jid}):`, errMsg);
      throw error;
    }
  }

  /**
   * Send a media message (e.g. image, voice, audio, document) via WA-AKG
   */
  async sendMediaMessage(to, buffer, type = 'voice', fileName = '', caption = '', options = {}) {
    if (!this.apiKey) {
      throw new Error('WhatsApp (WA-AKG) API key is not configured.');
    }

    const sessionId = this._resolveSessionId(options);
    const jid = this._formatJid(to);
    const url = `${this.baseUrl}/api/messages/${sessionId}/${encodeURIComponent(jid)}/media`;

    const form = new FormData();
    form.append('file', buffer, { filename: fileName || `media_${Date.now()}` });
    form.append('type', type);
    if (caption) form.append('caption', caption);
    if (options.quotedMessageId) form.append('quotedMessageId', options.quotedMessageId);

    try {
      const response = await axios.post(
        url,
        form,
        {
          headers: {
            'x-api-key': this.apiKey,
            ...form.getHeaders()
          },
          timeout: this.timeout
        }
      );
      return response.data;
    } catch (error) {
      const errMsg = error?.response?.data || error.message;
      console.error(`❌ [WhatsAppClient] sendMediaMessage failed (session: ${sessionId}):`, errMsg);
      throw error;
    }
  }

  /**
   * Download media from WA-AKG locally
   */
  async downloadMedia(messageId, options = {}) {
    if (!this.apiKey) {
      throw new Error('WhatsApp (WA-AKG) API key is not configured.');
    }

    const sessionId = this._resolveSessionId(options);
    const url = `${this.baseUrl}/api/messages/${sessionId}/download/${messageId}/media`;

    try {
      const response = await axios.get(url, {
        headers: { 'x-api-key': this.apiKey },
        responseType: 'arraybuffer',
        timeout: this.timeout
      });
      return response.data;
    } catch (error) {
      const errMsg = error?.response?.data || error.message;
      console.error(`❌ [WhatsAppClient] downloadMedia failed (session: ${sessionId}, msg: ${messageId}):`, errMsg);
      throw error;
    }
  }

  /**
   * Check connection and session status for a tenant session
   */
  async checkSessionStatus(sessionId = null) {
    if (!this.apiKey) return { status: 'UNCONFIGURED' };
    const targetSession = this._resolveSessionId({ sessionId });
    const url = `${this.baseUrl}/api/sessions/${targetSession}`;

    try {
      const response = await axios.get(url, {
        headers: { 'x-api-key': this.apiKey },
        timeout: 5000
      });
      const sessionData = response.data?.data || response.data;
      return {
        status: sessionData?.status || (response.data?.status === true ? 'CONNECTED' : 'DISCONNECTED'),
        data: sessionData
      };
    } catch (error) {
      return {
        status: 'DISCONNECTED',
        error: error.message
      };
    }
  }

  /**
   * Request session restart / reconnect on WA-AKG
   */
  async restartSession(sessionId = null) {
    if (!this.apiKey) throw new Error('API key not configured');
    const targetSession = this._resolveSessionId({ sessionId });
    const url = `${this.baseUrl}/api/sessions/${targetSession}/restart`;

    const response = await axios.post(url, {}, {
      headers: { 'x-api-key': this.apiKey },
      timeout: 5000
    });
    return response.data;
  }
}
