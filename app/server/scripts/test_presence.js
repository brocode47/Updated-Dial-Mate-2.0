import axios from 'axios';

async function testPresence() {
  const apiKey = process.env.WA_AKG_API_KEY;
  const baseUrl = process.env.WA_AKG_BASE_URL || 'http://wa-akg:3000';
  const url = `${baseUrl}/api/chat/2cmrlo/923333255998%40s.whatsapp.net/presence`;
  try {
    const res = await axios.post(url, { presence: 'composing' }, {
      headers: { 'x-api-key': apiKey },
      timeout: 3000
    });
    console.log('✅ Presence response:', res.data);
  } catch (err) {
    console.error('❌ Presence error:', err.response?.data || err.message);
  }
}

testPresence();
