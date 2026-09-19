import express from 'express';
import twilio from 'twilio';
import { prisma } from '../lib/db.js';
import { triggerCall } from './webhooks.js';

export function twilioRouter() {
  const router = express.Router();

  const clean = (value, fallback = '') =>
    String(value || fallback)
      .replace(/&/g, 'and')
      .replace(/</g, '')
      .replace(/>/g, '')
      .replace(/"/g, '')
      .replace(/'/g, '');

  async function addShopifyOrderTag(orderId, tag) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { shop: true }
      });
  
      if (!order || !order.shop || !order.shopifyOrderGid) {
        return;
      }
  
      const shopRow = order.shop;
      if (!shopRow || !shopRow.accessToken) {
        return;
      }
  
      // Currently using mock Shopify for tags or we can skip this till we have the Shopify integration
      // For now we will just log it. In Phase 2 we will use the Shopify service layer.
      console.log(`🏷️ [Mock] Shopify tag added: ${tag} for ${orderId}`);
    } catch (err) {
      console.error('❌ Shopify tag failed:', err.message);
    }
  }

  const activeCalls = new Map();
  
  router.all('/voice', async (req, res) => {
    console.log('🎧 /twilio/voice HIT');
  
    const VoiceResponse = twilio.twiml.VoiceResponse;
  
    const customerName = clean(req.query.name, 'Customer');
    const productName = clean(req.query.product, 'your product');
    const productPrice = clean(req.query.price, '0');
    const orderId = req.query.orderId || '';
    const callSid = req.body?.CallSid || req.query?.CallSid;
  
    const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    const gatherUrl = `${appUrl}/twilio/gather?orderId=${encodeURIComponent(orderId)}&CallSid=${encodeURIComponent(callSid || '')}`;
  
    // Start AI Agent session
    try {
      const { Agent } = await import('../integrations/ai/agent.js');
      const agent = new Agent({ promptType: 'orderConfirmation' });
      await agent.startConversation(`Order ID: ${orderId}, Customer: ${customerName}, Product: ${productName}, Price: ${productPrice}`);
      if (callSid) activeCalls.set(callSid, agent);
    } catch (err) {
      console.error('❌ Failed to start AI Agent:', err);
    }
  
    const response = new VoiceResponse();
  
    const gather = response.gather({
      input: 'speech dtmf',
      action: gatherUrl,
      method: 'POST',
      timeout: 5,
      language: 'ur-PK'
    });
  
    gather.say(
      `Assalam o Alaikum ${customerName}. ` +
      `Aap ne ${productName} order kiya hai. Iski qeemat ${productPrice} rupay hai. ` +
      `Kya main aap ka order confirm karun?`
    );
  
    response.say('Koi jawab nahi mila. Allah Hafiz.');
  
    res.type('text/xml');
    res.send(response.toString());
  });

  router.all('/gather', async (req, res) => {
    console.log('🎯 /twilio/gather HIT');
  
    const speechResult = req.body?.SpeechResult || '';
    const digit = req.body?.Digits || '';
    const orderId = req.query.orderId;
    const callSid = req.body?.CallSid || req.query?.CallSid;
  
    console.log('📥 User speech:', speechResult, 'digit:', digit, 'for order:', orderId);
  
    let responseText = 'Aap ki baat samajh nahi aayi. Allah Hafiz.';
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    let endCall = false;
  
    const agent = activeCalls.get(callSid);
    
    if (agent && speechResult) {
      try {
        const { OrderStateMachine, OrderStatus } = await import('../services/OrderStateMachine.js');
        const stateMachine = new OrderStateMachine(orderId);
  
        const aiResponse = await agent.sendMessage(speechResult);
        responseText = aiResponse.text || '';
        
        if (aiResponse.functionCalls && aiResponse.functionCalls.length > 0) {
          for (const call of aiResponse.functionCalls) {
            if (call.name === 'confirm_cod_order') {
              await stateMachine.transition(OrderStatus.CONFIRMED);
              endCall = true;
            } else if (call.name === 'cancel_order') {
              await stateMachine.transition(OrderStatus.CANCELLED, call.args?.reason);
              endCall = true;
            } else if (call.name === 'transfer_to_human') {
              await stateMachine.transition(OrderStatus.HUMAN_REQUIRED, call.args?.reason);
              endCall = true;
            }
          }
        }
      } catch (err) {
        console.error('❌ AI Processing error:', err);
        responseText = 'Maazrat, system mein masla hai. Hum aap ko baad mein call karenge.';
        endCall = true;
      }
    } else {
      // Fallback to DTMF
      if (digit === '1') {
        responseText = 'Aapka order confirm ho gaya hai. Shukriya.';
        endCall = true;
        try {
          const { OrderStateMachine, OrderStatus } = await import('../services/OrderStateMachine.js');
          await new OrderStateMachine(orderId).transition(OrderStatus.CONFIRMED);
        } catch (e) {}
      } else if (digit === '2') {
        responseText = 'Aapka order cancel kar diya gaya hai. Shukriya.';
        endCall = true;
        try {
          const { OrderStateMachine, OrderStatus } = await import('../services/OrderStateMachine.js');
          await new OrderStateMachine(orderId).transition(OrderStatus.CANCELLED);
        } catch (e) {}
      }
    }
  
    if (endCall) {
      response.say(responseText || 'Shukriya. Allah Hafiz.');
      response.hangup();
      if (callSid) activeCalls.delete(callSid);
    } else {
      const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
      const gatherUrl = `${appUrl}/twilio/gather?orderId=${encodeURIComponent(orderId)}&CallSid=${encodeURIComponent(callSid || '')}`;
      
      const gather = response.gather({
        input: 'speech',
        action: gatherUrl,
        method: 'POST',
        timeout: 5,
        language: 'ur-PK'
      });
      gather.say(responseText);
    }
  
    res.type('text/xml');
    return res.send(response.toString());
  });

  router.all('/status', async (req, res) => {
    console.log('✅ /twilio/status HIT');
  
    const orderId = req.query.orderId;
    const callSid = req.body?.CallSid || req.query.CallSid || '';
    const callStatus = req.body?.CallStatus || req.query.CallStatus || 'unknown';
  
    try {
      if (orderId && callStatus) {
        await prisma.order.update({
          where: { id: orderId },
          data: { callStatus, callSid }
        });
  
        const order = await prisma.order.findUnique({
          where: { id: orderId }
        });
  
        if (!order) return res.sendStatus(200);
  
        if (order.status === 'Confirmed' || order.status === 'Cancelled') {
          return res.sendStatus(200);
        }
  
        const failedStatuses = ['busy', 'failed', 'no-answer'];
        const shouldRetry =
          failedStatuses.includes(callStatus) ||
          (callStatus === 'completed' && order.status === 'Pending Confirmation');
  
        if (shouldRetry) {
          const retryCount = order.retryCount || 0;
  
          if (retryCount >= 2) {
            await prisma.order.update({
              where: { id: orderId },
              data: { tag: 'Max Retries Reached' }
            });
            return res.sendStatus(200);
          }
  
          await prisma.order.update({
            where: { id: orderId },
            data: { retryCount: retryCount + 1, tag: 'Retry' }
          });
  
          setTimeout(async () => {
            try {
              const payload = JSON.parse(order.payload || '{}');
              const customerName =
                payload?.shipping_address?.name || payload?.customer?.first_name || 'Customer';
              let phone =
                payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone || payload?.billing_address?.phone;
  
              if (!phone) return;
              if (!phone.startsWith('+')) phone = '+92' + phone.replace(/^0/, '');
  
              const productName = payload?.line_items?.[0]?.title || 'your product';
              const productPrice = payload?.total_price || '0';
  
              await triggerCall({
                phone,
                customerName,
                productName,
                productPrice,
                orderId
              });
            } catch (err) {
              console.error('❌ Retry call failed:', err.message);
            }
          }, 60 * 1000);
        }
      }
    } catch (err) {
      console.error('❌ Call status save failed:', err.message);
    }
  
    return res.sendStatus(200);
  });

  return router;
}
