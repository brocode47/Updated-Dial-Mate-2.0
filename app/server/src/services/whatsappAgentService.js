import { prisma } from '../lib/db.js';
import { getAIClient } from '../integrations/ai/client.js';
import { ToolDispatcher } from '../integrations/ai/dispatcher.js';
import { AITools } from '../integrations/ai/tools.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { OrderEligibilityService } from './orderEligibilityService.js';
import { PhoneNormalizer } from './phoneNormalizer.js';
import { ShopifyCatalogService } from './shopifyCatalogService.js';
import { ConversationStateService } from './conversationStateService.js';

/**
 * WhatsApp AI Customer Agent Service ("Zara")
 * 
 * Production Capabilities:
 * 1. Persona: "Zara" — Courteous, professional Roman Urdu / English support assistant.
 * 2. Multi-Tenant Scoped: Strict isolation by shopId & shopDomain.
 * 3. Canonical Phone & Identity: Multi-variant matching across +92, 92, 03, dashes/spaces.
 * 4. Human Takeover: Completely silences AI when conversation.isTakeover === true.
 * 5. Factual Shopify Grounding: Authoritative catalog service, non-NaN pricing, clickable storefront URLs.
 * 6. Structured Conversational Memory: Tracks search context, handles "aur dikhao" pagination and ordinal references.
 * 7. Anti-Hallucination & Negation Safety: Strict guards against unauthorized confirmation/cancellation.
 */
