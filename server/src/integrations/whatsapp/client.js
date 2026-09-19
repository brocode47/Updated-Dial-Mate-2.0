import axios from 'axios';

export class WhatsAppClient {
  constructor(options = {}) {
    this.token = options.token || process.env.WHATSAPP_TOKEN;
    this.phoneNumberId = options.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.apiVersion = options.apiVersion || 'v20.0';
    
    if (!this.token || !this.phoneNumberId) {
      console.warn('⚠️ WhatsApp credentials not fully configured.');
    }
  }

  async sendMessage(to, text) {
    if (!this.token || !this.phoneNumberId) {
      throw new Error('WhatsApp is not configured.');
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    
    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text }
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
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

  async sendTemplateMessage(to, templateName, languageCode = 'en_US', components = []) {
    if (!this.token || !this.phoneNumberId) {
      throw new Error('WhatsApp is not configured.');
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components
          }
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ WhatsApp sendTemplateMessage error:', error?.response?.data || error.message);
      throw error;
    }
  }
}
