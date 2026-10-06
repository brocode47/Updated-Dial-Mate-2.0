import { getAIClient } from '../src/integrations/ai/client.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';

function pcm16ToWav(pcmBuffer, sampleRate = 24000, numChannels = 1) {
  const header = Buffer.alloc(44);
  const totalDataLen = pcmBuffer.length;
  const totalFileLen = totalDataLen + 36;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(totalFileLen, 4);
  header.write('WAVE', 8);

  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);

  header.write('data', 36);
  header.writeUInt32LE(totalDataLen, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function testTTSAndSendVoice() {
  try {
    const client = getAIClient();
    console.log('1. Synthesizing voice with gemini-2.5-flash-preview-tts (Aoede)...');
    
    const res = await client.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: 'Assalam-o-Alaikum! Main Zara hoon Sunday Bazaaar se.',
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede'
            }
          }
        }
      }
    });

    const part = res.candidates?.[0]?.content?.parts?.[0];
    if (!part?.inlineData?.data) {
      throw new Error('No audio data returned from Gemini TTS');
    }

    const rawPcm = Buffer.from(part.inlineData.data, 'base64');
    const wavBuffer = pcm16ToWav(rawPcm, 24000, 1);
    console.log('2. WAV buffer created:', wavBuffer.length, 'bytes');

    const waClient = new WhatsAppClient({
      sessionId: '2cmrlo',
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY
    });

    const target = '923333255998@s.whatsapp.net';
    console.log('3. Sending voice note to authorized test number:', target);
    const sendRes = await waClient.sendMediaMessage(target, wavBuffer, 'voice', 'zara_voice.wav');
    console.log('4. Send media response:', JSON.stringify(sendRes));
    console.log('✅ SUCCESS! WhatsApp voice note sent successfully.');
  } catch (err) {
    console.error('❌ Error testing voice note:', err.message);
  }
}

testTTSAndSendVoice();