export class WhatsAppAgentService {
  /**
   * Sanitizes customer-facing text to guarantee zero NaN, undefined, or null leaks
   * 
   * @param {string} text 
   * @returns {string}
   */
  static sanitizeResponse(text) {
    if (!text) return '';
    let clean = String(text);
    clean = clean.replace(/Rs\.\s*NaN/gi, 'Price on request');
    clean = clean.replace(/\bNaN\b/g, '0');
    clean = clean.replace(/\bundefined\b/g, '');
    clean = clean.replace(/\bnull\b/g, '');
    clean = clean.replace(/\[object Object\]/g, '');
    return clean.replace(/\n{3,}/g, '\n\n').trim();
  }

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
      return /\b(nahi|na|mat|never|don't|dont|not)\s+(confirm|dispatch|bhejo|bhejna)\b/i.test(clean) ||
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
    if (/\b(human|agent|operator|representative|insan|asli banda|real person|real banda|call back|rabta|support team)\b/i.test(clean)) {
      return { intent: 'HUMAN_TRANSFER', confidence: 0.95 };
    }

    // 3. Negation checks before keyword matching
    const cancelNegated = this.isNegated(clean, 'cancel');
    const confirmNegated = this.isNegated(clean, 'confirm');

    // "Order cancel mat karna / confirm hi rakhna"
    if (cancelNegated && /\b(confirm|bhej|dispatch)\b/i.test(clean)) {
      return { intent: 'CONFIRM', confidence: 0.92 };
    }

    // Explicit cancellation phrases or cancel negation
    if (/\b(cancel\s*(kar|kardo|karein|karna|dein)?|nahi\s*chahiye|wapas|mat\s*bhejo)\b/i.test(clean) || cancelNegated) {
      return { intent: 'CANCEL', confidence: 0.95 };
    }

    // Confirmation phrases or confirm negation
    if (/\b(confirm\s*(kar|kardo|karein|karna|dein)?|haan|yes|ji|dispatch\s*(kar|kardo|dein)?|bhej\s*(do|dein)?)\b/i.test(clean) || confirmNegated) {
      return { intent: 'CONFIRM', confidence: 0.90 };
    }

    // 4. "Aur dikhao" / Pagination intent
    if (/\b(aur\s*dikhao|aur\s*dikha|aur\s*bhejo|aur\s*batao|mazeed\s*dikhao|next\s*page|more\s*products|aur\s*items)\b/i.test(clean) || clean === 'aur dikhao' || clean === 'more') {
      return { intent: 'MORE', confidence: 0.95 };
    }

    // 5. Ordinal or Contextual Product References ("pehle wale", "doosre ka link", "iska price")
    if (/\b(pehle\s*wale|doosre\s*wale|dusre\s*wale|teesre|tisre|chothe|paanchwe|1st|2nd|3rd|number\s*1|number\s*2|iska\s*(price|link|rate)|iski\s*(price|link|rate)|ye\s*wala|yeh\s*wala)\b/i.test(clean)) {
      return { intent: 'ORDINAL_REFERENCE', confidence: 0.92 };
    }

    // 6. Direct Order queries
    if (/\b(order\s*status|status\s*kya\s*hai|status\s*batao|order\s*kahan\s*tak|status)\b/i.test(clean)) {
      return { intent: 'ORDER_STATUS', confidence: 0.95 };
    }

    if (/\b(delivery\s*charges|shipping\s*charges|delivery\s*ke\s*kitne|delivery\s*cost)\b/i.test(clean)) {
      return { intent: 'ORDER_DELIVERY_CHARGES', confidence: 0.95 };
    }

    if (/\b(iska\s*total|total\s*kitna|total\s*bill|kitne\s*paise|total\s*amount|cod\s*amount|kitna\s*bill)\b/i.test(clean)) {
      return { intent: 'ORDER_TOTAL', confidence: 0.95 };
    }

    if (/\b(mera\s*order\s*kya\s*hai|kya\s*order\s*hai|order\s*details|kya\s*order\s*kiya|kya\s*mangwaya|mera\s*order)\b/i.test(clean)) {
      return { intent: 'ORDER_SUMMARY', confidence: 0.95 };
    }

    // 7. Store / Website link
    if (/\b(website\s*(ka\s*)?(link|url)?|store\s*(ka\s*)?(link|url)|website\s*kya\s*hai|online\s*store)\b/i.test(clean) && !/\b(product|item|iska)\b/i.test(clean)) {
      return { intent: 'STORE_LINK', confidence: 0.95 };
    }

    // 8. Collection requests
    if (/\b(collection|collections|kitchen\s*collection|mobile\s*accessories|women\s*collection|cleaning\s*collection)\b/i.test(clean)) {
      return { intent: 'COLLECTION', confidence: 0.90 };
    }

    // 9. Catalog browsing
    if (/\b(catalog\s*dikhao|products\s*dikhao|sari\s*items|tamam\s*products|kya\s*kya\s*hai|list\s*bhejo|sab\s*products)\b/i.test(clean)) {
      return { intent: 'CATALOG', confidence: 0.92 };
    }

    // 10. Single Product Detail inquiry
    if (/\b(ki\s*price|ka\s*rate|kitne\s*ka\s*hai|price\s*batao|rate\s*batao|kitne\s*ka)\b/i.test(clean)) {
      return { intent: 'PRODUCT_DETAIL', confidence: 0.88 };
    }

    // 11. General Product search
    if (/\b(product|item|price|kya hai|available|stock|dusra|aur|cover|belt|shoes|shirt|suit|rate|wall\s*max)\b/i.test(clean)) {
      return { intent: 'PRODUCT_INQUIRY', confidence: 0.85 };
    }

    return { intent: 'GENERAL_QUERY', confidence: 0.60 };
  }

