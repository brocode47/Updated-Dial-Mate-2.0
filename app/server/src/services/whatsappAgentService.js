import { prisma } from '../lib/db.js';
import { getAIClient } from '../integrations/ai/client.js';
import { ToolDispatcher } from '../integrations/ai/dispatcher.js';
import { AITools } from '../integrations/ai/tools.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { OrderEligibilityService } from './orderEligibilityService.js';
import { PhoneNormalizer } from './phoneNormalizer.js';
import { ShopifyCatalogService } from './shopifyCatalogService.js';
import { ConversationStateService } from './conversationStateService.js';
import { DeliveryService } from './deliveryService.js';
import { HumanEscalationService } from './humanEscalationService.js';
import { TextToSpeechService } from './textToSpeechService.js';

/**
 * WhatsApp AI Customer Agent Service ("Zara 2.0")
 * 
 * Production-Grade Architecture:
 * 1. Persona: "Zara" — Courteous, professional Roman Urdu / English support assistant.
 * 2. Multi-Tenant Scoped: Strict isolation by shopId & shopDomain.
 * 3. Canonical Phone & Identity: Multi-variant matching across +92, 92, 03, dashes/spaces.
 * 4. Human Escalation: True WhatsApp alerts delivered to store owner with complete context & deduplication.
 * 5. Product Status Policy: Inventory/stock status suppressed by default; only shown when explicitly queried.
 * 6. Persistent Entity Resolution: Maintains currentProduct, lastProducts, currentOrder, deliveryContext across turns.
 * 7. Authoritative Delivery: Grounded in real store COD shipping rates (Rs. 199 for Sunday Bazaaar) via get_delivery_quote.
 * 8. Conversation Lifecycle: Greeting strictly limited to conversation start; zero greeting repetition mid-chat.
 * 9. Order Routing: "Last order", "jo last order aya", "latest booking" never routes to product search.
 * 10. Purchase vs Order Confirm: "anti snoring wala product confirm kro" routes to purchase assistance.
 * 11. Pakistani Language Engine: Comprehensive phonetic typos, SMS slang, Urdu script, Roman Urdu, and negation safety.
 */
