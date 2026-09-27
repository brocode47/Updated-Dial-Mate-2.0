import pkg from 'alawmulaw';
const { mulaw } = pkg;
import { stream } from '@audio/resample-polyphase';

/**
 * Handles stateful bidirectional audio transcoding between Twilio (μ-law 8kHz) 
 * and Gemini Live (PCM16 16kHz inbound, PCM16 24kHz outbound).
 */
export class AudioCodec {
  constructor() {
    // 8kHz (Twilio) -> 16kHz (Gemini)
    this.inboundResampler = stream({ from: 8000, to: 16000 });
    // 24kHz (Gemini) -> 8kHz (Twilio)
    this.outboundResampler = stream({ from: 24000, to: 8000 });
  }

  /**
   * Converts Twilio μ-law base64 chunk to Gemini PCM16 base64 chunk.
   * @param {string} ulawBase64 
   * @returns {string} PCM16 base64
   */
  twilioToGemini(ulawBase64) {
    if (!ulawBase64) return '';

    // 1. Decode base64 to Uint8Array (ulaw)
    const ulawBuffer = Buffer.from(ulawBase64, 'base64');
    const ulawData = new Uint8Array(ulawBuffer);

    // 2. Decode ulaw to PCM16 (Int16Array)
    const pcm16 = mulaw.decode(ulawData);

    // 3. Normalize to Float32Array for resampler
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    // 4. Resample 8kHz -> 16kHz
    const resampledFloat = this.inboundResampler.write(float32);
    if (!resampledFloat || resampledFloat.length === 0) return '';

    // 5. Denormalize Float32Array to Buffer (PCM16 Little Endian)
    const outBuffer = Buffer.alloc(resampledFloat.length * 2);
    for (let i = 0; i < resampledFloat.length; i++) {
      let s = Math.max(-1, Math.min(1, resampledFloat[i]));
      const int16Val = s < 0 ? s * 32768 : s * 32767;
      outBuffer.writeInt16LE(int16Val, i * 2);
    }

    // 6. Return as base64 for Gemini
    return outBuffer.toString('base64');
  }

  /**
   * Converts Gemini PCM16 base64 chunk to Twilio μ-law base64 chunk.
   * @param {string} pcm16Base64 
   * @returns {string} ulaw base64
   */
  geminiToTwilio(pcm16Base64) {
    if (!pcm16Base64) return '';

    // 1. Decode base64 to Buffer (PCM16 Little Endian)
    const pcmBuffer = Buffer.from(pcm16Base64, 'base64');
    
    // 2. Convert Buffer to Float32Array for resampler
    const numSamples = pcmBuffer.length / 2;
    const float32 = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      float32[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
    }

    // 3. Resample 24kHz -> 8kHz
    const resampledFloat = this.outboundResampler.write(float32);
    if (!resampledFloat || resampledFloat.length === 0) return '';

    // 4. Denormalize Float32Array to Int16Array
    const int16Out = new Int16Array(resampledFloat.length);
    for (let i = 0; i < resampledFloat.length; i++) {
      let s = Math.max(-1, Math.min(1, resampledFloat[i]));
      int16Out[i] = s < 0 ? s * 32768 : s * 32767;
    }

    // 5. Encode PCM16 to ulaw (Uint8Array)
    const ulawData = mulaw.encode(int16Out);

    // 6. Return as base64 for Twilio
    return Buffer.from(ulawData).toString('base64');
  }
}