  /**
   * Main entry point to process incoming WhatsApp messages
   */
  static async handleIncomingMessage(params) {
    const {
      shopId,
      shopDomain,
      sessionId,
      messageId = null
    } = params;
    const fromPhone = params.fromPhone || params.fromJid || params.phone;
    const messageText = params.messageText || params.text || '';
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

    // 2. Resolve Customer Identity via canonical PhoneNormalizer (tenant-scoped)
    const customer = await PhoneNormalizer.resolveCustomer(shop.id, fromPhone);
    const cleanPhone = customer?.phone || OrderEligibilityService.cleanPhoneNumber(fromPhone) || String(fromPhone).replace(/[^0-9]/g, '');

    // Initialize WA Client and immediately signal typing presence (non-blocking)
    const waClient = new WhatsAppClient({
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY,
      sessionId: String(sessionId || ''),
      shopId: String(shop.id)
    });
    if (typeof waClient?.sendPresence === 'function') {
      waClient.sendPresence(fromPhone, 'composing').catch(() => {});
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

    // 6. Resolve Active & Relevant Orders via canonical PhoneNormalizer
    const orders = await PhoneNormalizer.resolveOrders(shop.id, customer?.id, fromPhone);
    const recentOrder = orders[0] || null;
    const orderContext = recentOrder;

    const storeName = shop.name || shop.domain.replace('.myshopify.com', '');
    const detected = this.detectIntent(messageText);
    let replyText = '';
    let executedAction = null;
    let usedLLM = false;

    // 7. Intent Execution & Deterministic Fast-Paths
    if (detected.intent === 'CONFIRM') {
      if (recentOrder) {
        if (this.isNegated(messageText, 'confirm')) {
          replyText = `Aapka order confirm nahi kiya gaya hai. Agar aap cancel karna chahtay hain to reply "2" ya "Cancel" likhein.`;
        } else {
          await ToolDispatcher.dispatch('confirm_order', { orderId: recentOrder.orderId }, {
            shopDomain: shop.domain,
            orderId: recentOrder.orderId
          });
          executedAction = 'confirm_order';
          replyText = `Bohat shukriya! Aapka order #${recentOrder.orderNumber} confirm kar diya gaya hai aur jald dispatch kar diya jaye ga. Agar mazeed koi rehnumai chahiye ho to zaroor batayein.`;
        }
      } else {
        replyText = `Mujhe aapka koi pending order nahi mila confirm karne ke liye. Agar aapke paas order number hai to zaroor batayein.`;
      }
    } else if (detected.intent === 'CANCEL') {
      if (recentOrder) {
        if (this.isNegated(messageText, 'cancel')) {
          replyText = `Theek hai, aapka order cancel nahi kiya gaya. Yeh confirm state mein hi rahega. Shukriya!`;
        } else {
          await ToolDispatcher.dispatch('cancel_order', { orderId: recentOrder.orderId, reason: 'customer_whatsapp_cancellation' }, {
            shopDomain: shop.domain,
            orderId: recentOrder.orderId
          });
          executedAction = 'cancel_order';
          replyText = `Aapka order #${recentOrder.orderNumber} cancel kar diya gaya hai. Agar aapko koi aur product chahiye ho to hum se rabta kar saktay hain. Shukriya!`;
        }
      } else {
        replyText = `Mujhe aapka koi order nahi mila cancel karne ke liye. Agar aapke paas order number hai to zaroor batayein.`;
      }
    } else if (detected.intent === 'HUMAN_TRANSFER') {
      await ToolDispatcher.dispatch('request_human_transfer', {
        orderId: recentOrder?.orderId,
        reason: 'Customer requested human support via WhatsApp'
      }, {
        shopDomain: shop.domain,
        orderId: recentOrder?.orderId
      });
      // Mark conversation as taken over so Zara stays silent
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { isTakeover: true }
      }).catch(() => {});

      executedAction = 'request_human_transfer';
      replyText = `Maine hamari human support team ko inform kar diya hai. Hamara representative jald hi aapse isi WhatsApp chat par rabta karega. Shukriya!`;
    } else if (detected.intent === 'ORDER_SUMMARY') {
      executedAction = 'order_summary_fastpath';
      if (orders.length === 1) {
        replyText = `Aapka order #${recentOrder.orderNumber} hai jisme "${recentOrder.items}" shamil hai. Iska kul COD bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai aur status "${recentOrder.status}" hai.`;
      } else if (orders.length > 1) {
        const list = orders.slice(0, 3).map(o => `• Order #${o.orderNumber || o.id.slice(0, 6)} (Rs. ${Number(o.totalAmount).toLocaleString()}) — ${o.items}`).join('\n');
        replyText = `Aapke ${orders.length} orders record mein hain:\n\n${list}\n\nAap kis order ke baare mein maloomat chahtay hain?`;
      } else {
        replyText = `Mujhe aapke number se koi order nahi mila. Kya aap apna order number (jaise #1643) share kar saktay hain taake main check kar sakoon?`;
      }
    } else if (detected.intent === 'ORDER_TOTAL' && recentOrder) {
      executedAction = 'order_total_fastpath';
      replyText = `Aapke order #${recentOrder.orderNumber} ka kul COD total Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
    } else if (detected.intent === 'ORDER_DELIVERY_CHARGES' && recentOrder) {
      executedAction = 'order_delivery_charges_fastpath';
      if (recentOrder.shippingFee > 0) {
        replyText = `Aapke order #${recentOrder.orderNumber} ke delivery charges Rs. ${Number(recentOrder.shippingFee).toLocaleString()} hain. Kul bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
      } else {
        replyText = `Aapke order #${recentOrder.orderNumber} par standard delivery bilkul free hai! Kul bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
      }
    } else if (detected.intent === 'ORDER_STATUS' && recentOrder) {
      executedAction = 'order_status_fastpath';
      replyText = `Aapke order #${recentOrder.orderNumber} ka current status "${recentOrder.status}" hai.`;
    } else if (detected.intent === 'MORE') {
      executedAction = 'catalog_pagination_more';
      const state = await ConversationStateService.getState(conversation.id);
      const nextPage = (state.currentPage || 1) + 1;
      const query = state.lastQuery || '';
      const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, query, { page: nextPage, limit: 5 });

