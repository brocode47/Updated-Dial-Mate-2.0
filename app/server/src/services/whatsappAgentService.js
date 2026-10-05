import { prisma } from '../lib/db.js';
import { getAIClient } from '../integrations/ai/client.js';
import { ToolDispatcher } from '../integrations/ai/dispatcher.js';
import { AITools } from '../integrations/ai/tools.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { OrderEligibilityService } from './orderEligibilityService.js';

/**
 * WhatsApp AI Customer Agent Service ("Zara")
 * 
 * Production Capabilities:
 * 1. Persona: "Zara" — Courteous, professional Roman Urdu / English support assistant.
 * 2. Multi-Tenant Scoped: Strict isolation by shopId & shopDomain.
 * 3. Shared Context: Seamlessly accesses customer profile, conversation history, and active order.
 * 4. Human Takeover: Completely silences AI when conversation.isTakeover === true.
 * 5. Tool Integration:
 *    - search_shopify_products: Factual catalog querying
 *    - confirm_order: Order confirmation in DB & Shopify
 *    - cancel_order: Order cancellation in DB & Shopify
 *    - request_human_transfer: Immediate escalation to human support
 * 6. Negation Safety:
 *    - Strict guard against false positives (e.g. "cancel nahi karna", "confirm mat karna").
 * 7. Multi-Turn Conversation: Feeds prior message context to Gemini.
 */
