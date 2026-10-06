import { getAIClient } from '../integrations/ai/client.js';

/**
 * Audio Transcription & Speech Service for Dial Mate 2.0
 * 
 * Production Guarantees:
 * 1. Natively decodes and transcribes WhatsApp audio notes using multimodal Gemini.
 * 2. Tuned for Pakistani customer speech (Urdu, Roman Urdu, English, code-switching).
 * 3. Returns clean text that flows directly into the core conversational reasoning engine.
 * 4. Never exposes technical errors or crashes when audio is unclear.
 */
export class AudioTranscriberService {
  /**
   * Transcribes an audio buffer to text
   * 
   * @param {Buffer} audioBuffer - Binary audio buffer
   * @param {string} [mimeType='audio/ogg'] - Audio MIME type
   * @returns {Promise<string|null>} Transcribed text or null
   */
  static async transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
    if (!audioBuffer || audioBuffer.length === 0) {
      return null;
    }

    try {
      const aiClient = getAIClient();
      const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

      const prompt = `You are an expert Pakistani speech transcriber for customer service assistant Zara.
Listen to this audio note from a customer in Pakistan.
The customer may speak in Roman Urdu, Urdu script, English, or a natural mix of Urdu and English.
Transcribe what the customer is saying into natural, clean text.
Output ONLY the transcribed words. Do NOT add preamble, labels, timestamps, or quotation marks.`;

      const response = await aiClient.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'audio/ogg',
                  data: audioBuffer.toString('base64')
                }
              },
              {
                text: prompt
              }
            ]
          }
        ]
      });

      const transcript = (response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      
      // Filter out empty or noise-only transcriptions
      if (!transcript || transcript === '<noise>' || transcript.toLowerCase().includes('inaudible')) {
        return null;
      }

      console.log(`🎙️ [AudioTranscriber] Transcribed WhatsApp voice note: "${transcript}"`);
      return transcript;
    } catch (err) {
      console.warn(`⚠️ [AudioTranscriber] Transcription notice (${err.message}). Falling back gracefully.`);
      return null;
    }
  }
}

export default AudioTranscriberService;