      if (searchRes.products && searchRes.products.length > 0) {
        await ConversationStateService.updateState(conversation.id, {
          lastProducts: searchRes.products,
          currentPage: nextPage,
          totalFound: searchRes.totalFound
        });
        const list = searchRes.products.map((p, idx) => `${(nextPage - 1) * 5 + idx + 1}. *${p.title}* — ${p.formattedPrice}\n🔗 ${p.url}`).join('\n\n');
        replyText = `Yeh mazeed products hain:\n\n${list}\n\nMore products ke liye hamari collection dekhein:\n🔗 ${searchRes.allProductsUrl}`;
      } else {
        const storeInfo = await ShopifyCatalogService.getStoreInfo(shop.domain);
        replyText = `Is category mein mazeed items nahi hain. Aap hamara poora catalog yahan dekh saktay hain:\n🔗 ${storeInfo.catalogUrl}`;
      }
    } else if (detected.intent === 'ORDINAL_REFERENCE') {
      executedAction = 'ordinal_reference_resolution';
      const refProduct = await ConversationStateService.resolveProductReference(conversation.id, messageText);
      if (refProduct) {
        if (/\b(price|kitne|rate|paisa|cost)\b/i.test(messageText)) {
          replyText = `Ji, *${refProduct.title}* ki price ${refProduct.formattedPrice} hai.\n🔗 ${refProduct.url}`;
        } else if (/\b(link|url|website)\b/i.test(messageText)) {
          replyText = `Yeh raha *${refProduct.title}* ka product link:\n🔗 ${refProduct.url}`;
        } else if (/\b(available|stock|hai)\b/i.test(messageText)) {
          replyText = `Ji, *${refProduct.title}* filhal ${refProduct.available ? 'stock mein available hai' : 'out of stock hai'}. Price: ${refProduct.formattedPrice}.\n🔗 ${refProduct.url}`;
        } else {
          replyText = `*${refProduct.title}*\nPrice: ${refProduct.formattedPrice}\nStatus: ${refProduct.available ? 'In Stock' : 'Out of Stock'}\n🔗 ${refProduct.url}`;
        }
      }
    } else if (detected.intent === 'STORE_LINK') {
      executedAction = 'store_link';
      const storeInfo = await ShopifyCatalogService.getStoreInfo(shop.domain);
      replyText = `Aap hamari website yahan visit kar saktay hain:\n🔗 ${storeInfo.storefrontUrl}\n\nTamam products dekhne ke liye:\n🔗 ${storeInfo.catalogUrl}`;
    } else if (detected.intent === 'COLLECTION') {
      executedAction = 'collections_lookup';
      const collections = await ShopifyCatalogService.getCollections(shop.domain, messageText);
      const list = collections.map(c => `• *${c.title}*:\n🔗 ${c.url}`).join('\n\n');
      replyText = `Hamari store collections yeh hain:\n\n${list}`;
    } else if (detected.intent === 'CATALOG') {
      executedAction = 'catalog_browse';
      const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, '', { page: 1, limit: 5 });
      await ConversationStateService.updateState(conversation.id, {
        lastProducts: searchRes.products,
        currentPage: 1,
        totalFound: searchRes.totalFound,
        lastQuery: ''
      });
      const list = searchRes.products.map((p, idx) => `${idx + 1}. *${p.title}* — ${p.formattedPrice}\n🔗 ${p.url}`).join('\n\n');
      replyText = `Hamare popular products yeh hain:\n\n${list}\n\nAur dekhne ke liye "aur dikhao" likhein ya collection visit karein:\n🔗 ${searchRes.allProductsUrl}`;
    }

    // 8. Conversational Gemini AI Engine (Multi-Turn with Authoritative Grounding)
    if (!replyText) {
      try {
        const aiClient = getAIClient();
        const availableTools = [
          AITools.search_shopify_products,
          AITools.get_shopify_product_details,
          AITools.get_shopify_collections,
          AITools.get_store_info,
          AITools.confirm_order,
          AITools.cancel_order,
          AITools.request_human_transfer
        ];

        const systemInstruction = (
`You are Zara, the courteous, helpful AI customer support agent for "${storeName}".
You are assisting a customer on WhatsApp.
Speak natural, professional Roman Urdu and English.

Customer & Store Context:
- Store: ${storeName}
- Customer Phone: ${cleanPhone}
${recentOrder ? `- Order #${recentOrder.orderNumber} (Rs. ${recentOrder.totalAmount}) - Items: ${recentOrder.items} - Status: ${recentOrder.status}` : '- No active order.'}

STRICT INSTRUCTIONS:
1. When asked about product pricing, availability, or details (e.g. "Adhesive wall max ki price batao", "iska link do"):
   Call 'get_shopify_product_details' or 'search_shopify_products'.
   When the tool returns the product, ANSWER THE CUSTOMER'S ACTUAL QUESTION FIRST (e.g. state the exact price or send the link).
   Do NOT return a generic product list when they asked for a specific product's price.
2. When asked for catalog or multiple items (e.g. "catalog dikhao", "kitchen items"):
   Call 'search_shopify_products'. Provide up to 5 relevant items with their name, price, and clickable link.
   Do NOT overwhelm with too many items. Mention the collection link for more.
3. When customer asks for store link or website:
   Call 'get_store_info'.
4. Do NOT push for an order after every inquiry. Answer helpfully first.
5. NEVER invent prices, products, or discounts. Shopify is the source of truth.
6. If customer wants to confirm order, call 'confirm_order'. If cancel, call 'cancel_order'. If human support, call 'request_human_transfer'.`
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

        const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
        const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10);

        const geminiCall = aiClient.models.generateContent({
          model: geminiModel,
          contents: prompt,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: availableTools }]
          }
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Gemini API timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        const response = await Promise.race([geminiCall, timeoutPromise]);
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
            orderId: recentOrder?.orderId
          });

          // Update conversational state with products returned
          const returnedProducts = toolResult?.products || (toolResult?.product ? [toolResult.product] : []);
          if (returnedProducts.length > 0) {
            await ConversationStateService.updateState(conversation.id, {
              lastProducts: returnedProducts,
              lastReferencedProduct: returnedProducts[0],
              lastQuery: call.args?.query || '',
              currentPage: toolResult.page || 1,
              totalFound: toolResult.totalFound || returnedProducts.length
            });
          }

          // Second turn: feed result back to Gemini so it produces natural, direct answer
          try {
            const turn2Call = aiClient.models.generateContent({
              model: geminiModel,
              contents: [
                { role: 'user', parts: [{ text: messageText }] },
                candidate.content,
                {
                  role: 'user',
                  parts: [{
                    functionResponse: {
                      name: call.name,
                      response: toolResult
                    }
                  }]
                }
              ],
              config: {
                systemInstruction
              }
            });

            const turn2Res = await Promise.race([turn2Call, timeoutPromise]);
            replyText = turn2Res.text || turn2Res.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
          } catch (turn2Err) {
            console.warn(`⚠️ [WhatsAppAgent] Gemini Turn 2 notice (${turn2Err.message}). Using clean factual format.`);
          }

          // Fallback if Turn 2 is empty
          if (!replyText) {
            if (call.name === 'get_shopify_product_details' && toolResult?.product) {
              const p = toolResult.product;
              replyText = `Ji, *${p.title}* ki price ${p.formattedPrice} hai aur yeh filhal ${p.available ? 'in stock' : 'out of stock'} hai.\n🔗 ${p.url}`;
            } else if (call.name === 'search_shopify_products') {
              const products = toolResult?.products || [];
              if (products.length > 0) {
                const list = products.slice(0, 5).map((p, idx) => `${idx + 1}. *${p.title}* — ${p.formattedPrice}\n🔗 ${p.url}`).join('\n\n');
                replyText = `Hamare paas yeh products available hain:\n\n${list}\n\nTamam collection yahan dekhein:\n🔗 ${toolResult.allProductsUrl}`;
              } else {
                replyText = `Maazrat, aapki matlooba item filhal stock mein nahi hai. Hamara catalog yahan dekh saktay hain: https://${shop.domain}/collections/all-products`;
              }
            } else if (call.name === 'get_shopify_collections') {
              const list = (toolResult?.collections || []).map(c => `• *${c.title}*:\n🔗 ${c.url}`).join('\n\n');
              replyText = `Hamari collections yeh hain:\n\n${list}`;
            } else if (call.name === 'get_store_info') {
              replyText = `Hamari website visit karein:\n🔗 ${toolResult?.storefrontUrl}\n\nCatalog:\n🔗 ${toolResult?.catalogUrl}`;
            } else if (call.name === 'confirm_order') {
              replyText = `Bohat shukriya! Aapka order #${recentOrder?.orderNumber || ''} confirm kar diya gaya hai aur dispatch ke liye tayar hai.`;
            } else if (call.name === 'cancel_order') {
              replyText = `Aapka order #${recentOrder?.orderNumber || ''} cancel kar diya gaya hai. Shukriya!`;
            } else if (call.name === 'request_human_transfer') {
              replyText = `Maine hamari human support team ko inform kar diya hai. Hamara representative jald hi aapse isi chat par rabta karega.`;
            }
          }
        } else {
          replyText = response.text || candidate?.content?.parts?.find(p => p.text)?.text || '';
        }
      } catch (aiErr) {
        console.warn(`⚠️ [WhatsAppAgent] Gemini API unavailable or timed out (${aiErr.message}). Using safe conversational fallback.`);
        if (recentOrder) {
          replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Aapka order #${recentOrder.orderNumber} (Rs. ${recentOrder.totalAmount}) process mein hai. Confirm karne ke liye 1 aur cancel ke liye 2 reply karein.`;
        } else {
          replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Main aapki kya madad kar sakti hoon?`;
        }
      }
    }

    if (!replyText) {
      replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Aapka message receive ho gaya hai. Main aapki kya madad kar sakti hoon?`;
    }

    // 9. Sanitize response (permanent zero-NaN guarantee)
    replyText = this.sanitizeResponse(replyText);

    // 10. Persist assistant reply
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'assistant',
        text: replyText
      }
    });

    // 11. Record interaction log
    await prisma.aIInteractionLog.create({
      data: {
        shopId: shop.id,
        customerId: customer?.id || null,
        conversationId: conversation.id,
        userMessage: messageText,
        detectedAgent: 'Zara',
        intent: detected.intent,
        action: executedAction || 'REPLY',
        modelUsed: usedLLM ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : 'rule_engine',
        usedLLM,
        responseTimeMs: Date.now() - startTime,
        status: 'SUCCESS'
      }
    }).catch(() => {});

    // 12. Send reply via WA-AKG Client
    try {
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
