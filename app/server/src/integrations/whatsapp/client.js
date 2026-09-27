import axios from 'axios';
import FormData from 'form-data';

export class WhatsAppClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.WA_AKG_BASE_URL || 'http://localhost:3000';
    this.apiKey = options.apiKey || process.env.WA_AKG_API_KEY;
    this.sessionId = options.sessionId || process.env.WA_AKG_SESSION_ID;
    
    if (!this.baseUrl || !this.apiKey || !this.sessionId) {
      console.warn('⚠️ WhatsApp credentials (WA-AKG) not fully configured.');
    }
  }

  /**
   * Format phone number to JID format
   */
  _formatJid(phoneNumber) {
    let jid = phoneNumber.replace(/[^0-9]/g, '');
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us')) {
      jid = `${jid}@s.whatsapp.net`;
    }
    return jid;
  }

  /**
   * Send a text message via WA-AKG
   */
  async sendMessage(to, text, options = {}) {
    if (!this.apiKey || !this.sessionId) {
      throw new Error('WhatsApp (WA-AKG) is not configured.');
    }

    const jid = this._formatJid(to);
    const url = `${this.baseUrl}/api/messages/${this.sessionId}/${encodeURIComponent(jid)}/send`;
    
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
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ WhatsApp sendMessage error:', error?.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send a media message (like a Voice Note) via WA-AKG
   * type can be 'image', 'video', 'audio', 'voice', 'document'
   */
  async sendMediaMessage(to, buffer, type = 'voice', fileName = '', caption = '', options = {}) {
    if (!this.apiKey || !this.sessionId) {
      throw new Error('WhatsApp (WA-AKG) is not configured.');
    }

    const jid = this._formatJid(to);
    const url = `${this.baseUrl}/api/messages/${this.sessionId}/${encodeURIComponent(jid)}/media`;
    
    const form = new FormData();
    // For WA-AKG, field name is 'file'
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
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ WhatsApp sendMediaMessage error:', error?.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Download media from WA-AKG locally
   */
  async downloadMedia(messageId) {
    if (!this.apiKey || !this.sessionId) {
      throw new Error('WhatsApp (WA-AKG) is not configured.');
    }

    const url = `${this.baseUrl}/api/messages/${this.sessionId}/download/${messageId}/media`;
    
    try {
      const response = await axios.get(url, {
        headers: { 'x-api-key': this.apiKey },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      console.error('❌ WhatsApp downloadMedia error:', error?.response?.data || error.message);
      throw error;
    }
  }
}
