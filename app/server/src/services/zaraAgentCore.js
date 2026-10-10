import { getAIClient } from '../integrations/ai/client.js';
import { ShopifyCatalogService } from './shopifyCatalogService.js';
import { DeliveryService } from './deliveryService.js';
import { OrderResolver } from './orderResolver.js';
import { HumanEscalationService } from './humanEscalationService.js';
import { ProductSummaryService } from './productSummaryService.js';

/**
 * ============================================================================
 * ZARA AGENT CORE — LLM CONVERSATIONAL AGENT ENGINE (PHASE 2)
 * ============================================================================
 *
 * Architecture Principles:
 * 1. LLM-Centric Conversational Reasoning:
 *    Natural language understanding, discourse continuity, pronoun resolution,
 *    topic switching, and response planning are managed natively by Gemini.
 * 2. Deterministic Business Tools:
 *    Catalog searching, product pricing, delivery calculation, order lookups,
 *    and human escalations are executed as secure server-side tools.
 * 3. Gemini Function-Calling Loop:
 *    Tool results are fed back to the model as `functionResponse` parts, allowing
 *    the LLM to reason over verified facts and synthesize grounded answers.
 * 4. Zero Hardcoded Response Templates:
 *    No rigid if/else routing or preset response phrases.
 * 5. Strict Server-Side Authorization:
 *    Customer phone, tenant shop, and order ownership are enforced server-side.
 *    Model-supplied arguments are never trusted as proof of authorization.
 * 6. Isolated Proposed State Updates:
 *    Contextual state changes (active product, active order, escalation) are
 *    returned separately from natural-language output.
 */

export const ZARA_TOOL_DEFINITIONS = [
  {
    name: 'search_shopify_products',
    description: 'Search Sunday Bazaaar catalog for matching products by keyword, category, or customer request.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Product keywords, item name, or category in English or Roman Urdu (e.g. "chair cover", "snoring", "kitchen")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_shopify_product_details',
    description: 'Retrieve authoritative price, inventory status, description, and direct link for a specific single product.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Product title or keywords'
        },
        handle: {
          type: 'STRING',
          description: 'Product handle if known'
        },
        productId: {
          type: 'STRING',
          description: 'Shopify product ID if known'
        }
      }
    }
  },
  {
    name: 'get_delivery_quote',
    description: 'Get verified delivery charges and calculate total order amount (product price + delivery) for customer city.',
    parameters: {
      type: 'OBJECT',
      properties: {
        city: {
          type: 'STRING',
          description: 'Customer delivery city in Pakistan (e.g. Karachi, Lahore, Islamabad, Multan)'
        },
        productPrice: {
          type: 'NUMBER',
          description: 'Product subtotal to calculate complete Cash on Delivery (COD) total'
        }
      }
    }
  },
  {
    name: 'resolve_order',
    description: 'Look up status, delivery tracking, items, and total amount of a customer order. Enforces authenticated phone verification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderNumber: {
          type: 'STRING',
          description: 'Exact numeric order number (e.g. 1643)'
        }
      }
    }
  },
  {
    name: 'request_human_transfer',
    description: 'Escalate to human support when customer asks for human agent, owner, manager, or expresses strong dissatisfaction.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Reason for requesting human support'
        }
      },
      required: ['reason']
    }
  },
  {
    name: 'get_store_info',
    description: 'Get general store details, return/exchange policy, Cash on Delivery coverage, and storefront website link.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'confirm_order',
    description: 'Confirm an order for dispatch after verified phone ownership check. Call ONLY when customer gives clear, unambiguous positive confirmation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderNumber: {
          type: 'STRING',
          description: 'Exact order number to confirm (e.g. 1643)'
        }
      }
    }
  },
  {
    name: 'cancel_order',
    description: 'Cancel an order in the system after verified phone ownership check. Call ONLY when customer explicitly requests cancellation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderNumber: {
          type: 'STRING',
          description: 'Exact order number to cancel (e.g. 1643)'
        },
        reason: {
          type: 'STRING',
          description: 'Reason for cancellation (e.g. customer_requested, mind_changed, too_expensive)'
        }
      },
      required: ['reason']
    }
  },
  {
    name: 'reject_product',
    description: 'Mark the currently discussed product as rejected/declined when the customer says no, rejects it, or asks for something completely different.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Customer dismissal reason if given'
        }
      }
    }
  }
];

