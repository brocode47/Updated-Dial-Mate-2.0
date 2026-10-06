import { getAIClient } from '../integrations/ai/client.js';

/**
 * Text-to-Speech (TTS) Service for Dial Mate 2.0 ("Zara")
 * 
 * Production Guarantees:
 * 1. Natively synthesizes Roman Urdu, Urdu, English, and Mixed language speech.
 * 2. Uses dedicated female voice ("Aoede") for Zara customer-service persona.
 * 3. Encapsulates 24kHz linear PCM16 into a valid RIFF/WAVE container for WhatsApp voice note delivery.
 * 4. Graceful error handling: returns structured status so caller can cleanly fall back to text.
 * 5. Prevents logging of raw audio payload or sensitive customer secrets.
 */
export class TextToSpeechService {
  static DEFAULT_VOICE = process.env.GEMINI_VOICE_NAME || 'Aoede';
  static DEFAULT_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  static DEFAULT_SAMPLE_RATE = 24000;

  /**
   * Encapsulates raw PCM16 linear audio buffer into standard WAV container
   * 
   * @param {Buffer} pcmBuffer 
   * @param {number} sampleRate 
   * @param {number} numChannels 
   * @returns {Buffer}
   */
  static pcm16ToWav(pcmBuffer, sampleRate = 24000, numChannels = 1) {
    if (!pcmBuffer || pcmBuffer.length === 0) {
      return Buffer.alloc(0);
    }
    const header = Buffer.alloc(44);
    const totalDataLen = pcmBuffer.length;
    const totalFileLen = totalDataLen + 36;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;

    header.write('RIFF', 0);
    header.writeUInt32LE(totalFileLen, 4);
    header.write('WAVE', 8);

    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // format chunk size
    header.writeUInt16LE(1, 20);  // audio format (1 = PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34); // bits per sample

    header.write('data', 36);
    header.writeUInt32LE(totalDataLen, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  /**
   * Sanitizes customer service text for natural vocalization
   * (e.g. removes raw URLs and excessive markdown symbols)
   * 
   * @param {string} text 
   * @returns {string}
   */
  static cleanTextForSpeech(text) {
    if (!text) return '';
    let clean = String(text);
    // Strip URLs or replace with speech-friendly text
    clean = clean.replace(/🔗\s*https?:\/\/\S+/gi, '');
    clean = clean.replace(/https?:\/\/\S+/gi, '');
    // Clean bullet points, asterisks, emojis
    clean = clean.replace(/[*_#~`]/g, '');
    clean = clean.replace(/•/g, ', ');
    clean = clean.replace(/Rs\.\s*(\d+)/gi, '$1 rupay');
    clean = clean.replace(/\n+/g, ' ');
    return clean.trim();
  }

  /**
   * Synthesizes text into female voice audio for WhatsApp
   * 
   * @param {string} text - Message text to synthesize
   * @param {object} [options]
   * @param {string} [options.voice] - Prebuilt voice name (defaults to 'Aoede' female)
   * @param {string} [options.model] - Gemini model
   * @param {number} [options.sampleRate] - Sample rate (defaults to 24000)
   * @returns {Promise<{ success: boolean, buffer?: Buffer, mimeType?: string, durationSeconds?: number, error?: string }>}
   */
  static async synthesize(text, options = {}) {
    const rawText = String(text || '').trim();
    if (!rawText) {
      return { success: false, error: 'EMPTY_TEXT' };
    }

    const speechText = this.cleanTextForSpeech(rawText);
    if (!speechText) {
      return { success: false, error: 'NO_SPEECH_CONTENT' };
    }

    const voiceName = options.voice || this.DEFAULT_VOICE;
    const model = options.model || this.DEFAULT_MODEL;
    const sampleRate = options.sampleRate || this.DEFAULT_SAMPLE_RATE;
    const startTime = Date.now();

    console.log(`🎙️ [WhatsApp:TTS_STARTED] Synthesizing voice note (${speechText.length} chars, voice: ${voiceName})`);

    try {
      const aiClient = getAIClient();
      const response = await aiClient.models.generateContent({
        model,
        contents: speechText,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName
              }
            }
          }
        }
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      const audioBase64 = part?.inlineData?.data;

      if (!audioBase64) {
        throw new Error('Gemini TTS response did not contain inline audio data');
      }

      const pcmBuffer = Buffer.from(audioBase64, 'base64');
      const wavBuffer = this.pcm16ToWav(pcmBuffer, sampleRate, 1);
      const durationSeconds = Math.round((pcmBuffer.length / (sampleRate * 2)) * 10) / 10;
      const latencyMs = Date.now() - startTime;

      console.log(`✅ [WhatsApp:TTS_SUCCESS] Synthesized ${durationSeconds}s audio in ${latencyMs}ms (${wavBuffer.length} bytes)`);

      return {
        success: true,
        buffer: wavBuffer,
        mimeType: 'audio/wav',
        sampleRate,
        durationSeconds,
        latencyMs
      };
    } catch (err) {
      console.warn(`⚠️ [WhatsApp:TTS_FAILED] Text-to-Speech synthesis notice (${err.message}). Gracefully falling back.`);
      return {
        success: false,
        error: err.message,
        fallbackToText: true
      };
    }
  }
}

export default TextToSpeechService;