export class WhatsAppAgentService {
  /**
   * Evaluates text for negation patterns to prevent hazardous false actions
   * 
   * @param {string} text - Message text
   * @param {'confirm'|'cancel'} action - Target action
   * @returns {boolean} True if negation is detected
   */
  static isNegated(text, action) {
    const clean = String(text || '').toLowerCase().trim();
    if (action === 'confirm') {
      // Customer expressing: do NOT confirm
      return /\b(nahi|na|mat|never|don't|dont|not)\s+(confirm|karna|karo|dispatch|bhejo|bhejna)\b/i.test(clean) ||
             /\b(confirm|dispatch|bhejo|bhejna)\s+(nahi|na|mat|karna\s+nahi)\b/i.test(clean) ||
             /\b(cancel\s*(kar|kardo|karna))\b/i.test(clean);
    }
    if (action === 'cancel') {
      // Customer expressing: do NOT cancel
      return /\b(nahi|na|mat|never|don't|dont|not)\s+(cancel|radd|rokna)\b/i.test(clean) ||
             /\b(cancel)\s+(nahi|na|mat|mat\s+karna)\b/i.test(clean) ||
             /\b(confirm\s*hi\s*rakhna|bhejna\s*hi\s*hai)\b/i.test(clean);
    }
    return false;
  }

  /**
   * Detects customer intent from message text
   */
  static detectIntent(text) {
    const clean = String(text || '').toLowerCase().trim();

    // 1. Direct code shortcuts
    if (clean === '1' || clean === 'confirm') {
      return { intent: 'CONFIRM', confidence: 0.99 };
    }
    if (clean === '2' || clean === 'cancel') {
      return { intent: 'CANCEL', confidence: 0.99 };
    }

    // 2. Human escalation request
    if (/\b(human|agent|operator|representative|insan|asli banda|call back|rabta|support team)\b/i.test(clean)) {
      return { intent: 'HUMAN_TRANSFER', confidence: 0.95 };
    }

    // 3. Negation checks before keyword matching
    const cancelNegated = this.isNegated(clean, 'cancel');
    const confirmNegated = this.isNegated(clean, 'confirm');

    // "Order cancel mat karna / confirm hi rakhna"
    if (cancelNegated && /\b(confirm|bhej|dispatch)\b/i.test(clean)) {
      return { intent: 'CONFIRM', confidence: 0.92 };
    }

    // Explicit cancellation phrases
    if (/\b(cancel\s*(kar|kardo|karein|karna|dein)?|nahi\s*chahiye|wapas|mat\s*bhejo)\b/i.test(clean)) {
      if (!cancelNegated) {
        return { intent: 'CANCEL', confidence: 0.95 };
      }
    }

    // Confirmation phrases (or confirm negation)
    if (/\b(confirm\s*(kar|kardo|karein|karna|dein)?|haan|yes|ji|dispatch\s*(kar|kardo|dein)?|bhej\s*(do|dein)?)\b/i.test(clean) || confirmNegated) {
      return { intent: 'CONFIRM', confidence: 0.90 };
    }

    // Product search inquiries
    if (/\b(product|item|price|kya hai|available|stock|dusra|aur|cover|belt|shoes|shirt|suit|rate)\b/i.test(clean)) {
      return { intent: 'PRODUCT_INQUIRY', confidence: 0.85 };
    }

    return { intent: 'GENERAL_QUERY', confidence: 0.60 };
  }

  /**
   * Main entry point to process incoming WhatsApp messages
   */
  static async handleIncomingMessage({
    shopId,
    shopDomain,
    sessionId,
    fromPhone,
    messageText,
    messageId = null
  }) {
    const startTime = Date.now();
    console.log(`🤖 [WhatsAppAgent] Processing incoming message from ${fromPhone} (Shop: ${shopDomain}, Session: ${sessionId}): "${messageText}"`);

    // 1. Resolve Shop
    let shop = null;
    if (shopId) {
      shop = await prisma.shop.findUnique({ where: { id: shopId } });
    }
    if (!shop && shopDomain) {
      shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
    }
    if (!shop) {
      throw new Error(`Shop not found for incoming WhatsApp message: ${shopId || shopDomain}`);
    }

    const cleanPhone = OrderEligibilityService.cleanPhoneNumber(fromPhone) || fromPhone.replace(/[^0-9]/g, '');

    // 2. Find or Create Customer
    let customer = await prisma.customer.findFirst({
      where: { shopId: shop.id, phone: cleanPhone }
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          shopId: shop.id,
          phone: cleanPhone
        }
      }).catch(() => null);
    }

    // 3. Find or Create Conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        shopId: shop.id,
        ...(customer?.id ? { customerId: customer.id } : {}),
        channel: 'WHATSAPP'
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 8
        }
      }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          shopId: shop.id,
          customerId: customer?.id || null,
          channel: 'WHATSAPP',
          status: 'ACTIVE'
        },
        include: {
          messages: true
        }
      });
    }

    // 4. Human Takeover Check: If human agent has taken over, AI stays completely silent
    if (conversation.isTakeover) {
      console.log(`👤 [WhatsAppAgent] Human takeover active for Conversation ${conversation.id}. AI agent will not respond.`);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'customer',
          text: messageText
        }
      });
      return {
        success: true,
        handledByHuman: true,
        conversationId: conversation.id
      };
    }

    // 5. Persist incoming customer message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'customer',
        text: messageText
      }
    });

    // 6. Resolve Active/Recent Order Context
    const recentOrder = await prisma.order.findFirst({
      where: {
        shopId: shop.id,
        OR: [
          ...(customer?.id ? [{ customerId: customer.id }] : []),
          { payload: { contains: cleanPhone } }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    let orderContext = null;
    if (recentOrder) {
      let payload = {};
      if (recentOrder.payload) {
        try {
          payload = typeof recentOrder.payload === 'string' ? JSON.parse(recentOrder.payload) : recentOrder.payload;
        } catch (_) {}
      }
      if (!payload || typeof payload !== 'object') payload = {};

      const itemTitles = (payload.line_items || []).map(i => i.title || i.name).join(', ') || 'item';
      orderContext = {
        orderId: recentOrder.id,
        orderNumber: recentOrder.orderNumber || payload.order_number || recentOrder.id.slice(0, 6),
        status: recentOrder.status,
        totalAmount: recentOrder.totalAmount,
        items: itemTitles
      };
    }

    const storeName = shop.name || shop.domain.replace('.myshopify.com', '');
    const detected = this.detectIntent(messageText);
    let replyText = '';
    let executedAction = null;
    let usedLLM = false;

    // 7. Intent Execution & Deterministic Fast-Path
    if (detected.intent === 'CONFIRM' && orderContext) {
      // Negation safety guard
      if (this.isNegated(messageText, 'confirm')) {
        replyText = `Aapka order confirm nahi kiya gaya hai. Agar aap cancel karna chahtay hain to reply "2" ya "Cancel" likhein.`;
      } else {
        const toolResult = await ToolDispatcher.dispatch('confirm_order', { orderId: orderContext.orderId }, {
          shopDomain: shop.domain,
          orderId: orderContext.orderId
        });
        executedAction = 'confirm_order';
        replyText = `Bohat shukriya! Aapka order #${orderContext.orderNumber} confirm kar diya gaya hai aur jald dispatch kar diya jaye ga. Agar mazeed koi rehnumai chahiye ho to zaroor batayein.`;
      }
    } else if (detected.intent === 'CANCEL' && orderContext) {
      // Negation safety guard
      if (this.isNegated(messageText, 'cancel')) {
        replyText = `Theek hai, aapka order cancel nahi kiya gaya. Yeh confirm state mein hi rahega. Shukriya!`;
      } else {
        const toolResult = await ToolDispatcher.dispatch('cancel_order', { orderId: orderContext.orderId, reason: 'customer_whatsapp_cancellation' }, {
          shopDomain: shop.domain,
          orderId: orderContext.orderId
        });
        executedAction = 'cancel_order';
        replyText = `Aapka order #${orderContext.orderNumber} cancel kar diya gaya hai. Agar aapko koi aur product chahiye ho to hum se rabta kar saktay hain. Shukriya!`;
      }
    } else if (detected.intent === 'HUMAN_TRANSFER') {
      const toolResult = await ToolDispatcher.dispatch('request_human_transfer', {
        orderId: orderContext?.orderId,
        reason: 'Customer requested human support via WhatsApp'
      }, {
        shopDomain: shop.domain,
        orderId: orderContext?.orderId
      });
      executedAction = 'request_human_transfer';
      replyText = `Maine hamari human support team ko inform kar diya hai. Hamara representative jald hi aapse isi WhatsApp chat par rabta karega. Shukriya!`;
    } else {
      // 8. Conversational Gemini AI Engine
      try {
        const aiClient = getAIClient();
        const availableTools = [
          AITools.search_shopify_products,
          AITools.confirm_order,
          AITools.cancel_order,
          AITools.request_human_transfer
        ];

        const systemInstruction = (
`You are Zara, the courteous, helpful AI customer support agent for "${storeName}".
You are assisting a customer on WhatsApp.
Always speak friendly, professional Roman Urdu and English.

Customer & Store Context:
- Store Name: ${storeName}
- Customer Phone: ${cleanPhone}
${orderContext ? `- Active Order: #${orderContext.orderNumber} (ID: ${orderContext.orderId})
- Order Status: ${orderContext.status}
- Total COD: Rs. ${orderContext.totalAmount}
- Items: ${orderContext.items}` : '- No active order found.'}

Rules:
1. If the customer asks about available products, pricing, or catalog, ALWAYS use the 'search_shopify_products' tool with relevant keywords.
2. If the customer clearly wants to confirm their order, call 'confirm_order'. NEVER confirm if they say not to confirm.
3. If the customer wants to cancel, call 'cancel_order'. NEVER cancel if they say not to cancel.
4. If the customer is upset, asks for human support, or wants a real person, call 'request_human_transfer'.
5. Keep your WhatsApp responses concise, clear, and polite.`
        );

        // Build prior history messages
        const historyParts = (conversation.messages || [])
          .slice()
          .reverse()
          .map(m => `${m.sender === 'customer' ? 'Customer' : 'Zara'}: ${m.text}`)
          .join('\n');

        const prompt = (
`${historyParts ? `Recent Conversation:\n${historyParts}\n\n` : ''}Customer: ${messageText}
Zara:`
        );

        const response = await aiClient.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
          contents: prompt,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: availableTools }]
          }
        });

        usedLLM = true;

        // Check if Gemini invoked any function call
        const candidate = response.candidates?.[0];
        const functionCalls = candidate?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall) || [];

        if (functionCalls.length > 0) {
          const call = functionCalls[0];
          console.log(`🔧 [WhatsAppAgent] Gemini called tool: ${call.name}`, call.args);
          executedAction = call.name;

          // Tool dispatch with tenant context
          const toolResult = await ToolDispatcher.dispatch(call.name, call.args || {}, {
            shopDomain: shop.domain,
            orderId: orderContext?.orderId
          });

          // Second turn: feed result to Gemini or format answer
          if (call.name === 'search_shopify_products') {
            const products = toolResult?.products || toolResult?.data || [];
            if (products.length > 0) {
              const productList = products.slice(0, 3).map(p => `• *${p.title}* - Rs. ${Number(p.price || 0).toLocaleString()}`).join('\n');
              replyText = `Hamare paas yeh products available hain:\n\n${productList}\n\nKya aap in mein se kisi ka order place karna chahtay hain?`;
            } else {
              replyText = `Maazrat, aapki matlooba item hamare paas filhal stock mein nahi hai. Kya aap koi aur product dekhna chahein gay?`;
            }
          } else if (call.name === 'confirm_order') {
            replyText = `Bohat shukriya! Aapka order #${orderContext?.orderNumber || ''} confirm kar diya gaya hai aur dispatch ke liye tayar hai.`;
          } else if (call.name === 'cancel_order') {
            replyText = `Aapka order #${orderContext?.orderNumber || ''} cancel kar diya gaya hai. Shukriya!`;
          } else if (call.name === 'request_human_transfer') {
            replyText = `Maine hamari human support team ko inform kar diya hai. Hamara representative jald hi aapse isi chat par rabta karega.`;
          } else {
            replyText = candidate?.content?.parts?.find(p => p.text)?.text || 'Aapka bohat shukriya! Main aapki mazeed kya madad kar sakti hoon?';
          }
        } else {
          replyText = response.text || candidate?.content?.parts?.find(p => p.text)?.text || '';
        }
      } catch (aiErr) {
        console.warn(`⚠️ [WhatsAppAgent] Gemini API unavailable (${aiErr.message}). Using safe conversational fallback.`);
        if (orderContext) {
          replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Aapka order #${orderContext.orderNumber} (Rs. ${orderContext.totalAmount}) process mein hai. Confirm karne ke liye 1 aur cancel ke liye 2 reply karein.`;
        } else {
          replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Main aapki kya madad kar sakti hoon?`;
        }
      }
    }

    if (!replyText) {
      replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Aapka message receive ho gaya hai. Main aapki kya madad kar sakti hoon?`;
    }

    // 9. Persist assistant reply
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'assistant',
        text: replyText
      }
    });

    // 10. Record interaction log
    await prisma.aIInteractionLog.create({
      data: {
        shopId: shop.id,
        customerId: customer?.id || null,
        conversationId: conversation.id,
        userMessage: messageText,
        detectedAgent: 'Zara',
        intent: detected.intent,
        action: executedAction || 'REPLY',
        modelUsed: usedLLM ? (process.env.GEMINI_MODEL || 'gemini-3.8-flash') : 'rule_engine',
        usedLLM,
        responseTimeMs: Date.now() - startTime,
        status: 'SUCCESS'
      }
    }).catch(() => {});

    // 11. Send reply via WA-AKG Client
    try {
      const waClient = new WhatsAppClient({
        baseUrl: process.env.WA_AKG_BASE_URL,
        apiKey: process.env.WA_AKG_API_KEY,
        sessionId: String(sessionId),
        shopId: String(shop.id)
      });

      if (typeof waClient?.sendMessage === 'function') {
        await waClient.sendMessage(fromPhone, replyText, {
          quotedMessageId: messageId || undefined
        });
        console.log(`✅ [WhatsAppAgent] Reply sent to ${fromPhone}: "${replyText.slice(0, 50)}..."`);
      }
    } catch (sendErr) {
      console.warn(`⚠️ [WhatsAppAgent] Notice on sending WhatsApp message: ${sendErr.message}`);
    }

    return {
      success: true,
      conversationId: conversation.id,
      replyText,
      intent: detected.intent,
      action: executedAction
    };
  }
}

export default WhatsAppAgentService;