export class ZaraAgentCore {
  /**
   * Sanitizes model-generated text to prevent undefined, NaN, or markdown leaks
   */
  static sanitizeOutput(text = '') {
    if (!text) return '';
    let clean = String(text).trim();
    clean = clean.replace(/^(?:Zara|Assistant|Bot):\s*/i, '');
    clean = clean.replace(/^(?:Customer|User):\s*.*?(?:\n|$)/gim, '');
    clean = clean.replace(/Rs\.\s*NaN/gi, 'Price on request');
    clean = clean.replace(/\bNaN\b/g, '0');
    clean = clean.replace(/\bundefined\b/g, '');
    clean = clean.replace(/\bnull\b/g, '');
    clean = clean.replace(/\[object Object\]/g, '');
    return clean.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Formats structured history into alternating `@google/genai` message turns
   *
   * @param {Array<{ role: string, text: string }>} turns
   * @returns {Array<object>}
   */
  static formatHistory(turns = []) {
    if (!Array.isArray(turns) || turns.length === 0) return [];

    const formatted = [];
    for (const turn of turns) {
      if (!turn || !turn.text) continue;
      const isAssistant = turn.role === 'assistant' || turn.role === 'model' || turn.sender === 'assistant' || turn.sender === 'bot';
      const role = isAssistant ? 'model' : 'user';
      const cleanText = String(turn.text).trim();
      if (!cleanText) continue;

      const last = formatted[formatted.length - 1];
      if (last && last.role === role) {
        // Coalesce same-role consecutive turns to maintain strict alternating sequence
        last.parts[0].text += `\n${cleanText}`;
      } else {
        formatted.push({
          role,
          parts: [{ text: cleanText }]
        });
      }
    }

    // Gemini requires the conversation to start with a 'user' turn if history exists
    if (formatted.length > 0 && formatted[0].role !== 'user') {
      formatted.shift();
    }

    return formatted;
  }

  /**
   * Builds the comprehensive, brand-aligned system instruction for Zara
   */
  static buildSystemInstruction({ shopName = 'Sunday Bazaaar Official', context = {}, customer = null } = {}) {
    const activeProd = context.activeProduct || null;
    const activeOrd = context.activeOrder || null;
    const rejectedProducts = Array.isArray(context.rejectedProducts) ? context.rejectedProducts : [];
    const customerName = customer?.firstName || context.customerName || null;

    let entityContext = '';
    if (activeProd) {
      const priceStr = activeProd.formattedPrice || (activeProd.numericPrice ? `Rs. ${activeProd.numericPrice}` : 'On request');
      const delivStr = activeProd.deliveryCharge ? ` (Delivery: Rs. ${activeProd.deliveryCharge})` : '';
      entityContext += `\n- ACTIVE PRODUCT: "${activeProd.title || activeProd.name}" | Price: ${priceStr}${delivStr} | URL: ${activeProd.url || 'N/A'}`;
    }
    if (activeOrd) {
      entityContext += `\n- ACTIVE ORDER: #${activeOrd.orderNumber} | Status: "${activeOrd.status || 'Processing'}" | Items: ${activeOrd.items || 'N/A'} | Total COD: Rs. ${activeOrd.totalAmount || 0}`;
    }
    if (rejectedProducts.length > 0) {
      const rejectedTitles = rejectedProducts.map(p => (typeof p === 'string' ? p : p.title || p.name)).filter(Boolean);
      if (rejectedTitles.length > 0) {
        entityContext += `\n- REJECTED PRODUCTS (Customer said NO/declined): [${rejectedTitles.join(', ')}]. STRICT RULE: NEVER recommend or offer these items again unless the customer explicitly requests them by name.`;
      }
    }

    return (
`You are Zara, the courteous, intelligent, and natural AI customer service representative for "${shopName}".
You communicate with customers in Pakistan via WhatsApp.

PRIMARY OBJECTIVES:
1. Speak natural Roman Urdu, Urdu, English, or a natural mixed conversational style typical of Pakistani online shoppers.
2. Be concise, polite, helpful, and human-like. Keep replies suitable for mobile chat (avoid overwhelming long walls of text).
3. UNDERSTAND customer meaning directly — interpret Pakistani slang, colloquialisms, Roman Urdu spelling variations, typos, and abbreviations (e.g. "dc" = delivery charges, "cod" = cash on delivery, "asap", "plz", "iski", "iska", "ye", "woh").
4. ALWAYS ground facts in tools: Never invent or hallucinate product prices, delivery charges, stock availability, or order status. Call the relevant tools to fetch authoritative data.
5. CONTEXTUAL CONTINUITY:
   - When the customer uses pronouns or indirect references ("iski price?", "dc kitni hai?", "total kitna hoga?", "link do", "ye wala dikhao"), refer to the ACTIVE PRODUCT in context.
   - If the customer asks for a link, provide the direct product URL fetched from tools or active context.
   - For total inquiries, calculate or state both product price and delivery charges clearly.
6. PRODUCT REJECTIONS: If the customer dismisses or rejects a product ("nahi chahiye", "rehne do", "nahi lena"), politely respect their choice and stop promoting it. Offer to show alternatives or ask what they prefer.
7. CASUAL & NON-SHOPPING MESSAGES:
   - For greetings, general chats, friendly remarks ("kese ho", "tumhara naam kya hai", "main upset hun", "neend nahi aa rahi", jokes), respond warmly, courteously, and empathetically as Zara.
   - DO NOT push unsolicited product recommendations during casual or emotional remarks.
8. HUMAN SUPPORT & FRUSTRATION:
   - If the customer asks to speak with an owner, manager, real person, or expresses frustration, call "request_human_transfer" and assure them that human support has been informed and will reach out promptly.
9. ORDER TRACKING & SECURITY:
   - For order status questions, call "resolve_order". The server strictly verifies caller phone ownership. If the order is not found, politely ask for their order number or registered phone number.
${customerName ? `Customer Name: ${customerName}` : ''}
CURRENT CONVERSATIONAL CONTEXT:${entityContext || '\n- No active product or order currently selected.'}`
    );
  }

  /**
   * Executes a verified tool call with server-side authorization boundaries
   */
  static async executeTool(toolName, args = {}, authContext = {}) {
    const {
      shopDomain = 'sundaybazaaar.store',
      shopId = null,
      fromPhone = null,
      activeProduct = null,
      activeOrder = null,
      lockContext = null,
      toolRunner = null
    } = authContext;

    // Custom tool runner adapter (for evaluation harness isolation)
    if (toolRunner && typeof toolRunner.executeTool === 'function') {
      return await toolRunner.executeTool(toolName, args, authContext);
    }

    // Side-effect safety: verify lock ownership fencing to prevent split-brain state mutations
    const isSideEffecting = ['confirm_order', 'cancel_order', 'request_human_transfer'].includes(toolName);
    if (isSideEffecting && lockContext && typeof lockContext.isLocked === 'function' && !lockContext.isLocked()) {
      return {
        success: false,
        error: `Lock lease expired or lost. Refusing side-effecting action "${toolName}" to maintain consistency.`
      };
    }

    const TOOL_TIMEOUT_MS = 8000;
    try {
      const toolActionPromise = (async () => {
        switch (toolName) {
        case 'search_shopify_products': {
          const query = String(args.query || '').trim();
          if (!query) {
            return { success: false, error: 'Query parameter is required' };
          }
          const searchRes = await ShopifyCatalogService.searchProducts(shopDomain, query, { limit: 5 });
          const rawProducts = searchRes?.products || [];

          // Suppress previously rejected products unless customer explicitly searched for them by exact title
          const rejectedTitles = (authContext.rejectedProducts || [])
            .map(p => (typeof p === 'string' ? p : p.title || p.name || '').toLowerCase())
            .filter(Boolean);

          const products = rawProducts.filter(p => {
            const pTitle = (p.title || '').toLowerCase();
            const wasRejected = rejectedTitles.some(rt => rt.length > 2 && pTitle.includes(rt));
            if (wasRejected) {
              const explicitQuery = query.toLowerCase();
              return explicitQuery.includes(pTitle) || pTitle.includes(explicitQuery);
            }
            return true;
          });

          return {
            success: true,
            query,
            totalFound: products.length,
            products: products.map(p => ({
              id: p.id,
              title: p.title,
              price: p.numericPrice || p.price,
              formattedPrice: p.formattedPrice || `Rs. ${p.numericPrice || p.price}`,
              url: p.url,
              available: p.available ?? true,
              description: p.description
            }))
          };
        }

        case 'get_shopify_product_details': {
          const identifier = {
            query: args.query,
            handle: args.handle,
            productId: args.productId
          };
          const prod = await ShopifyCatalogService.getProductDetails(shopDomain, identifier);
          if (!prod) {
            return { success: false, message: `Product not found for "${args.query || args.handle || args.productId}"` };
          }
          return {
            success: true,
            product: {
              id: prod.id,
              title: prod.title,
              price: prod.numericPrice || prod.price,
              formattedPrice: prod.formattedPrice || `Rs. ${prod.numericPrice || prod.price}`,
              url: prod.url,
              available: prod.available ?? true,
              description: prod.description
            }
          };
        }

        case 'get_delivery_quote': {
          const city = args.city || null;
          const price = typeof args.productPrice === 'number' ? args.productPrice : (activeProduct?.numericPrice || 0);
          const quote = await DeliveryService.getDeliveryQuote({ shopDomain, city, subtotal: price });
          const deliveryCharge = Number(quote?.deliveryCharge ?? 199);
          const total = price > 0 ? (price + deliveryCharge) : null;
          return {
            success: true,
            deliveryCharge,
            currency: 'PKR',
            estimatedDelivery: quote?.estimatedDays || '3–5 working days',
            productPrice: price > 0 ? price : undefined,
            totalCOD: total !== null ? total : undefined,
            city: city || 'All Pakistan'
          };
        }

        case 'resolve_order': {
          if (!shopId) {
            return { success: false, error: 'Shop context missing for order resolution' };
          }
          const orderNum = args.orderNumber ? String(args.orderNumber).replace(/[^0-9]/g, '') : (activeOrder?.orderNumber || null);
          const lookup = await OrderResolver.resolveCustomerOrders({
            shopId,
            fromPhone,
            orderNumber: orderNum
          });

          if (lookup.unauthorized) {
            return {
              success: false,
              unauthorized: true,
              error: 'Order ownership unverified. The order number does not match your registered phone number.'
            };
          }

          if (lookup.found && lookup.order) {
            const ord = lookup.order;
            return {
              success: true,
              order: {
                orderNumber: ord.orderNumber,
                status: ord.status,
                items: ord.items,
                totalAmount: ord.totalAmount,
                shippingFee: ord.shippingFee || 199,
                expectedDelivery: ord.expectedDelivery || '3–5 working days'
              }
            };
          }

          return {
            success: false,
            message: `No active order found for your registered phone number (#${orderNum || 'N/A'}).`
          };
        }

        case 'confirm_order': {
          if (!shopId) return { success: false, error: 'Shop context missing' };
          const orderNum = args.orderNumber ? String(args.orderNumber).replace(/[^0-9]/g, '') : (activeOrder?.orderNumber || null);
          const lookup = await OrderResolver.resolveCustomerOrders({
            shopId,
            fromPhone,
            orderNumber: orderNum
          });

          if (lookup.unauthorized) {
            return { success: false, unauthorized: true, error: 'Order ownership unverified. Cannot confirm an order that is not yours.' };
          }

          if (!lookup.found || !lookup.order) {
            return { success: false, error: `No order found to confirm for #${orderNum || 'N/A'}` };
          }

          const ord = lookup.order;
          const oId = ord.orderId || ord.id;

          // Idempotency: Already Confirmed
          if (ord.status === 'Confirmed') {
            return {
              success: true,
              alreadyConfirmed: true,
              orderNumber: ord.orderNumber,
              status: 'Confirmed',
              message: `Order #${ord.orderNumber} is already confirmed and prepared for dispatch.`
            };
          }

          // Safety: Cannot confirm previously cancelled order
          if (ord.status === 'Cancelled') {
            return {
              success: false,
              error: `Order #${ord.orderNumber} was previously cancelled and cannot be confirmed. Please place a new order.`
            };
          }

          if (lockContext && typeof lockContext.isLocked === 'function' && !lockContext.isLocked()) {
            return {
              success: false,
              error: `Lock lost before state transition for order #${ord.orderNumber}. State transition aborted to prevent split-brain mutation.`
            };
          }

          try {
            const { OrderStateMachine, OrderStatus } = await import('./OrderStateMachine.js');
            const sm = new OrderStateMachine(oId, shopDomain);
            await sm.transition(OrderStatus.CONFIRMED);
          } catch (transErr) {
            return {
              success: false,
              error: `Could not confirm order #${ord.orderNumber}: ${transErr.message}`
            };
          }

          return {
            success: true,
            orderNumber: ord.orderNumber,
            status: 'Confirmed',
            message: `Order #${ord.orderNumber} has been verified and confirmed for dispatch.`
          };
        }

        case 'cancel_order': {
          if (!shopId) return { success: false, error: 'Shop context missing' };
          const orderNum = args.orderNumber ? String(args.orderNumber).replace(/[^0-9]/g, '') : (activeOrder?.orderNumber || null);
          const lookup = await OrderResolver.resolveCustomerOrders({
            shopId,
            fromPhone,
            orderNumber: orderNum
          });

          if (lookup.unauthorized) {
            return { success: false, unauthorized: true, error: 'Order ownership unverified. Cannot cancel an order that is not yours.' };
          }

          if (!lookup.found || !lookup.order) {
            return { success: false, error: `No active order found to cancel for #${orderNum || 'N/A'}` };
          }

          const ord = lookup.order;
          const oId = ord.orderId || ord.id;
          const reason = String(args.reason || 'customer_whatsapp_cancellation');

          // Idempotency: Already Cancelled
          if (ord.status === 'Cancelled') {
            return {
              success: true,
              alreadyCancelled: true,
              orderNumber: ord.orderNumber,
              status: 'Cancelled',
              message: `Order #${ord.orderNumber} is already cancelled.`
            };
          }

          // Protection: Already Confirmed or in transit requires human manager review
          if (ord.status === 'Confirmed' || /dispatch|shipped|transit|courier/i.test(ord.status)) {
            try {
              const { OrderStateMachine, OrderStatus } = await import('./OrderStateMachine.js');
              const sm = new OrderStateMachine(oId, shopDomain);
              await sm.transition(OrderStatus.HUMAN_REQUIRED, `Customer requested cancellation of confirmed order #${ord.orderNumber}`);
            } catch (_) {}
            try {
              if (typeof HumanEscalationService?.escalateToHuman === 'function') {
                await HumanEscalationService.escalateToHuman({
                  shopDomain,
                  shopId,
                  customerPhone: fromPhone,
                  reason: `Customer requested cancellation for confirmed order #${ord.orderNumber}: ${reason}`
                });
              }
            } catch (_) {}
            return {
              success: false,
              requiresHumanReview: true,
              orderNumber: ord.orderNumber,
              status: ord.status,
              message: `Order #${ord.orderNumber} is already confirmed/in dispatch. Your cancellation request has been forwarded to our management team for review.`
            };
          }

          if (lockContext && typeof lockContext.isLocked === 'function' && !lockContext.isLocked()) {
            return {
              success: false,
              error: `Lock lost before state transition for order #${ord.orderNumber}. State transition aborted to prevent split-brain mutation.`
            };
          }

          try {
            const { OrderStateMachine, OrderStatus } = await import('./OrderStateMachine.js');
            const sm = new OrderStateMachine(oId, shopDomain);
            await sm.transition(OrderStatus.CANCELLED, reason);
          } catch (transErr) {
            return {
              success: false,
              error: `Could not cancel order #${ord.orderNumber}: ${transErr.message}`
            };
          }

          return {
            success: true,
            orderNumber: ord.orderNumber,
            status: 'Cancelled',
            message: `Order #${ord.orderNumber} has been successfully cancelled as requested.`
          };
        }

        case 'reject_product': {
          const rejectedItem = activeProduct || null;
          return {
            success: true,
            rejectedProduct: rejectedItem,
            message: 'Product rejection registered. This item will not be suggested again.'
          };
        }

        case 'request_human_transfer': {
          const reason = String(args.reason || 'Customer requested human support').trim();
          let notificationDispatched = false;
          try {
            if (typeof HumanEscalationService?.escalateToHuman === 'function') {
              const res = await HumanEscalationService.escalateToHuman({
                shopDomain,
                shopId,
                customerPhone: fromPhone,
                reason,
                context: {
                  activeProduct: activeProduct?.title || null,
                  activeOrder: activeOrder?.orderNumber || null
                }
              });
              notificationDispatched = Boolean(res?.notificationSent || res?.success);
            }
          } catch (_) {}

          return {
            success: true,
            escalationRecorded: true,
            notificationSent: notificationDispatched,
            message: 'Human support has been alerted and will contact the customer promptly.'
          };
        }

        case 'get_store_info': {
          return {
            success: true,
            storeName: 'Sunday Bazaaar Official',
            storefrontUrl: 'https://sundaybazaaar.store',
            deliveryPolicy: 'Standard delivery charges Rs. 199 across Pakistan via Cash on Delivery (COD). Expected delivery 3–5 working days.',
            returnPolicy: '7-day replacement and return guarantee for damaged or defective items.'
          };
        }

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    })();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS);
    });

    return await Promise.race([toolActionPromise, timeoutPromise]);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

  /**
   * Main conversational reasoning method with multi-turn Gemini tool loop
   *
   * @param {object} params
   * @param {string} params.messageText - Inbound user message
   * @param {string} params.fromPhone - Authenticated caller phone
   * @param {object} params.shop - Shop tenant context
   * @param {object} [params.customer] - Customer identity
   * @param {object} [params.state] - Persisted conversational state
   * @param {Array} [params.turns] - Multi-turn conversational history
   * @param {object} [params.aiClient] - Injectable GoogleGenAI client (for testing)
   * @param {string} [params.model] - Target Gemini model
   * @returns {Promise<{ replyText: string, proposedStateUpdates: object, toolCallsExecuted: Array, usedLLM: boolean }>}
   */
  static async handleTurn(params = {}) {
    const {
      messageText = '',
      fromPhone = null,
      shop = {},
      customer = null,
      state = {},
      turns = [],
      aiClient = null,
      lockContext = null,
      toolRunner = null,
      model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxRounds = 4
    } = params;

    if (!messageText || String(messageText).trim() === '') {
      return {
        replyText: '',
        proposedStateUpdates: {},
        toolCallsExecuted: [],
        usedLLM: false
      };
    }

    const client = aiClient || getAIClient();
    const shopName = shop.name || shop.domain?.replace('.myshopify.com', '') || 'Sunday Bazaaar Official';
    const shopDomain = shop.domain || 'sundaybazaaar.store';
    const shopId = shop.id || null;

    // Structured Context Snapshot
    const activeProduct = state.activeProduct || state.currentProduct || null;
    const activeOrder = state.activeOrder || null;
    const rejectedProducts = state.rejectedProducts || [];

    const authContext = {
      shopDomain,
      shopId,
      fromPhone,
      customerId: customer?.id || null,
      activeProduct,
      activeOrder,
      rejectedProducts,
      lockContext,
      toolRunner
    };

    const systemInstruction = this.buildSystemInstruction({
      shopName,
      context: {
        activeProduct,
        activeOrder,
        rejectedProducts
      },
      customer
    });

    // Multi-turn history formatting
    const rawTurns = (turns && turns.length > 0) ? turns : (state.recentTurns || []);
    const historyParts = this.formatHistory(rawTurns);

    // History must alternate cleanly before appending current inbound user turn
    while (historyParts.length > 0 && historyParts[historyParts.length - 1].role === 'user') {
      historyParts.pop();
    }

    const currentContents = [
      ...historyParts,
      { role: 'user', parts: [{ text: String(messageText).trim() }] }
    ];

    const attemptedToolCalls = [];
    const executedToolCalls = [];
    const proposedStateUpdates = {};
    let roundCount = 0;
    let finalReply = '';
    let truncationRecoveryAttempted = false;
    let totalPromptTokens = 0;
    let totalCandidateTokens = 0;

    while (roundCount < maxRounds) {
      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: currentContents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: ZARA_TOOL_DEFINITIONS }],
            temperature: 0.3,
            maxOutputTokens: parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '500', 10)
          }
        });
        if (response?.usageMetadata) {
          totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
          totalCandidateTokens += response.usageMetadata.candidatesTokenCount || 0;
        }
      } catch (geminiErr) {
        console.warn(`⚠️ [ZaraAgentCore] Gemini API error: ${geminiErr.message}`);

        // Defense-in-depth: Never perform or propose order mutations when model request fails
        const safeProposedUpdates = { ...proposedStateUpdates };
        delete safeProposedUpdates.activeOrderStatus;

        // Preserve customer's order number for safe retry
        let retryOrderNumber = activeOrder?.orderNumber || state?.activeOrderNumber || null;
        if (!retryOrderNumber && typeof messageText === 'string') {
          const match = messageText.match(/\b(?:order\s*(?:number|no\.?|num)?\s*#?|#)\s*([0-9]{3,8})\b/i)
            || messageText.match(/\b([0-9]{4,6})\b/);
          if (match) {
            retryOrderNumber = match[1];
          }
        }

        if (retryOrderNumber) {
          const cleanOrderNum = String(retryOrderNumber).trim();
          safeProposedUpdates.activeOrderNumber = cleanOrderNum;
          if (!safeProposedUpdates.activeOrder) {
            safeProposedUpdates.activeOrder = { orderNumber: cleanOrderNum };
          }
        }

        // Context-aware service-unavailable reply (never misleading greeting or false claim)
        const isOrderQuery = Boolean(retryOrderNumber) || /\b(order|status|parcel|tracking|delivery|cancel|confirm)\b/i.test(messageText || '');
        let serviceUnavailableReply;

        if (retryOrderNumber) {
          serviceUnavailableReply = `Maazrat, system mein temporary technical issue ki wajah se aapka order #${retryOrderNumber} filhal check nahi ho saka. Baraye meharbani thori dair baad dobara check karein.`;
        } else if (isOrderQuery) {
          serviceUnavailableReply = `Maazrat, system mein temporary technical issue ki wajah se aapka order status filhal check nahi ho saka. Baraye meharbani thori dair baad dobara check karein.`;
        } else {
          serviceUnavailableReply = `Maazrat, system mein temporary technical issue ki wajah se response generate nahi ho saka. Baraye meharbani thori dair baad dobara rabta karein.`;
        }

        return {
          replyText: serviceUnavailableReply,
          proposedStateUpdates: safeProposedUpdates,
          toolCallsAttempted: attemptedToolCalls,
          toolCallsExecuted: executedToolCalls,
          usedLLM: false,
          isServiceUnavailable: true,
          error: geminiErr.message
        };
      }

      const candidate = response?.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const parts = candidate?.content?.parts || [];
      const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);

      if (functionCalls.length === 0) {
        // Natural language final answer obtained
        let textOutput = parts.map(p => p.text || '').join('').trim();
        const isTruncated = finishReason === 'MAX_TOKENS' || finishReason === 'MAX_TOKENS_EXCEEDED';

        if (isTruncated && !truncationRecoveryAttempted) {
          truncationRecoveryAttempted = true;
          console.warn(`⚠️ [ZaraAgentCore] Response truncated (finishReason: ${finishReason}). Attempting bounded concise recovery.`);
          try {
            const recoveryContents = [
              ...currentContents,
              { role: 'model', parts: [{ text: textOutput }] },
              { role: 'user', parts: [{ text: '(System Note: Response was cut off by token limit. Please output a complete, concise reply in 1–2 short sentences.)' }] }
            ];
            const retryRes = await client.models.generateContent({
              model,
              contents: recoveryContents,
              config: {
                systemInstruction,
                temperature: 0.2,
                maxOutputTokens: Math.min(parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '500', 10) + 200, 750)
              }
            });
            const retryCand = retryRes?.candidates?.[0];
            const retryText = retryCand?.content?.parts?.map(p => p.text || '').join('').trim();
            if (retryText) {
              textOutput = retryText;
            }
          } catch (retryErr) {
            console.warn(`⚠️ [ZaraAgentCore] Truncation recovery error: ${retryErr.message}`);
          }
        }

        // Clean any dangling sentence fragments if truncated
        if (isTruncated && textOutput) {
          const lastSentenceEnd = Math.max(
            textOutput.lastIndexOf('.'),
            textOutput.lastIndexOf('!'),
            textOutput.lastIndexOf('?')
          );
          if (lastSentenceEnd > 25) {
            textOutput = textOutput.substring(0, lastSentenceEnd + 1).trim();
          }
        }

        finalReply = textOutput;
        break;
      }

      // Model requested one or more tool calls
      currentContents.push({ role: 'model', parts });

      const responseParts = [];
      for (const call of functionCalls) {
        attemptedToolCalls.push({ name: call.name, args: call.args });
        let toolResult;
        try {
          toolResult = await this.executeTool(call.name, call.args || {}, authContext);
        } catch (err) {
          toolResult = { success: false, error: err.message };
        }

        executedToolCalls.push({ name: call.name, args: call.args });

        // Derive proposed state updates from verified tool outputs
        if (call.name === 'search_shopify_products' && toolResult?.products?.length > 0) {
          const selected = toolResult.products[0];
          proposedStateUpdates.activeProduct = selected;
          proposedStateUpdates.recentProducts = toolResult.products;
          // If customer explicitly re-queried a previously rejected product, un-reject it
          const wasRejected = (authContext.rejectedProducts || []).some(rp => {
            const rTitle = (typeof rp === 'string' ? rp : rp.title || '').toLowerCase();
            return rTitle.length > 2 && (selected.title || '').toLowerCase().includes(rTitle);
          });
          if (wasRejected) {
            proposedStateUpdates.unrejectedProduct = selected;
          }
        } else if (call.name === 'get_shopify_product_details' && toolResult?.product) {
          const selected = toolResult.product;
          proposedStateUpdates.activeProduct = selected;
          const wasRejected = (authContext.rejectedProducts || []).some(rp => {
            const rTitle = (typeof rp === 'string' ? rp : rp.title || '').toLowerCase();
            return rTitle.length > 2 && (selected.title || '').toLowerCase().includes(rTitle);
          });
          if (wasRejected) {
            proposedStateUpdates.unrejectedProduct = selected;
          }
        } else if (call.name === 'resolve_order' && toolResult?.order) {
          proposedStateUpdates.activeOrder = toolResult.order;
          proposedStateUpdates.activeOrderNumber = toolResult.order.orderNumber;
        } else if (call.name === 'confirm_order' && toolResult?.success) {
          proposedStateUpdates.activeOrderStatus = 'Confirmed';
        } else if (call.name === 'cancel_order' && toolResult?.success) {
          proposedStateUpdates.activeOrderStatus = 'Cancelled';
        } else if (call.name === 'reject_product' && toolResult?.success) {
          proposedStateUpdates.rejectedProduct = activeProduct;
          proposedStateUpdates.activeProduct = null;
        } else if (call.name === 'request_human_transfer') {
          proposedStateUpdates.humanEscalationRequested = true;
        }

        // Bounded protocol response back to Gemini
        responseParts.push({
          functionResponse: {
            id: call.id || undefined,
            name: call.name,
            response: { output: toolResult }
          }
        });
      }

      currentContents.push({ role: 'user', parts: responseParts });
      roundCount++;
    }

    if (!finalReply) {
      finalReply = `Ji, main samajh gayi hoon. Main aapki mazeed kya madad kar sakti hoon?`;
    }

    const sanitizedReply = this.sanitizeOutput(finalReply);

    return {
      replyText: sanitizedReply,
      proposedStateUpdates,
      toolCallsAttempted: attemptedToolCalls,
      toolCallsExecuted: executedToolCalls,
      usedLLM: true,
      roundCount,
      usageMetadata: {
        promptTokens: totalPromptTokens,
        candidateTokens: totalCandidateTokens,
        totalTokens: totalPromptTokens + totalCandidateTokens
      }
    };
  }
}

export default ZaraAgentCore;
