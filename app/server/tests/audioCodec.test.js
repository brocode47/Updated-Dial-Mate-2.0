import { describe, it, expect } from 'vitest';
import { AudioCodec } from '../src/utils/audioCodec.js';
import pkg from 'alawmulaw';
const { mulaw } = pkg;

describe('AudioCodec', () => {
  it('should encode and decode arbitrary chunk sizes smoothly', () => {
    const codec = new AudioCodec();
    
    // Create a dummy ulaw base64 chunk (e.g. 100 bytes)
    const ulawData = new Uint8Array(100).fill(127); // 127 is silence in ulaw
    const ulawBase64 = Buffer.from(ulawData).toString('base64');
    
    const pcmBase64 = codec.twilioToGemini(ulawBase64);
    
    // 8kHz -> 16kHz means 100 bytes ulaw -> 100 samples PCM -> 200 samples PCM -> 400 bytes PCM
    const pcmBuffer = Buffer.from(pcmBase64, 'base64');
    expect(pcmBuffer.length).toBeGreaterThan(0);
    // The exact length might vary slightly depending on resampler internal buffer draining, 
    // but should be around 400 bytes.
    expect(pcmBuffer.length % 2).toBe(0); // must be 16-bit
  });

  it('should handle streaming chunks maintaining continuity without crashing', () => {
    const codec = new AudioCodec();
    
    // Feed 5 consecutive chunks
    for (let i = 0; i < 5; i++) {
      const ulawData = new Uint8Array(50).fill(127);
      const ulawBase64 = Buffer.from(ulawData).toString('base64');
      const pcmBase64 = codec.twilioToGemini(ulawBase64);
      expect(typeof pcmBase64).toBe('string');
    }
  });

  it('should transcode Gemini outbound audio (24kHz PCM16) back to Twilio (8kHz ulaw)', () => {
    const codec = new AudioCodec();
    
    // 240 bytes of PCM16 = 120 samples
    const pcmData = Buffer.alloc(240); 
    // Fill with a simple pattern
    for (let i = 0; i < 120; i++) {
      pcmData.writeInt16LE(i * 10, i * 2);
    }
    const pcmBase64 = pcmData.toString('base64');
    
    const ulawBase64 = codec.geminiToTwilio(pcmBase64);
    const ulawBuffer = Buffer.from(ulawBase64, 'base64');
    
    // 120 samples @ 24kHz -> 40 samples @ 8kHz -> 40 bytes ulaw
    expect(ulawBuffer.length).toBeGreaterThan(0);
    expect(ulawBuffer.length).toBeLessThanOrEqual(50); // allow slight padding from resampler
  });

  it('should return empty string on empty input', () => {
    const codec = new AudioCodec();
    expect(codec.twilioToGemini('')).toBe('');
    expect(codec.geminiToTwilio('')).toBe('');
  });
});