export class WhatsAppAgentService {
  /**
   * Sanitizes customer-facing text to guarantee zero NaN, undefined, or null leaks
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
   */
  static isNegated(text, action) {
    const clean = String(text || '').toLowerCase().trim();
    if (action === 'confirm') {
      return /\b(nahi|na|mat|mt|never|don't|dont|not|nhi)\s+(confirm|dispatch|bhejo|bhejna|book)\b/i.test(clean) ||
             /\b(confirm|dispatch|bhejo|bhejna|book)\s+(nahi|na|mat|mt|karna\s+nahi|krna\s+nahi|nhi)\b/i.test(clean) ||
             /\b(cancel\s*(kar|kardo|karna))\b/i.test(clean) ||
             /\b(abhi\s*(confirm\s*)?nahi|confirm\s*nahi\s*karna)\b/i.test(clean);
    }
    if (action === 'cancel') {
      return /\b(nahi|na|mat|mt|never|don't|dont|not|nhi)\s+(cancel|radd|rokna)\b/i.test(clean) ||
             /\b(cancel)\s+(nahi|na|mat|mt|mat\s+karna|mt\s+krna|nhi)\b/i.test(clean) ||
             /\b(main\s*cancel\s*nahi\s*keh\s*raha|cancel\s*nahi\s*karna)\b/i.test(clean) ||
             /\b(confirm\s*hi\s*rakhna|bhejna\s*hi\s*hai)\b/i.test(clean);
    }
    return false;
  }

  /**
   * Checks if customer explicitly inquired about product stock/availability
   */
  static isAvailabilityInquiry(text) {
    const clean = String(text || '').toLowerCase().trim();
    return /(stock\s*hai|available\s*hai|available|mil\s*jayega|mil\s*sakega|stock\s*mein\s*hai|stock\??|in\s*stock|availble)/i.test(clean);
  }

  /**
   * Evaluates if text contains explicit order references (Priority 2)
   * Strong evidence such as "mera order", "order #1643", "order status", etc.
   */
  static hasExplicitOrderReference(text) {
    const clean = String(text || '').toLowerCase().trim();
    return /\b(mera\s*order|mere\s*order|order\s*(#\s*\d+|\d+)|order\s*number|order\s*ka|order\s*ki|order\s*ke|order\s*status|my\s*order|my\s*orders|my\s*parcel|meri\s*delivery|mera\s*par[sc][ae]l|par[sc][ae]l\s*kab|order\s*kab|mera\s*last\s*order|last\s*order|latest\s*order|latest\s*booking|jo\s*order\s*kiya|jo\s*order\s*aya)\b/i.test(clean);
  }

  /**
   * Evaluates if text contains product pronouns or references
   */
  static hasProductPronounOrReference(text) {
    const clean = String(text || '').toLowerCase().trim();
    return /\b(iski|iska|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye|yeh|this|that|item|product|cover|belt|shoes|kursi|chair|wall\s*max|dilator|snoring)\b/i.test(clean);
  }

  /**
   * Detects customer intent from message text with Pakistani language engine
   */
  static detectIntent(text, context = {}) {
    const clean = String(text || '').toLowerCase().trim();

    // 1. Direct code shortcuts
    if (clean === '1' || clean === 'confirm') {
      return { intent: 'CONFIRM', confidence: 0.99 };
    }
    if (clean === '2' || clean === 'cancel') {
      return { intent: 'CANCEL', confidence: 0.99 };
    }

    // 2. Human escalation request (an explicit request to reach a person — merely mentioning
    //    "owner" in an informational question, e.g. "owner ka naam kya hai", is NOT an escalation)
    const personWord = '(human|insan|insaan|real\\s*(person|banda|insan)|asli\\s*banda|banda|bande|bandey|bandy|agent|representative|operator|owner|manager|customer\\s*(support|care|service)|support(\\s*(team|staff))?|staff)';
    if (
      new RegExp(`(kisi\\s*)?${personWord}\\s*(se|sy|say|ko)\\s*(baat|bat|bate|talk|connect|milao|milwao|rabta|call|bulao|transfer)`, 'i').test(clean) ||
      new RegExp(`\\b(talk|speak|baat|connect|transfer)\\s*(to|with|karwao|karao|karo)?\\s*(a\\s*)?(kisi\\s*)?${personWord}\\b`, 'i').test(clean) ||
      /\b(human|agent|insan|banda)\s*(chahiye|please|plz|bhejo|bulao)\b/i.test(clean) ||
      /\b(human|live)\s*agent\b/i.test(clean) ||
      /\b(real\s*(person|banda|insan)|asli\s*banda|call\s*back|transfer\s*karo|connect\s*karo|kisi\s*(insan|bande|person)\s*se)\b/i.test(clean) ||
      /\b(support\s*team|customer\s*support)\s*(se|ko)\b/i.test(clean)
    ) {
      return { intent: 'HUMAN_TRANSFER', confidence: 0.95 };
    }

    // 2b. Product rejection / dismissal ("nahi chahiye", "rehne do", "choro", "no thanks"...).
    //     Evaluated BEFORE cancel so that rejecting a PRODUCT can never cancel an ORDER.
    const rejectionPhrase =
      /\b(nahi|nahin|nhi|nai|no)\s*(chahiye|chahiyeh|chaiye|chahye|chahiay|lena|leni|lene|lunga|lungi|pasand)\b/i.test(clean) ||
      /\b(rehne?\s*(do|dein|de)|reh\s*ne\s*do|rahne\s*do|chh?oro|chh?or\s*do|chodo|chhod\s*do|skip|no\s*thanks?|not\s*interested|don'?t\s*want|dont\s*want|no\s*need)\b/i.test(clean) ||
      /\b(zarurat|zaroorat|zarorat)\s*(nahi|nhi|nahin)\b/i.test(clean) ||
      /\b(ye|yeh|ise|isko|is)\s*(wala\s*)?(nahi|nhi)\b/i.test(clean) ||
      clean === 'nahi' || clean === 'nahin' || clean === 'nhi' || clean === 'no';
    const mentionsCancel = /\b(cancel|cancle|cancil|cancl|radd)\b/i.test(clean);
    if (rejectionPhrase && !mentionsCancel && !this.hasExplicitOrderReference(clean)) {
      return { intent: 'PRODUCT_REJECTION', confidence: 0.93 };
    }

    // 3. Negation checks before action matching
    const cancelNegated = this.isNegated(clean, 'cancel');
    const confirmNegated = this.isNegated(clean, 'confirm');

    // "Order cancel mat karna / confirm hi rakhna"
    if (cancelNegated && /\b(confirm|bhej|dispatch)\b/i.test(clean)) {
      return { intent: 'CONFIRM', confidence: 0.92 };
    }

    // Explicit cancellation phrases or cancel negation
    if (
      (/\b(cancel\s*(kar|kardo|karein|karna|dein)?|cancle|cancil|cancl|nahi\s*chahiye|wapas|mat\s*bhejo)\b/i.test(clean) && !cancelNegated && !/\b(hua|hoga|ho\s*gaya|status)\b/i.test(clean)) ||
      cancelNegated
    ) {
      return { intent: 'CANCEL', confidence: 0.95 };
    }

    // 4. Order Status Queries (check status explicitly before general order summary)
    if (/\b(order\s*status|status\s*kya\s*hai|status\s*batao|order\s*kahan\s*tak|status|order\s*confirm\s*hua|mera\s*order\s*cancel\s*hua|cancel\s*hua|confirm\s*hua)\b/i.test(clean)) {
      return { intent: 'ORDER_STATUS', confidence: 0.95 };
    }

    const hasOrderRef = this.hasExplicitOrderReference(clean);

    // 5. Order Delivery Charges (Explicit order reference)
    if (/\b(delivery\s*charges?|deliv[er]*y\s*charges?|shipping\s*charges?|delivery\s*ke\s*kitne|delivery\s*cost)\b/i.test(clean) && hasOrderRef) {
      return { intent: 'ORDER_DELIVERY_CHARGES', confidence: 0.95 };
    }

    // 6. Order Total (Explicit order reference)
    if (/\b(iska\s*total|total\s*kitna|total\s*bill|kitne\s*paise|total\s*amount|cod\s*amount|kitna\s*bill)\b/i.test(clean) && hasOrderRef) {
      return { intent: 'ORDER_TOTAL', confidence: 0.95 };
    }

    // 7. Order Summary / Last Order Queries
    // CRITICAL: Must be checked BEFORE product inquiries so "last order" never routes to catalog search!
    if (
      !/\b(confirm|cnfrm|confrim|cancel|cancle|dispatch)\b/i.test(clean) && (
        /\b(last\s*order|latest\s*order|recent\s*order|last\s*wala\s*order|jo\s*(tumhare\s*pas\s*)?last\s*order|mera\s*last\s*order|last\s*order\s*ka\s*number|latest\s*booking|meri\s*latest\s*booking|jo\s*last\s*order\s*aya)\b/i.test(clean) ||
        /\b(mera\s*order\s*kya\s*hai|kya\s*order\s*hai|order\s*details|kya\s*order\s*kiya|kya\s*mangwaya|mera\s*order|mere\s*kitne\s*orders)\b/i.test(clean) ||
        /\b(mera\s*par[sc][ae]l\s*(kidr|kahan|kab)?|par[sc][ae]l\s*kab\s*ayega|order\s*kab\s*(ayega|milega)|(par[sc][ae]l|order)\s*kab\s*(ayega|milega|deliver|pohanchega)|order\s*kahan\s*pohancha|kab\s*deliver\s*hoga|delivery\s*kab\s*(hogi|ho\s*gi)|order\s*kidr\s*hai|order\s*kahan\s*hai)\b/i.test(clean)
      )
    ) {
      return { intent: 'ORDER_SUMMARY', confidence: 0.96 };
    }

    // Compound product request ("anti snoring aur chair cover dono dikhao", "X aur Y dono")
    if (/\b(?:aur|and)\b.+\b(?:dono|both)\b/i.test(clean) && !/\border\b/i.test(clean)) {
      return { intent: 'COMPOUND_PRODUCT_REQUEST', confidence: 0.95 };
    }

    // 8. Product Purchase Intent vs Existing Order Confirmation
    if (
      (/\b(order\s*kar\s*(do|dein|kardo)|book\s*kar\s*(do|dein|kardo)|ye\s*order\s*kar\s*(do|dein)|ye\s*lena\s*hai|yeh\s*lena\s*hai|order\s*karna\s*hai|mujhe\s*ye\s*chahiye|ye\s*chahiye)\b/i.test(clean)) ||
      (/\b(confirm\s*(kar|kardo|karein|karna|dein)?|cnfrm|confrim)\b/i.test(clean) && /\b(product|item|wala|wali|cover|belt|nasal|snoring)\b/i.test(clean) && !/\bmera\s*order\b/i.test(clean))
    ) {
      return { intent: 'PURCHASE_INTENT', confidence: 0.94 };
    }

    // Confirmation of existing order (including confirmNegated so handleIncomingMessage handles it)
    if (
      /\b(confirm\s*(kar|kardo|karein|karna|dein)?|cnfrm|confrim|dispatch\s*(kar|kardo|dein)?|bhej\s*(do|dein)?)\b/i.test(clean) ||
      clean === 'haan' || clean === 'yes' || clean === 'ji' || confirmNegated
    ) {
      return { intent: 'CONFIRM', confidence: 0.90 };
    }

    // 9. Delivery Charges & Shipping Inquiry (General / Product)
    if (
      /\b(delivery\s*charges?|shipping\s*charges?|deliv[er]*y\s*charges?|delivry\s*charges?|delivery\s*kitni|shipping\s*kitni|delivery\s*cost|ghar\s*tak\s*delivery|delivery\s*ke\s*sath|delivery\s*mila\s*ke|total\s*delivery)\b/i.test(clean) ||
      clean === 'delivery' || clean === 'delivery?' || clean === 'delivery charges' || clean === 'shipping' ||
      /\b(karachi|lahore|islamabad|rawalpindi|peshawar|multan|faisalabad)\s+delivery\b/i.test(clean)
    ) {
      return { intent: 'ORDER_DELIVERY_CHARGES', confidence: 0.95 };
    }

    // 10. Total Price Inquiry ("total kitna", "iska total", "total bill", "delivery ke sath total?")
    if (
      /\b(iska\s*total|total\s*kitna|total\s*bill|kitne\s*paise|total\s*amount|cod\s*amount|kitna\s*bill|kul\s*total|total\?|delivery\s*ke\s*sath\s*total|ghar\s*tak\s*kitne|shipping\s*ke\s*sath|kul\s*kitna|overall\s*price|kitna\s*padega)\b/i.test(clean) ||
      clean === 'total' || clean === 'total?'
    ) {
      return { intent: 'ORDER_TOTAL', confidence: 0.95 };
    }

    // 11. Conversational Clarification / Soft Negation ("Nahi main kar raha hoon na")
    if (/\b(nahi\s*main\s*(kar|kr)\s*rha\s*hun|main\s*khud\s*kar\s*raha|nahi\s*rehne\s*do|wait|ek\s*minute)\b/i.test(clean)) {
      return { intent: 'CONVERSATIONAL_CLARIFICATION', confidence: 0.90 };
    }

    // 12. "Aur dikhao" / Pagination intent
    if (/\b(aur\s*dikhao|aur\s*dikha|aur\s*bhejo|aur\s*batao|koi\s*aur\s*(dikhao|dikha|batao|bhejo|product|item)|(doosra|dusra|doosri|dusri)\s*(dikhao|dikha|batao|product|item)|another\s*(one|product|item)|next\s*product|mazeed\s*dikhao|next\s*page|more\s*products|aur\s*items|aur\s*products|mazeed|agla)\b/i.test(clean) || clean === 'aur dikhao' || clean === 'more' || clean === 'or?' || clean === 'next') {
      return { intent: 'MORE', confidence: 0.95 };
    }

    // 13. Ordinal or Contextual Product References ("pehle wale", "doosre ka link", "iska price", "ye wala")
    if (/\b(pehle\s*wale|doosre\s*wale|dusre\s*wale|teesre|tisre|chothe|paanchwe|1st|2nd|3rd|number\s*1|number\s*2|iska\s*(price|link|rate|prize)|iski\s*(price|link|rate|prize)|ye\s*wala|yeh\s*wala|pehly\s*walay|woh\s*wala|doosra\s*wala|last\s*wala)\b/i.test(clean) && !/\border\b/i.test(clean)) {
      return { intent: 'ORDINAL_REFERENCE', confidence: 0.92 };
    }

    // 14. Store / Website link (check before product link so 'website ka link do' -> STORE_LINK)
    if (/\b(website\s*(ka\s*)?(link|url)?|store\s*(ka\s*)?(link|url)|website\s*kya\s*hai|online\s*store|website\s*bhejo)\b/i.test(clean) && !/\b(product|item|iska)\b/i.test(clean)) {
      return { intent: 'STORE_LINK', confidence: 0.95 };
    }

    // 15. Direct Product Link request ("link bhejo", "iska link", "website bhejo")
    if (/\b(link\s*(bhejo|send\s*kro|bhej\s*do|do)|iska\s*link|product\s*link)\b/i.test(clean) || clean === 'link' || clean === 'link?') {
      return { intent: 'PRODUCT_LINK', confidence: 0.95 };
    }

    // 16. Collection requests
    if (/\b(collection|collections|kitchen\s*collection|mobile\s*accessories|women\s*collection|cleaning\s*collection)\b/i.test(clean)) {
      return { intent: 'COLLECTION', confidence: 0.90 };
    }

    // 17. Catalog browsing
    if (/\b(catalog\s*dikhao|catalog\s*bhejo|products\s*dikhao|sari\s*items|tamam\s*products|kya\s*kya\s*hai|list\s*bhejo|sab\s*products|aur\s*kya\s*hai)\b/i.test(clean)) {
      return { intent: 'CATALOG', confidence: 0.92 };
    }

    // 18. Single Product Detail inquiry (e.g. "adhesive wall max ki price batao", "details batao")
    if (/\b(ki\s*price|ka\s*rate|kitne\s*ka\s*hai|kitn[ey]\s*ka\s*(h[ya]i?|he|hai)?|kitny\s*ka|price\s*batao|rate\s*batao|kitne\s*ka|ye\s*kitny\s*ka|iska\s*rate|prize|details\s*batao|detail\s*batao|details|detail)\b/i.test(clean) || clean === 'price' || clean === 'price?' || clean === 'details') {
      return { intent: 'PRODUCT_DETAIL', confidence: 0.88 };
    }

    // 19. Product Inquiry (check named products or phrases like "kya aapke paas chair cover available hai")
    if (/\b(product|item|price|kya hai|dusra|cover|belt|shoes|shirt|suit|rate|wall\s*max|chair|kursi|snoring|dilator)\b/i.test(clean)) {
      return { intent: 'PRODUCT_INQUIRY', confidence: 0.85 };
    }

    // 20. Standalone Product Availability explicitly asked ("available hai?", "stock hai?", "mil jayega?")
    if (/\b(available\s*hai|stock\s*hai|mil\s*jayega|mil\s*sakega|stock\s*mein\s*hai|available\?|stock\?|in\s*stock|availble)\b/i.test(clean)) {
      return { intent: 'PRODUCT_AVAILABILITY', confidence: 0.93 };
    }

    // 21. General Social & Chit-Chat (e.g. "kya mujhse dosti karogi", "thank you", "acha", "Allah hafiz")
    if (/\b(dosti\s*karogi|friendship\s*karogy|friends|dosti)\b/i.test(clean)) {
      return { intent: 'SOCIAL_FRIENDSHIP', confidence: 0.95 };
    }
    if (/\b(thank\s*you|thanks|shukriya|meherbani)\b/i.test(clean)) {
      return { intent: 'SOCIAL_THANKYOU', confidence: 0.95 };
    }
    if (/\b(allah\s*hafiz|khuda\s*hafiz|bye|goodbye)\b/i.test(clean)) {
      return { intent: 'SOCIAL_CLOSING', confidence: 0.95 };
    }
    if (clean === 'acha' || clean === 'theek' || clean === 'theek hai' || clean === 'ok' || clean === 'acha ji' || clean === 'sahi') {
      return { intent: 'SOCIAL_ACK', confidence: 0.90 };
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
      messageId = null,
      isVoiceInbound = false
    } = params;
    const fromPhone = params.fromPhone || params.fromJid || params.phone;
    const messageText = params.messageText || params.text || '';
    const startTime = Date.now();
    console.log(`🤖 [WhatsAppAgent] Processing incoming message from ${fromPhone} (Shop: ${shopDomain}, Session: ${sessionId}): "${messageText}" [Voice: ${isVoiceInbound}]`);

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

    // Initialize WA Client and immediately signal typing presence
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

    // Retrieve active conversation state memory
    const state = await ConversationStateService.getState(conversation.id);
    let activeProduct = await ConversationStateService.resolveActiveProduct(conversation.id);
    const candidateProduct = activeProduct || (await ConversationStateService.resolveProductReference(conversation.id, messageText));
    const hasOrderRef = this.hasExplicitOrderReference(messageText);
    const shouldGreet = await ConversationStateService.shouldGreet(conversation.id, conversation.messages ? conversation.messages.length : 0);

    const storeName = shop.name || shop.domain.replace('.myshopify.com', '');
    const detected = this.detectIntent(messageText, { activeProduct: candidateProduct, recentOrder, state });
    let replyText = '';
    let executedAction = null;
    let usedLLM = false;

    // Extract city if mentioned anywhere in message
    const cityMatch = messageText.match(/\b(Karachi|Lahore|Islamabad|Rawalpindi|Peshawar|Faisalabad|Multan|Quetta|Sialkot|Gujranwala)\b/i);
    const mentionedCity = cityMatch ? cityMatch[0] : null;

    // 7. Intent Execution & Deterministic Fast-Paths
    if (detected.intent === 'HUMAN_TRANSFER') {
      executedAction = 'request_human_transfer';
      // Human escalation is an EVENT, not the end of the conversation. The owner is
      // notified once per window; the conversation stays active so Zara keeps answering.
      const alreadyEscalated = await ConversationStateService.hasRecentHumanEscalation(conversation.id);
      if (alreadyEscalated) {
        executedAction = 'human_transfer_already_notified';
        replyText = `Aapki request hamari human support team ko pehle hi bhej di gayi hai, woh jald rabta karegi. Tab tak main aapki madad ke liye yahin hoon — aap kya poochna chahte hain?`;
      } else {
        const escalationResult = await ToolDispatcher.dispatch('request_human_transfer', {
          orderId: recentOrder?.orderId || null,
          reason: 'Customer requested human support via WhatsApp'
        }, {
          shopDomain: shop.domain,
          shopId: shop.id,
          orderId: recentOrder?.orderId || null,
          customerPhone: cleanPhone,
          customerName: customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : null,
          customerCity: mentionedCity || recentOrder?.shippingAddress || 'On file',
          customerMessage: messageText,
          conversationId: conversation.id,
          activeProduct: candidateProduct,
          productTitle: candidateProduct?.title || null,
          orderNumber: recentOrder?.orderNumber || null
        });
        await ConversationStateService.markHumanEscalation(conversation.id, {
          notificationSent: escalationResult?.notificationSent !== false
        });
        replyText = `Maine hamari human support team ko inform kar diya hai. Hamari team aapse jald rabta karegi. Tab tak aap mujhse koi bhi sawal pooch sakte hain.`;
      }
    } else if (detected.intent === 'PRODUCT_REJECTION') {
      executedAction = 'product_rejected';
      const rejected = await ConversationStateService.rejectProduct(conversation.id, candidateProduct || null);
      replyText = rejected
        ? `Theek hai, koi baat nahi! Agar aap kuch aur dekhna chahein to product ka naam ya category bata dein, main madad kar deti hoon.`
        : `Theek hai, koi baat nahi! Agar kuch aur chahiye ho to bata dein.`;
    } else if (detected.intent === 'ORDER_SUMMARY') {
      executedAction = 'order_summary_fastpath';
      await ConversationStateService.updateState(conversation.id, { recentTopic: 'order' });
      if (orders.length > 1) {
        const list = orders.slice(0, 3).map(o => `• Order #${o.orderNumber || o.id.slice(0, 6)} (Rs. ${Number(o.totalAmount).toLocaleString()}) — ${o.items}`).join('\n');
        replyText = `Aapke ${orders.length} orders record mein hain:\n\n${list}\n\nAap kis order ke baare mein maloomat chahtay hain?`;
      } else if (recentOrder) {
        replyText = `Aapka order #${recentOrder.orderNumber} hai jisme "${recentOrder.items}" shamil hai. Iska kul COD bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai aur status "${recentOrder.status}" hai.`;
      } else {
        replyText = `Mujhe aapke number se koi order nahi mila. Kya aap apna order number (jaise #1643) share kar saktay hain taake main check kar sakoon?`;
      }
    } else if (detected.intent === 'ORDER_STATUS' && recentOrder) {
      executedAction = 'order_status_fastpath';
      await ConversationStateService.updateState(conversation.id, { recentTopic: 'order' });
      replyText = `Aapke order #${recentOrder.orderNumber} ka current status "${recentOrder.status}" hai.`;
    } else if (detected.intent === 'COMPOUND_PRODUCT_REQUEST') {
      executedAction = 'compound_products_search';
      const m = messageText.match(/(?:mujhe\s+)?(.+?)\s+(?:aur|and)\s+(.+?)(?:\s+dono|\s+both)?\s*(?:dikhao|bhejo|chahiye|hai)?$/i);
      const q1 = m ? m[1].replace(/dikhao|bhejo|chahiye|hai/gi, '').trim() : '';
      const q2 = m ? m[2].replace(/dikhao|bhejo|chahiye|hai/gi, '').trim() : '';
      const [res1, res2] = await Promise.all([
        ShopifyCatalogService.searchProducts(shop.domain, q1, { limit: 1 }),
        ShopifyCatalogService.searchProducts(shop.domain, q2, { limit: 1 })
      ]);
      const p1 = res1.products?.[0];
      const p2 = res2.products?.[0];
      const found = [p1, p2].filter(Boolean);
      if (found.length > 0) {
        await ConversationStateService.updateState(conversation.id, {
          lastProducts: found,
          currentProduct: found[0],
          lastReferencedProduct: found[0],
          recentTopic: 'product'
        });
        const list = found.map((p, idx) => `${idx + 1}. *${p.title}* — ${p.formattedPrice}\n🔗 ${p.url}`).join('\n\n');
        replyText = `Yeh products hamare paas available hain:\n\n${list}\n\nTamam collection yahan dekhein:\n🔗 ${res1.allProductsUrl || res2.allProductsUrl}`;
      } else {
        replyText = `Aapki matlooba items mein se koi product filhal nahi mila. Aap hamara poora catalog yahan dekh saktay hain: https://${shop.domain}/collections/all-products`;
      }
    } else if (detected.intent === 'DELIVERY_INQUIRY' || detected.intent === 'ORDER_DELIVERY_CHARGES') {
      // DETERMINISTIC CONTEXT HIERARCHY FOR DELIVERY:
      // Priority 2: Explicit order reference in current customer message
      if (hasOrderRef && recentOrder) {
        executedAction = 'order_delivery_charges_fastpath';
        await ConversationStateService.updateState(conversation.id, { recentTopic: 'order' });
        if (recentOrder.shippingFee > 0) {
          replyText = `Aapke order #${recentOrder.orderNumber} ke delivery charges Rs. ${Number(recentOrder.shippingFee).toLocaleString()} hain. Kul bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
        } else {
          replyText = `Aapke order #${recentOrder.orderNumber} par standard delivery bilkul free hai! Kul bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
        }
      }
      // Priority 3: Active or referenced product from conversation
      else if (candidateProduct) {
        executedAction = 'delivery_quote_fastpath';
        const quote = await DeliveryService.getDeliveryQuote({
          shopDomain: shop.domain,
          city: mentionedCity,
          subtotal: candidateProduct.numericPrice
        });
        const calc = DeliveryService.calculateTotal(candidateProduct.numericPrice, quote.deliveryCharge);
        await ConversationStateService.updateState(conversation.id, {
          deliveryContext: quote,
          currentProduct: candidateProduct,
          lastReferencedProduct: candidateProduct,
          recentTopic: 'product'
        });
        replyText = `Ji, *${candidateProduct.title}* ke delivery charges Rs. ${quote.deliveryCharge} hain.\n\nProduct: Rs. ${candidateProduct.numericPrice}\nDelivery charges: Rs. ${quote.deliveryCharge}\nKul Total: Rs. ${calc.total}\n\nProduct details:\n🔗 ${candidateProduct.url}`;
      }
      // Priority 5: Most recent customer order (when NO product ever discussed)
      else if (recentOrder) {
        executedAction = 'order_delivery_charges_fastpath';
        if (recentOrder.shippingFee > 0) {
          replyText = `Aapke order #${recentOrder.orderNumber} ke delivery charges Rs. ${Number(recentOrder.shippingFee).toLocaleString()} hain. Kul bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
        } else {
          replyText = `Aapke order #${recentOrder.orderNumber} par standard delivery bilkul free hai! Kul bill Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
        }
      }
      // Priority 6: General store delivery quote
      else {
        executedAction = 'delivery_quote_fastpath';
        const quote = await DeliveryService.getDeliveryQuote({
          shopDomain: shop.domain,
          city: mentionedCity
        });
        replyText = `Hamare standard delivery charges Rs. ${quote.deliveryCharge} hain aur delivery ${quote.estimatedDelivery} mein hoti hai.`;
      }
    } else if (detected.intent === 'TOTAL_INQUIRY' || detected.intent === 'ORDER_TOTAL') {
      // DETERMINISTIC CONTEXT HIERARCHY FOR TOTAL:
      // Priority 2: Explicit order reference in current customer message
      if (hasOrderRef && recentOrder) {
        executedAction = 'order_total_fastpath';
        await ConversationStateService.updateState(conversation.id, { recentTopic: 'order' });
        replyText = `Aapke order #${recentOrder.orderNumber} ka kul COD total Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
      }
      // Priority 3: Active or referenced product from conversation
      else if (candidateProduct) {
        executedAction = 'total_inquiry_fastpath';
        const quote = await DeliveryService.getDeliveryQuote({
          shopDomain: shop.domain,
          city: mentionedCity,
          subtotal: candidateProduct.numericPrice
        });
        const calc = DeliveryService.calculateTotal(candidateProduct.numericPrice, quote.deliveryCharge);
        await ConversationStateService.updateState(conversation.id, {
          deliveryContext: quote,
          currentProduct: candidateProduct,
          lastReferencedProduct: candidateProduct,
          recentTopic: 'product'
        });
        replyText = `*${candidateProduct.title}*\nProduct: Rs. ${candidateProduct.numericPrice}\nDelivery charges: Rs. ${quote.deliveryCharge}\nKul Total: Rs. ${calc.total}\n\n🔗 ${candidateProduct.url}`;
      }
      // Priority 5: Most recent customer order (when NO product ever discussed)
      else if (recentOrder) {
        executedAction = 'order_total_fastpath';
        replyText = `Aapke order #${recentOrder.orderNumber} ka kul COD total Rs. ${Number(recentOrder.totalAmount).toLocaleString()} hai.`;
      }
      // Priority 6: General query with no context
      else {
        replyText = `Aap kis product ka total bill janna chahte hain? Product ka naam ya link bata dein.`;
      }
    } else if (detected.intent === 'PURCHASE_INTENT') {
      executedAction = 'purchase_intent_assisted';
      let candidate = activeProduct;
      if (!candidate || !messageText.includes(candidate.title.toLowerCase().split(' ')[0])) {
        const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, messageText.replace(/confirm|order|book|karna|hai|wala|product/gi, '').trim(), { limit: 1 });
        if (searchRes.products && searchRes.products.length > 0) {
          candidate = searchRes.products[0];
          await ConversationStateService.updateState(conversation.id, { currentProduct: candidate });
        }
      }

      if (candidate) {
        replyText = `Ji, aap *${candidate.title}* (${candidate.formattedPrice}) order karna chahte hain? Main aapka order book karne mein madad kar deti hoon. Baraye meharbani apna mukammal delivery address aur city share kar dein.`;
      } else {
        replyText = `Ji bilkul! Aap kon sa product order karna chahtay hain? Product ka naam bata dein taake main aapki details note kar sakoon.`;
      }
    } else if (detected.intent === 'CONFIRM') {
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
      } else if (activeProduct) {
        replyText = `Ji, aap *${activeProduct.title}* order karna chahte hain? Main aapka order book karne mein madad kar deti hoon. Baraye meharbani apna delivery address aur city share kar dein.`;
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
    } else if (detected.intent === 'CONVERSATIONAL_CLARIFICATION') {
      executedAction = 'conversational_clarification';
      replyText = `Theek hai! Aap tasalli se check kar lein, main yahin hoon agar koi bhi sawal ho.`;
    } else if (detected.intent === 'SOCIAL_FRIENDSHIP') {
      executedAction = 'social_response';
      replyText = `Haha, bilkul! Aap mujhe apni shopping wali dost samajh sakte hain 😊 Jo bhi product ya order ke baare mein poochna ho, bata dein.`;
    } else if (detected.intent === 'SOCIAL_THANKYOU') {
      executedAction = 'social_response';
      replyText = `Bohat shukriya! Agar mazeed kisi cheez mein madad chahiye ho to zaroor batayein.`;
    } else if (detected.intent === 'SOCIAL_CLOSING') {
      executedAction = 'social_response';
      replyText = `Allah Hafiz! Apna khayal rakhiye ga.`;
    } else if (detected.intent === 'SOCIAL_ACK') {
      executedAction = 'social_response';
      replyText = `Ji zaroor! Agar koi aur sawaal ho to bata dein.`;
    } else if (detected.intent === 'MORE') {
      executedAction = 'catalog_pagination_more';
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
    } else if (detected.intent === 'ORDINAL_REFERENCE' || (candidateProduct && detected.intent === 'PRODUCT_DETAIL')) {
      executedAction = 'ordinal_reference_resolution';
      const refProduct = candidateProduct || (await ConversationStateService.resolveProductReference(conversation.id, messageText)) || activeProduct;
      if (refProduct) {
        await ConversationStateService.updateState(conversation.id, { currentProduct: refProduct, recentTopic: 'product' });
        if (/\b(price|kitne|rate|paisa|cost|prize)\b/i.test(messageText)) {
          replyText = `Ji, *${refProduct.title}* ki price ${refProduct.formattedPrice} hai.\n\nProduct details:\n🔗 ${refProduct.url}`;
        } else if (/\b(link|url|website)\b/i.test(messageText)) {
          executedAction = 'product_link_resolution';
          replyText = `Yeh raha *${refProduct.title}* ka product link:\n🔗 ${refProduct.url}`;
        } else if (/\b(available|stock|hai)\b/i.test(messageText)) {
          replyText = `Ji, *${refProduct.title}* filhal ${refProduct.available ? 'stock mein available hai' : 'out of stock hai'}. Price: ${refProduct.formattedPrice}.\n🔗 ${refProduct.url}`;
        } else {
          // Failure 2 Guarantee: Default display does NOT expose inventory status
          const quote = await DeliveryService.getDeliveryQuote({ shopDomain: shop.domain, subtotal: refProduct.numericPrice });
          const calc = DeliveryService.calculateTotal(refProduct.numericPrice, quote.deliveryCharge);
          replyText = `Ji, *${refProduct.title}* ${refProduct.formattedPrice} ka hai.\n\nDelivery charges: Rs. ${quote.deliveryCharge}\nTotal: Rs. ${calc.total}\n\nProduct details:\n🔗 ${refProduct.url}`;
        }
      }
    } else if (detected.intent === 'PRODUCT_LINK') {
      executedAction = 'product_link_resolution';
      const refProduct = candidateProduct || activeProduct;
      if (refProduct) {
        replyText = `Yeh raha *${refProduct.title}* ka link:\n🔗 ${refProduct.url}`;
      } else {
        const storeInfo = await ShopifyCatalogService.getStoreInfo(shop.domain);
        replyText = `Aap hamari website yahan visit kar saktay hain:\n🔗 ${storeInfo.storefrontUrl}`;
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
        currentProduct: searchRes.products[0] || null,
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
          AITools.get_delivery_quote,
          AITools.get_shopify_collections,
          AITools.get_store_info,
          AITools.confirm_order,
          AITools.cancel_order,
          AITools.request_human_transfer
        ];

        const systemInstruction = (
`You are Zara, the courteous, intelligent AI customer support assistant for "${storeName}".
You are communicating with a customer in Pakistan on WhatsApp.
Speak natural, helpful Roman Urdu and English. Be concise, polite, and human-like.

Customer & Store Context:
- Store: ${storeName}
- Customer Phone: ${cleanPhone}
${recentOrder ? `- Order #${recentOrder.orderNumber} (Rs. ${recentOrder.totalAmount}) - Items: ${recentOrder.items} - Status: ${recentOrder.status}` : '- No active order.'}
${activeProduct ? `- Active/Discussed Product: ${activeProduct.title} (${activeProduct.formattedPrice}) - Link: ${activeProduct.url}` : '- No active product.'}
${state.rejectedProducts && state.rejectedProducts.length > 0 ? `- Rejected / Dismissed Products (DO NOT mention or suggest these): ${state.rejectedProducts.map(p => p.title || p).join(', ')}` : ''}
${!shouldGreet ? '- NOTE: The conversation is ALREADY in progress. DO NOT start with greeting or say "Assalam-o-Alaikum! Main Zara hoon...". Answer directly.' : ''}

CRITICAL OPERATING RULES:
1. PRODUCT AVAILABILITY / STOCK POLICY:
   DEFAULT PRODUCT RESPONSES MUST NOT DISPLAY INVENTORY STATUS (do NOT say "In stock", "Out of stock", "available hai").
   ONLY state stock if the customer explicitly asked (e.g. "stock hai?", "available hai?", "mil jayega?").
   Default format: Product Name, Price, Relevant detail, Delivery & Total if asked, and Product URL.
2. CONTEXTUAL RESOLUTION:
   If the customer asks "iski price", "delivery", "total", "link", they refer to the Active Product (${activeProduct?.title || 'previously discussed item'}).
   Do NOT ask "Kis product ki price?". Answer directly!
3. DELIVERY CHARGES:
   Call 'get_delivery_quote' for delivery charges.
   Sunday Bazaaar standard COD delivery is Rs. 199 across Pakistan (3-5 business days).
   When asked "total price delivery ke sath", calculate Product + Delivery = Total.
4. ORDER INQUIRIES:
   "mera order", "last order", "jo last order aya" are ORDER queries. NEVER search products for order queries.
5. PURCHASE VS CONFIRMATION:
   If customer says "anti snoring wala product confirm kro" or wants to buy a product, assist with booking the product. Do NOT say "Mujhe aapka order nahi mila".
6. HUMAN ASSISTANCE:
   If customer requests a person, call 'request_human_transfer'. Say: "Ji, main ne aapki request customer support ko bhej di hai. Hamari team aapse jald rabta karegi. Tab tak main aapki madad ke liye yahin hoon." Do NOT claim live telephony connection.
7. NEVER invent prices, discounts, or medical cures.
8. REJECTED / DISMISSED PRODUCTS:
   If the customer said "nahi chahiye", "rehne do", "choro" or dismissed any product, NEVER recommend, mention, or append that product to future replies unless the customer explicitly asks for it again. Do NOT bring up unasked or rejected products.`
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
            orderId: recentOrder?.orderId,
            customerPhone: cleanPhone,
            conversationId: conversation.id,
            activeProduct
          });

          // Update conversational state with products returned
          const returnedProducts = toolResult?.products || (toolResult?.product ? [toolResult.product] : []);
          if (returnedProducts.length > 0) {
            await ConversationStateService.updateState(conversation.id, {
              lastProducts: returnedProducts,
              currentProduct: returnedProducts[0],
              lastReferencedProduct: returnedProducts[0],
              lastQuery: call.args?.query || '',
              currentPage: toolResult.page || 1,
              totalFound: toolResult.totalFound || returnedProducts.length,
              recentTopic: 'product'
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

          // Fallback if Turn 2 is empty or needs formatting
          if (!replyText) {
            if (call.name === 'get_shopify_product_details' && toolResult?.product) {
              const p = toolResult.product;
              replyText = `Ji, *${p.title}* ${p.formattedPrice} ka hai.\n\n${p.description ? p.description + '\n\n' : ''}Product details:\n🔗 ${p.url}`;
            } else if (call.name === 'search_shopify_products') {
              const products = toolResult?.products || [];
              if (products.length > 0) {
                if (products.length === 1) {
                  const p = products[0];
                  replyText = `Ji, *${p.title}* ${p.formattedPrice} ka hai.\n\n${p.description ? p.description + '\n\n' : ''}Product details:\n🔗 ${p.url}`;
                } else {
                  const list = products.slice(0, 5).map((p, idx) => `${idx + 1}. *${p.title}* — ${p.formattedPrice}\n🔗 ${p.url}`).join('\n\n');
                  replyText = `Hamare paas yeh products available hain:\n\n${list}\n\nTamam collection yahan dekhein:\n🔗 ${toolResult.allProductsUrl}`;
                }
              } else {
                replyText = `Maazrat, aapki matlooba item filhal catalog mein nahi mili. Hamara poora catalog yahan dekh saktay hain: https://${shop.domain}/collections/all-products`;
              }
            } else if (call.name === 'get_delivery_quote') {
              replyText = `Delivery charges Rs. ${toolResult?.deliveryCharge || 199} hain aur delivery ${toolResult?.estimatedDelivery || '3-5 business days'} mein hoti hai.`;
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
              replyText = `Ji, main ne aapki request customer support ko bhej di hai. Hamari team aapse jald rabta karegi.`;
            }
          }
        } else {
          replyText = response.text || candidate?.content?.parts?.find(p => p.text)?.text || '';
        }
      } catch (aiErr) {
        console.warn(`⚠️ [WhatsAppAgent] Gemini API unavailable or timed out (${aiErr.message}). Using safe conversational fallback.`);
        if (recentOrder) {
          replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Aapka order #${recentOrder.orderNumber} (Rs. ${recentOrder.totalAmount}) process mein hai. Confirm karne ke liye 1 aur cancel ke liye 2 reply karein.`;
        } else if (shouldGreet) {
          replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Main aapki kya madad kar sakti hoon?`;
        } else {
          replyText = `Ji, main aapki request samajh gayi hoon. Kya aap mazeed details share kar sakte hain taake main sahi rehnumai kar sakoon?`;
        }
      }
    }

    if (!replyText) {
      if (shouldGreet) {
        replyText = `Assalam-o-Alaikum! Main Zara hoon ${storeName} se. Main aapki kya madad kar sakti hoon?`;
      } else {
        replyText = `Ji zaroor! Main aapki kya madad kar sakti hoon?`;
      }
    }

    // 9. Sanitize response (permanent zero-NaN and inventory status policy guarantee)
    replyText = this.sanitizeResponse(replyText);

    // If customer did not ask about availability, strip accidental "Status: In Stock / Out of Stock"
    const customerAskedStock = /\b(stock\s*hai|available\s*hai|available\?|mil\s*jayega|stock\s*mein\s*hai)\b/i.test(messageText);
    if (!customerAskedStock) {
      replyText = replyText.replace(/\b(Status:\s*(In\s*Stock|Out\s*of\s*Stock))\b/gi, '');
      replyText = replyText.replace(/\baur yeh filhal (in stock|out of stock) hai\b/gi, '');
      replyText = replyText.replace(/\bfilhal (in stock|out of stock) hai\b/gi, '');
      replyText = replyText.replace(/\n{3,}/g, '\n\n').trim();
    }

    // Mark greeting delivered
    await ConversationStateService.markGreetingSent(conversation.id);

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

    // 12. Send reply via WA-AKG Client (Voice-In -> Voice-Out, Text-In -> Text-Out)
    try {
      if (isVoiceInbound) {
        console.log(`🎙️ [WhatsApp:VOICE_IN] Inbound voice note detected for ${fromPhone}. Initiating voice reply.`);
        console.log(`🤖 [WhatsApp:AI_RESPONSE] Generated response: "${replyText.slice(0, 80)}..."`);

        const ttsResult = await TextToSpeechService.synthesize(replyText, { voice: 'Aoede' });

        if (ttsResult.success && ttsResult.buffer && ttsResult.buffer.length > 0) {
          await waClient.sendMediaMessage(fromPhone, ttsResult.buffer, 'voice', 'zara_voice_note.ogg', '', {
            quotedMessageId: messageId || undefined
          });
          console.log(`✅ [WhatsApp:VOICE_OUT] Voice reply delivered to ${fromPhone} (${ttsResult.durationSeconds}s, ${ttsResult.buffer.length} bytes)`);
        } else {
          console.warn(`⚠️ [WhatsApp:TTS_FAILED] Falling back to text message delivery: ${ttsResult.error || 'TTS error'}`);
          if (typeof waClient?.sendMessage === 'function') {
            await waClient.sendMessage(fromPhone, replyText, {
              quotedMessageId: messageId || undefined
            });
            console.log(`✅ [WhatsAppAgent] Fallback text reply sent to ${fromPhone}: "${replyText.slice(0, 60)}..."`);
          }
        }
      } else {
        if (typeof waClient?.sendMessage === 'function') {
          await waClient.sendMessage(fromPhone, replyText, {
            quotedMessageId: messageId || undefined
          });
          console.log(`✅ [WhatsAppAgent] Reply sent to ${fromPhone}: "${replyText.slice(0, 60)}..."`);
        }
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

  /**
   * Sends an outbound voice note via WhatsApp (WA-AKG client)
   */
  static async sendWhatsAppVoiceNote(sessionId, to, audioBuffer, mimeType = 'audio/ogg; codecs=opus', options = {}) {
    const waClient = new WhatsAppClient({
      sessionId: String(sessionId),
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY
    });
    return waClient.sendMediaMessage(to, audioBuffer, 'voice', 'zara_voice_note.ogg', '', options);
  }
}

export default WhatsAppAgentService;
