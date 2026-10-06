import { spawn } from 'child_process';
import { getAIClient } from '../integrations/ai/client.js';

/**
 * Text-to-Speech (TTS) Service for Dial Mate 2.0 ("Zara")
 * 
 * Production Guarantees:
 * 1. Natively synthesizes Roman Urdu, Urdu, English, and Mixed language speech.
 * 2. Uses dedicated female voice ("Aoede") for Zara customer-service persona.
 * 3. Transcodes 24kHz linear PCM16 into genuine OGG container with Opus codec for mobile WhatsApp voice notes.
 * 4. Graceful error handling: falls back to WAV if ffmpeg is unavailable, and returns structured status so caller can cleanly fall back to text.
 * 5. Prevents logging of raw audio payload or sensitive customer secrets.
 */
export class TextToSpeechService {
  static DEFAULT_VOICE = process.env.GEMINI_VOICE_NAME || 'Aoede';
  static DEFAULT_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  static DEFAULT_SAMPLE_RATE = 24000;

  /**
   * Validates if a buffer is a valid Ogg Opus container ('OggS' magic header)
   * 
   * @param {Buffer} buffer 
   * @returns {boolean}
   */
  static isValidOggOpus(buffer) {
    if (!buffer || buffer.length < 4) return false;
    return buffer.slice(0, 4).toString('ascii') === 'OggS';
  }

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
   * Transcodes raw linear PCM16 into genuine OGG Opus suitable for WhatsApp voice notes
   * 
   * @param {Buffer} pcmBuffer 
   * @param {number} sampleRate 
   * @param {number} numChannels 
   * @returns {Promise<Buffer|null>}
   */
  static async pcm16ToOggOpus(pcmBuffer, sampleRate = 24000, numChannels = 1) {
    if (!pcmBuffer || pcmBuffer.length === 0) {
      return Buffer.alloc(0);
    }

    return new Promise((resolve) => {
      try {
        const ffmpeg = spawn('ffmpeg', [
          '-f', 's16le',
          '-ar', String(sampleRate),
          '-ac', String(numChannels),
          '-i', 'pipe:0',
          '-c:a', 'libopus',
          '-b:a', '32k',
          '-vbr', 'on',
          '-application', 'voip',
          '-f', 'ogg',
          'pipe:1'
        ]);

        const chunks = [];

        ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => {}); // silence stderr logging

        ffmpeg.on('error', () => {
          // Graceful fallback if ffmpeg is missing on host environment
          resolve(null);
        });

        ffmpeg.on('close', (code) => {
          if (code === 0 && chunks.length > 0) {
            const resultBuffer = Buffer.concat(chunks);
            resolve(resultBuffer);
          } else {
            resolve(null);
          }
        });

        ffmpeg.stdin.on('error', () => {});
        ffmpeg.stdin.write(pcmBuffer);
        ffmpeg.stdin.end();
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Sanitizes customer service text for natural spoken dialogue
   * (removes raw URLs, eliminates redundant template repetitions, smooths pronunciation)
   * 
   * @param {string} text 
   * @returns {string}
   */
  static cleanTextForSpeech(text) {
    if (!text) return '';
    let clean = String(text);

    // Strip emojis
    clean = clean.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // Strip customer echo prefixes
    clean = clean.replace(/^(?:Customer|Aap|User):\s*.*?(?:\n|$)/gim, '');

    // Strip URLs or link invitation prefixes
    clean = clean.replace(/(?:Product dekhne ke liye|link|🔗)?\s*https?:\/\/\S+/gi, '');

    // Natural Pakistani spoken currency
    clean = clean.replace(/Rs\.\s*(\d+)/gi, '$1 rupay');
    clean = clean.replace(/\b(\d+)\s*PKR\b/gi, '$1 rupay');

    // Clean bullet points and formatting
    clean = clean.replace(/[*_#~`]/g, '');
    clean = clean.replace(/•/g, ', ');

    // Normalize price and delivery labels for natural speech
    clean = clean.replace(/Product price:\s*/gi, 'Is product ki price ');
    clean = clean.replace(/Delivery charges:\s*/gi, 'Delivery ');
    clean = clean.replace(/Kul Total:\s*|Total:\s*/gi, ', to total ');

    // Deduplicate repeated delivery charge mentions
    const deliveryMatch = clean.match(/delivery (?:charges )?(\d+ rupay)/i);
    if (deliveryMatch) {
      const chargeText = deliveryMatch[1];
      const parts = clean.split(new RegExp(`delivery (?:charges )?${chargeText}`, 'i'));
      if (parts.length > 2) {
        clean = parts[0] + `delivery ${chargeText}` + parts.slice(1).join('');
      }
    }

    clean = clean.replace(/\s+/g, ' ').trim();
    return clean;
  }

  /**
   * Synthesizes text into female voice audio for WhatsApp
   * 
   * @param {string} text - Message text to synthesize
   * @param {object} [options]
   * @param {string} [options.voice] - Prebuilt voice name (defaults to 'Aoede' female)
   * @param {string} [options.model] - Gemini model
   * @param {number} [options.sampleRate] - Sample rate (defaults to 24000)
   * @returns {Promise<{ success: boolean, buffer?: Buffer, mimeType?: string, format?: string, durationSeconds?: number, error?: string }>}
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

    console.log(`🎙️ [WhatsApp:TTS_STARTED] Synthesizing female voice note (${speechText.length} chars, voice: ${voiceName})`);

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
      const durationSeconds = Math.round((pcmBuffer.length / (sampleRate * 2)) * 10) / 10;

      // Preferred production transcode: genuine Ogg Opus for mobile WhatsApp
      const oggBuffer = await this.pcm16ToOggOpus(pcmBuffer, sampleRate, 1);
      const isOgg = oggBuffer && this.isValidOggOpus(oggBuffer);

      const finalBuffer = isOgg ? oggBuffer : this.pcm16ToWav(pcmBuffer, sampleRate, 1);
      const mimeType = isOgg ? 'audio/ogg; codecs=opus' : 'audio/wav';
      const format = isOgg ? 'ogg' : 'wav';
      const latencyMs = Date.now() - startTime;

      console.log(`✅ [WhatsApp:TTS_SUCCESS] Synthesized ${durationSeconds}s ${format.toUpperCase()} audio in ${latencyMs}ms (${finalBuffer.length} bytes)`);

      return {
        success: true,
        buffer: finalBuffer,
        mimeType,
        format,
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
