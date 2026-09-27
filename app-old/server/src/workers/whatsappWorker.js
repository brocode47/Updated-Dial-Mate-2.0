import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { generateContent, getAIClient } from '../integrations/ai/client.js';
import { getPrompt } from '../integrations/ai/prompts.js';
import { AITools } from '../integrations/ai/tools.js';
import { dispatchToolCall } from '../integrations/ai/dispatcher.js';
import { prisma } from '../lib/db.js';
import { ChatStateService } from '../services/chatState.js';

const waClient = new WhatsAppClient();

export async function processWhatsAppJob(job) {
  const { shopDomain, sessionId, payload } = job.data;
  
  // payload is from WA-AKG webhook: { key: { id, remoteJid }, content, type, fileUrl }
  const jid = payload.key?.remoteJid;
  const messageType = payload.type;
  const messageText = payload.content || '';
  const fileUrl = payload.fileUrl;
  
  if (!jid || jid.includes('@g.us')) {
    // Ignore group messages or malformed
    return { success: true, ignored: true };
  }

  console.log(`dY" [WhatsAppWorker] Processing message from ${jid} for shop ${shopDomain}`);

  try {
    // 1. Prepare parts for Gemini
    const parts = [];

    if (messageType === 'audioMessage' || messageType === 'voice' || messageType === 'AUDIO') {
      if (!fileUrl) {
        throw new Error('Audio message missing fileUrl');
      }
      
      console.log(`dY" [WhatsAppWorker] Downloading media for message ${payload.key?.id}`);
      // fileUrl from WA-AKG can be downloaded directly if it's absolute, 
      // or we use the client's download method
      const audioBuffer = await waClient.downloadMedia(payload.key?.id);
      
      parts.push({
        inlineData: {
          data: Buffer.from(audioBuffer).toString('base64'),
          mimeType: payload.mimeType || 'audio/ogg' // WA-AKG uses ogg for voice notes
        }
      });
      // Required to prevent 400 "Requests ending with a model turn" when history is used
      parts.push({ text: '[User sent an audio message]' });
    } else {
      parts.push({ text: messageText });
    }

    // 2. Look up customer/order context (basic heuristic by phone number)
    const phone = jid.split('@')[0];
    
    // Attempt to find an active order for this phone
    const order = await prisma.order.findFirst({
      where: { 
        shop: { domain: shopDomain },
        // Fixed Prisma query: String fields use contains, not string_contains
        payload: { contains: phone } 
      },
      orderBy: { createdAt: 'desc' }
    });

    let contextText = `Customer Phone: ${phone}\n`;
    if (order) {
      contextText += `Found recent Order ID: ${order.id}\nStatus: ${order.status}\n`;
    }

    const systemInstruction = getPrompt('orderConfirmation') + '\n\n' + contextText;
    
    // 3. Load Chat History
    const chatKey = `${shopDomain}:${sessionId}:${jid}`;
    const history = await ChatStateService.load(chatKey) || [];

    // 4. Call Gemini Chat
    console.log(`dY" [WhatsAppWorker] Generating AI response...`);
    const ai = getAIClient();
    
    const chat = ai.chats.create({
      model: 'gemini-3.6-flash',
      history: history,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ functionDeclarations: Object.values(AITools) }]
      }
    });

    const response = await chat.sendMessage({ message: parts });
    let textResponse = response.text || '';
    
    // 5. Handle tool calls if any
    const functionCalls = response.functionCalls || [];
    for (const call of functionCalls) {
      console.log(`dY" [WhatsAppWorker] Dispatching Tool: ${call.name}`);
      const result = await dispatchToolCall(shopDomain, call.name, call.args, { eventId: payload.key?.id });
      
      // Send tool result back to Gemini to get final text
      const followUp = await chat.sendMessage({ message: [{
        functionResponse: {
          name: call.name,
          response: result
        }
      }]});
      
      if (followUp.text) {
        textResponse += '\n' + followUp.text;
      }
    }

    // 6. Save updated history
    const updatedHistory = await chat.getHistory();
    await ChatStateService.save(chatKey, updatedHistory);

    textResponse = textResponse.trim();
    
    // 7. Send reply back to WA-AKG
    if (textResponse) {
      console.log(`dY" [WhatsAppWorker] Sending text reply to ${jid}`);
      await waClient.sendMessage(jid, textResponse);
    }
    
    return { success: true };
    
  } catch (err) {
    console.error('?O [WhatsAppWorker] Error processing message:', err.message);
    throw err;
  }
}
