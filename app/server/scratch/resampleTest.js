import pkg from 'alawmulaw';
const { mulaw } = pkg;
import resample from '@audio/resample-polyphase';

try {
  // Test mulaw decode
  const encoded = new Uint8Array([0, 1, 2, 3]);
  const decoded = mulaw.decode(encoded); // Int16Array
  console.log('mulaw.decode output type:', decoded.constructor.name, 'length:', decoded.length);

  // Test resampling (up)
  const upsampler = resample(8000, 16000); 
  const inputFloat = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const outFloat = upsampler(inputFloat);
  console.log('upsampled output type:', outFloat.constructor.name, 'length:', outFloat.length);
  console.log('upsampled output:', outFloat);

  // Test resampling (down)
  const downsampler = resample(24000, 8000);
  const outFloatDown = downsampler(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  console.log('downsampled output type:', outFloatDown.constructor.name, 'length:', outFloatDown.length);
  console.log('downsampled output:', outFloatDown);

  // Buffer conversion test (Int16Array to Float32Array and back)
  const int16 = new Int16Array([32767, -32768, 0, 16384]);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  
  const int16Out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    int16Out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  console.log('int16Out:', int16Out);

} catch (e) {
  console.error(e);
}
