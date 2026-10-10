import { MessageNormalizer, SemanticContextResolver, IntentEngine } from './conversationBrain.js';

/**
 * Deterministic Intent Resolver for Dial Mate 2.0 / Zara
 *
 * Production Guarantees:
 * 1. Strict priority hierarchy.
 * 2. Order and identity queries NEVER fall into catalog searches.
 * 3. Exact order number input isolated.
 * 4. Safety against negations and hesitations.
 */
export class IntentResolver {
  /**
   * Evaluates if an action is negated or hesitated
   *
   * @param {string} text
   * @param {'confirm'|'cancel'} action
   * @returns {boolean}
   */
  static isNegated(text = '', action = 'confirm') {
    const clean = String(text || '').toLowerCase().trim();
    if (action === 'confirm') {
      if (/\b(confirm|cnfrm)\s*(nahi|nahin|nhi|mat|mt|na)\b/i.test(clean)) return true;
      if (/(?<!\bcancel\s*)\b(nahi|nahin|nhi|mat|mt|na)\s*(karna|krna|karwana)?\s*(confirm|cnfrm)\b/i.test(clean)) return true;
      if (/\b(bhejna|bhejo|dispatch|deliver)\s*(mat|nahi|nahin|nhi|na)\b/i.test(clean)) return true;
      if (/\b(mat|nahi|nahin|nhi|na)\s*(bhejna|bhejo|dispatch|deliver)\b/i.test(clean)) return true;
      if (/\b(abhi\s*nahi|soch\s*kar|shayad|baad\s*mein|bad\s*me|wait|ruko|filhal\s*nahi|filhaal\s*nahi)\b/i.test(clean)) return true;
      return false;
    }
    if (action === 'cancel') {
      if (/\b(cancel|cancle)\s*(nahi|nahin|nhi|mat|mt|na)\b/i.test(clean)) return true;
      if (/(?<!\b(confirm|cnfrm)\s*)\b(nahi|nahin|nhi|mat|mt|na)\s*(karna|krna|karwana)?\s*(cancel|cancle)\b/i.test(clean)) return true;
      return false;
    }
    return false;
  }

  /**
   * Pre-normalization pass for phonetic spelling, typos, abbreviations and Roman Urdu variations
   *
   * @param {string} text
   * @returns {string}
   */
  static normalizeText(text = '') {
    if (!text) return '';
    let t = String(text).toLowerCase().trim();

    // Common phonetic substitutions & contractions
    t = t.replace(/\b(mujhy|muje|mjhe|mujy|mje|muj)\b/gi, 'mujhe');
    t = t.replace(/\b(chahiye|chaiye|chahye|chaia|chahie|chaheye|chahiy)\b/gi, 'chahiye');
    t = t.replace(/\b(protekshan|protekshin|protact|protector)\b/gi, 'protection');
    t = t.replace(/\b(chear|chaer|chayer)\b/gi, 'chair');
    t = t.replace(/\b(delivry|delvry|dilvery|dilevery|dlvery)\b/gi, 'delivery');
    t = t.replace(/\b(pohcha|pohncha|poncha|pahuncha|pohancho|pahancha)\b/gi, 'pohancha');
    t = t.replace(/\b(kidr|kdr|kidhar)\b/gi, 'kahan');
    t = t.replace(/\b(cnfrm|confrim|confrm|cnfirm)\b/gi, 'confirm');
    t = t.replace(/\b(cancle|cancil|cancl)\b/gi, 'cancel');
    t = t.replace(/\b(plz|plse|plese)\b/gi, 'please');
    t = t.replace(/\b(btao|btado|batadein|bta|btayein)\b/gi, 'batao');
    t = t.replace(/\b(yr|yara)\b/gi, 'yaar');
    t = t.replace(/\b(kitny|kitney)\b/gi, 'kitne');
    t = t.replace(/\b(kro|krow)\b/gi, 'karo');
    t = t.replace(/\b(krdo|kardo)\b/gi, 'kar do');
    t = t.replace(/\b(krna|karna)\b/gi, 'karna');
    t = t.replace(/\b(kr)\b/gi, 'kar');
    t = t.replace(/\b(mt)\b/gi, 'mat');
    t = t.replace(/\b(nhi|nai)\b/gi, 'nahi');
    t = t.replace(/\b(kb)\b/gi, 'kab');
    t = t.replace(/\b(kaha|kha)\b/gi, 'kahan');
    t = t.replace(/\b(bottal|botal|botle)\b/gi, 'bottle');
    t = t.replace(/\b(safai|safayee)\b/gi, 'cleaning');
    t = t.replace(/\b(baraf|barf)\b/gi, 'ice');
    t = t.replace(/\b(nasel)\b/gi, 'nasal');
    t = t.replace(/\b(dikhaye|dikhao|dekhao|dkhao)\b/gi, 'dikhao');
    t = t.replace(/\b(bhejo|bhej|send\s*kro|send\s*karo)\b/gi, 'bhejo');

    return t;
  }

  /**
   * Resolves the customer's intent from the message and conversation context
   *
   * @param {string} text
   * @param {object} context - { activeProduct, activeOrder, state, recentOrders }
   * @returns {{ intent: string, confidence: number, [key: string]: any }}
   */
  static resolveIntent(text = '', context = {}) {
    const clean = this.normalizeText(text);
    const state = context.state || {};

    // Semantic Intent Understanding from Conversation Brain
    const norm = MessageNormalizer.normalize(text);
    const discourse = SemanticContextResolver.evaluateDiscourse(norm, state, { orders: context.recentOrders });
    const entityRes = SemanticContextResolver.resolveEntity(norm, state, discourse, { orders: context.recentOrders });
    const brainRes = IntentEngine.inferIntent(norm, discourse, entityRes, state);
    if (brainRes && brainRes.intent && brainRes.intent !== 'GENERAL_QUERY') {
      return brainRes;
    }

    // 1. Direct code shortcuts
    if (clean === '1' || clean === 'confirm') {
      return { intent: 'CONFIRM', confidence: 0.99 };
    }
    if (clean === '2' || clean === 'cancel') {
      return { intent: 'CANCEL', confidence: 0.99 };
    }

    // 2. Explicit Standalone Order Number Input (e.g. "123", "1643", "#1643", "1643 wala", "order 1643")
    const orderNumMatch = clean.match(/^#?(\d{3,7})(?:\s*wala(?:\s*order)?)?$/i);
    if (orderNumMatch) {
      return { intent: 'ORDER_NUMBER_INPUT', orderNumber: orderNumMatch[1], confidence: 0.99 };
    }
    const explicitOrderNum = clean.match(/^(?:order|mera\s*order)\s*(?:#|no\.?|number)?\s*(\d{3,7})(?:\s*wala)?$/i);
    if (explicitOrderNum) {
      return { intent: 'ORDER_NUMBER_INPUT', orderNumber: explicitOrderNum[1], confidence: 0.99 };
    }

    // 2b. Customer Complaint & Retention ("main kabhi ab shopping nahi karunga", "bohat buri service")
    if (
      /\b(kabhi\s*(bhi\s*)?(ab\s*)?(shopping\s*nahi|nahi\s*karunga|kuch\s*nahi\s*mangwana)|dobara\s*shopping\s*nahi|bohat\s*buri\s*service|bht\s*buri\s*service|gandi\s*service|fraud|service\s*pasand\s*nahi|never\s*shopping\s*again|worst\s*service|nahi\s*karunga\s*shopping)\b/i.test(clean) ||
      /\b(main\s*kabhi\s*ab\s*.*shopping\s*nahi)\b/i.test(clean)
    ) {
      return { intent: 'CUSTOMER_COMPLAINT', confidence: 0.96 };
    }

    // 2c. Customer Frustration & Attitude ("yr tumhara masla kya hai", "tum kya bata rahi ho", "bekar bot ho")
    if (
      /\b(tum\s*kya\s*bata\s*rahi\s*ho|tumhara\s*masla\s*kya\s*hai|tmhara\s*masla\s*kya\s*hai|bekar\s*bot|bakwas\s*bot|fuzool\s*bot|fazol\s*bot|samajh\s*nahi\s*aa\s*raha|samjh\s*nhi\s*ara|kya\s*bakwas\s*hai|kisi\s*kaam\s*ki\s*nahi|dimagh\s*kharab|dimaag\s*kharab|chup\s*karo|shut\s*up|idiot|pagal\s*bot)\b/i.test(clean) ||
      /\b(masla\s*kya\s*hai|kya\s*masla\s*hai|tumhara\s*kya\s*masla\s*hai)\b/i.test(clean)
    ) {
      return { intent: 'CUSTOMER_FRUSTRATION', confidence: 0.98 };
    }

    // 3. Negations & Hesitations
    const isConfirmNegated = this.isNegated(clean, 'confirm');
    const isCancelNegated = this.isNegated(clean, 'cancel');

    // "Confirm nahi karna cancel kardo"
    if (isConfirmNegated && /\b(cancel|cancle|khatam|mansookh)\b/i.test(clean) && !isCancelNegated) {
      return { intent: 'CANCEL', confidence: 0.95 };
    }
    // "Order cancel mat karna / confirm hi rakhna"
    if (isCancelNegated && /\b(confirm|bhej|dispatch)\b/i.test(clean) && !isConfirmNegated) {
      return { intent: 'CONFIRM', confidence: 0.95 };
    }
    if (isConfirmNegated) {
      return { intent: 'CONFIRM_NEGATED', confidence: 0.98 };
    }
    if (isCancelNegated) {
      if (/\b(mt|mat)\s*k[ar]na\b/i.test(text)) {
        return { intent: 'CANCEL', isNegated: true, confidence: 0.98 };
      }
      return { intent: 'CANCEL_NEGATED', confidence: 0.98 };
    }

    // 4. Conversational Clarification / Soft Negation ("nahi main kr rha hun na")
    if (/\b(nahi\s*main\s*(kar|kr)\s*rha\s*hun|main\s*khud\s*kar\s*raha|nahi\s*rehne\s*do|wait|ek\s*minute)\b/i.test(clean)) {
      return { intent: 'CONVERSATIONAL_CLARIFICATION', confidence: 0.90 };
    }

    // 5. Customer Order Status Queries ("mera order kahan pohcha", "order status", etc.)
    if (
      /\b((?:order|parcel|package)\s*(?:ka|ki|ke)?\s*(?:status|tracking|(?:kahan|kidhar)\s*(?:poh[ae]?n?ch\w*|pahn?ch\w*|tak))|status\s*kya\s*hai|status\s*(?:batao|btao|chahiye|required)|tracking\s*batao|parcel\s*ka\s*status|order\s*confirm\s*hua|cancel\s*hua)\b/i.test(clean) ||
      /\b(?:order|parcel)\s*(?:kahan|kidhar)\s*poh[ae]?n?ch/i.test(clean) ||
      (/\border\b/i.test(clean) && /\bstatus\b/i.test(clean))
    ) {
      return { intent: 'ORDER_STATUS', confidence: 0.98 };
    }

    // 6. Customer Identity & Directory Order Lookup (MUST NEVER SEARCH CATALOG!)
    if (
      /\b(directory|directory\s*mein|directory\s*main|details?\s*se|name\s*se|naam\s*se|address\s*se|number\s*se|phone\s*se|details?\s*check|mere\s*details|meri\s*details|mere\s*number\s*se|meri\s*details\s*se)\b/i.test(clean) ||
      (/\b(check\s*karo|check\s*karein|dhoondo|dhundo|search\s*karo)\b/i.test(clean) && /\b(order|parcel|booking|details|record|directory|number)\b/i.test(clean))
    ) {
      return { intent: 'ORDER_LOOKUP_BY_DETAILS', confidence: 0.98 };
    }

    // 7. Human Escalation Requests vs Informational Owner Queries
    if (/\b(tumh?are\s*owner\s*ka\s*naam|owner\s*ka\s*naam|owner\s*kon\s*hai|owner\s*koun\s*hai|who\s*is\s*(the\s*)?owner)\b/i.test(clean)) {
      return { intent: 'OWNER_INFO', confidence: 0.95 };
    }

    const personWord = '(human|insan|insaan|real\\s*(person|banda|insan)|asli\\s*banda|banda|bande|bandey|bandy|agent|representative|operator|owner|manager|customer\\s*(support|care|service)|support(\\s*(team|staff))?|staff)';
    if (
      new RegExp(`(kisi\\s*)?${personWord}\\s*(se|sy|say|ko)\\s*(baat|bat|bate|talk|connect|milao|milwao|rabta|call|bulao|transfer)`, 'i').test(clean) ||
      new RegExp(`\\b(talk|speak|baat|connect|transfer)\\s*(to|with|karwao|karao|karo)?\\s*(a\\s*)?(kisi\\s*)?${personWord}\\b`, 'i').test(clean) ||
      /\b(human|agent|insan|banda)\s*(chahiye|please|plz|bhejo|bulao)\b/i.test(clean) ||
      /\b(human|live)\s*agent\b/i.test(clean) ||
      /\b(owner|manager|human|support)\s*(ka\s*)?(number|contact|rabta)\s*(do|dein|chahiye|bhejo)?\b/i.test(clean) ||
      /\b(owner\s*se\s*connect|owner\s*ko\s*bulao|owner\s*se\s*baat|owner\s*se\s*baat\s*karni\s*hai)\b/i.test(clean)
    ) {
      return { intent: 'HUMAN_TRANSFER', confidence: 0.96 };
    }

    // 8. Bot Identity
    if (/\b((tum[ahr]+a|tmhara|apka|aapka|tera|your|bot)\s*(naam|name)\s*kya\s*(hai|h[ya]i?|he)|who\s*are\s*you|what\s*is\s*your\s*name)\b/i.test(clean)) {
      return { intent: 'BOT_IDENTITY', confidence: 0.95 };
    }

    // 9. Rejections & Dismissals in Context
    const isRejection =
      /\b(nahi|nahin|nhi|nai|no)\s*(chahiye|chahiyeh|chaiye|chahye|chahiay|lena|leni|lene|lunga|lungi|pasand)\b/i.test(clean) ||
      /\b(rehne?\s*(do|dein|de)|reh\s*ne\s*do|rahne\s*do|chh?oro|chh?or\s*do|chodo|chhod\s*do|skip|no\s*thanks?|not\s*interested|don'?t\s*want|dont\s*want|no\s*need)\b/i.test(clean) ||
      /\b(zarurat|zaroorat|zarorat)\s*(nahi|nhi|nahin)\b/i.test(clean) ||
      clean === 'nahi' || clean === 'nahin' || clean === 'nhi' || clean === 'no';

    if (isRejection) {
      const hasOrderActive = Boolean(state.activeOrderNumber || state.activeOrderId || context.activeOrder || state.recentTopic === 'order');
      const mentionsNewProduct = /\b(product|item|cover|belt|shoes|kursi|chair|snoring|dilator|kitchen)\b/i.test(clean);
      if (hasOrderActive && !mentionsNewProduct) {
        return { intent: 'CANCEL', confidence: 0.96 };
      }
      return { intent: 'PRODUCT_REJECTION', confidence: 0.94 };
    }

    // 10. Explicit Order Cancellation
    if (/\b(cancel\s*(kar|kardo|karein|karna|dein)?|cancle|cancil|cancl|radd)\b/i.test(clean)) {
      const isOrderExplicit = /\b(order|parcel|booking|mera\s*order|order\s*#?\d*)\b/i.test(clean);
      return { intent: 'CANCEL', isOrderCancel: isOrderExplicit, confidence: 0.96 };
    }

    // 11. Ordinal or Contextual Product References (e.g. "iska price?", "iski price?", "iska link", "pehle wale", "doosre wale", "ye wala kitne ka?")
    if (
      (/\b(pehle\s*wale|doosre\s*wale|dusre\s*wale|teesre|tisre|chothe|paanchwe|1st|2nd|3rd|number\s*1|number\s*2|yeh?\s*wal[ae]y?|pehly\s*walay|woh?\s*wal[ae]y?|doosra\s*wala|last\s*wala|iska\s*link|iski\s*link)\b/i.test(clean) ||
       /\b(iska|iski)\s*price\?/i.test(clean)) &&
      !/\b(order|confirm|cnfrm)\b/i.test(clean)
    ) {
      return { intent: 'ORDINAL_REFERENCE', confidence: 0.92 };
    }

        // Store & Website Link
    if (
      /\b(website\s*(ka\s*)?(link|url|bhejo)?|store\s*(ka\s*)?(link|url|bhejo)|online\s*store)\b/i.test(clean) &&
      !/\b(product|item|iska|iski)\b/i.test(clean)
    ) {
      return { intent: 'STORE_LINK', confidence: 0.96 };
    }

// 12. Direct Product Link Request ("link bhejo", "link do", "url bhejo")
    if (
      /\b(link\s*(do|dein|bhejo|bhej|send\s*k[ar]o)|(?:product|item|page|direct)\s*(?:ka\s*)?link|(?:iska|product)\s*url|url\s*(bhejo|send\s*k[ar]o|do)|product\s*page|mujhe\s*(?:iska\s*)?link\s*chahiye|where\s*can\s*i\s*see\s*this)\b/i.test(clean) ||
      clean === 'link' || clean === 'link?' || clean === 'url'
    ) {
      return { intent: 'PRODUCT_LINK', confidence: 0.96 };
    }

    // 13. Total Price Inquiry (matches ORDER_TOTAL for full consistency across test suites)
    if (
      /\b(iska\s*total|total\s*kitna|total\s*bill|kitne\s*paise|total\s*amount|cod\s*amount|kitna\s*bill|kul\s*total|total\?|delivery\s*(?:ke\s*sath|mila\s*k[ae]?)\s*total|delivery\s*mila\s*k\s*kitna|total\s*with\s*delivery|ghar\s*tak\s*kitne|shipping\s*ke\s*sath|kul\s*kitna|overall\s*price|kitna\s*padega)\b/i.test(clean) ||
      clean === 'total' || clean === 'total?'
    ) {
      return { intent: 'ORDER_TOTAL', confidence: 0.95 };
    }

    // 14. Delivery Charges & Shipping Inquiry (matches ORDER_DELIVERY_CHARGES)
    if (
      (/\b(delivery\s*charges?|shipping\s*charges?|deliv[er]*y\s*charges?|delivry\s*charges?|delivery\s*kitni|shipping\s*kitni|delivery\s*cost|ghar\s*tak\s*delivery|delivery\s*included|delivery\s*free|delivery\s*mila\s*k[ae]?\s*kitna)\b/i.test(clean) ||
      clean === 'delivery' || clean === 'delivery?' || clean === 'shipping' ||
      /\b(karachi|lahore|islamabad|rawalpindi|peshawar|multan|faisalabad)\s+delivery\b/i.test(clean)) &&
      !/\b(total|kul|overall)\b/i.test(clean)
    ) {
      return { intent: 'ORDER_DELIVERY_CHARGES', confidence: 0.95 };
    }

    // 15. Product Purchase Intent vs Existing Order Confirmation
    if (
      /\b(order\s*kar\s*(do|dein|kardo)|book\s*kar\s*(do|dein|kardo)|ye\s*order\s*kar\s*(do|dein)|ye\s*lena\s*hai|yeh\s*lena\s*hai|order\s*karna\s*hai|mujhe\s*ye\s*chahiye|lena\s*hai|product\s*confirm\s*(kro|karo|krdo|kardo)|.*wala\s*order\s*kar\s*(do|dein|kardo))\b/i.test(clean)
    ) {
      return { intent: 'PURCHASE_INTENT', confidence: 0.94 };
    }

    // 16. Confirmation of existing order / selected product
    if (
      /\b(please\s*)?(mera\s*)?order\s*(confirm|cnfrm)\s*(k[ar]o|krdo|kardo|dein|kar\s*(?:do|dein))?\b/i.test(clean) ||
      /\b(confirm\s*(?:my\s*)?order|order\s*confirm|booking\s*confirm|cnfrm\s*krdo|confirm\s*kardo|confirm\s*kar\s*(?:do|dein|dijie)|confirm\s*kar\s*dein|haan\s*yehi|haan\s*ye|ji\s*yehi|ye\s*wala\s*confirm)\b/i.test(clean) ||
      /\b(dispatch\s*(?:kar\s*)?(?:do|dein)|(?:haan\s*)?bhej(?:o)?\s*(?:do|dein))\b/i.test(clean) ||
      clean === 'confirm kar dein' || clean === 'confirm kar do' || clean === 'confirm' || clean === 'haan' || clean === 'ji' || clean === 'haan bhej do'
    ) {
      return { intent: 'CONFIRM', confidence: 0.94 };
    }

    // 17. Single Product Detail inquiry (strictly for products, never orders)
    if (
      !/\b(order|parcel|booking)\b/i.test(clean) && (
        /\b(price|rate|cost|prize|details|detail)\b/i.test(clean) ||
        /\b(ki\s*price|ka\s*rate|kitn(?:ay|ey|e|y|a|i)\s*ka\s*(?:h[ya]i?|he|hai|par(?:ay|ey|e|a)\s*ga|padega|parega)?|price\s*batao|rate\s*batao|ye\s*kitny\s*ka|details\s*batao|detail\s*batao)\b/i.test(clean) ||
        /\b(?:ye|yeh)?\s*kitn(?:ay|ey|e|y|a|i)\s*ka\s*(?:par(?:ay|ey|e|a)\s*ga|padega|parega|h[ya]i?)\b/i.test(clean) ||
        clean === 'price' || clean === 'price?' || clean === 'details'
      )
    ) {
      return { intent: 'PRODUCT_DETAIL', confidence: 0.92 };
    }

    // 18. General Order Summary / Order History Queries
    if (
      !/\b(confirm|cnfrm|confrim|cancel|cancle|dispatch)\b/i.test(clean) && (
        /\b(last\s*order|latest\s*order|recent\s*order|last\s*wala\s*order|jo\s*(tumhare\s*pas\s*)?last\s*order|mera\s*last\s*order|last\s*order\s*ka\s*number|latest\s*booking|meri\s*latest\s*booking|jo\s*last\s*order\s*aya)\b/i.test(clean) ||
        /\b(mera\s*order\s*kya\s*hai|kya\s*order\s*hai|order\s*details|kya\s*order\s*kiya|kya\s*mangwaya|mera\s*order|mere\s*kitne\s*orders)\b/i.test(clean) ||
        /\b(mera\s*par[sc][ae]l\s*(kidr|kahan|kab)?|par[sc][ae]l\s*kab\s*ayega|order\s*kab\s*(ayega|milega)|(par[sc][ae]l|order)\s*kab\s*(ayega|milega|deliver|pohanchega)|kab\s*deliver\s*hoga|delivery\s*kab\s*(hogi|ho\s*gi)|order\s*kidr\s*hai|order\s*kahan\s*hai|yeh?\s*kab\s*(?:tak\s*)?poh[ae]?n?ch\w*|ye\s*kab\s*ayega)\b/i.test(clean) ||
        /\b(kal\s*wala\s*order|jo\s*order\s*mene\s*kal\s*kiya|kal\s*(?:aik\s*|ek\s*)?order\s*kiya|mene\s*kal\s*.*order\s*kiya|order\s*kiya\s*tha|order\s*number\s*yad\s*nahi|order\s*no\s*yaad\s*nahi)\b/i.test(clean)
      )
    ) {
      return { intent: 'ORDER_SUMMARY', confidence: 0.96 };
    }

        // Pagination More ("aur dikhao", "aur products", "next", "mazeed")
    if (/\b(aur\s*dikhao|aur\s*products?|next|mazeed|more)\b/i.test(clean)) {
      return { intent: 'MORE', confidence: 0.94 };
    }

    // Social Ack ("acha", "theek hai", "theek", "sahi hai", "ok")
    if (/\b(acha|achha|theek\s*hai|theek|sahi\s*hai|ok|okay)\b/i.test(clean) && clean.length < 15) {
      return { intent: 'SOCIAL_ACK', confidence: 0.94 };
    }

    // General Greeting Query ("hello", "hi", "assalam o alaikum", "kaise ho")
    if (/\b(hello|hi|hey|assalam\s*o\s*alaikum|salam|kese\s*ho|kaise\s*ho)\b/i.test(clean) && !/\b(order|price|link|cancel|confirm)\b/i.test(clean)) {
      return { intent: 'GENERAL_QUERY', confidence: 0.90 };
    }

// 19. Collections & Catalog
    if (/\b(collection|collections|kitchen\s*(ke\s*)?products?|mobile\s*accessories|women\s*collection|cleaning\s*(ke\s*)?products?|cleaning\s*collection)\b/i.test(clean)) {
      return { intent: 'COLLECTION', confidence: 0.90 };
    }
    if (/\b(catalog\s*dikhao|catalog\s*bhejo|products\s*dikhao|sari\s*items|tamam\s*products|kya\s*kya\s*hai|list\s*bhejo|sab\s*products|aur\s*kya\s*hai)\b/i.test(clean)) {
      return { intent: 'CATALOG', confidence: 0.92 };
    }
    if (/\b(website\s*(ka\s*)?(link|url)?|store\s*(ka\s*)?(link|url)|website\s*kya\s*hai|online\s*store|website\s*bhejo)\b/i.test(clean) && !/\b(product|item|iska)\b/i.test(clean)) {
      return { intent: 'STORE_LINK', confidence: 0.95 };
    }
    if (/\b(aur\s*dikhao|aur\s*dikha|aur\s*bhejo|aur\s*batao|koi\s*aur|another|next|more|mazeed)\b/i.test(clean) || clean === 'aur dikhao' || clean === 'next' || clean === 'more') {
      return { intent: 'MORE', confidence: 0.95 };
    }

    // 20. Social Friendship & Chit-Chat
    if (/\b(dosti\s*karogi|friendship|friends|dost\s*ban\s*sakte|dosti)\b/i.test(clean)) {
      return { intent: 'SOCIAL_FRIENDSHIP', confidence: 0.95 };
    }
    if (/\b(allah\s*hafiz|khuda\s*hafiz|bye|goodbye)\b/i.test(clean)) {
      return { intent: 'SOCIAL_CLOSING', confidence: 0.95 };
    }
    if (/\b(thank\s*you|thanks|shukriya|meherbani)\b/i.test(clean)) {
      return { intent: 'SOCIAL_THANKYOU', confidence: 0.95 };
    }
    if (/\b(neend\s*nahi|neend\s*nhi|girlfriend|kaisi\s*ho|kese\s*ho|kya\s*haal|upset\s*h[uo]n?|udas\s*h[uo]n?|sad\s*h[uo]n?|pareshan\s*h[uo]n?|mood\s*kharab)\b/i.test(clean)) {
      return { intent: 'SOCIAL_CASUAL', confidence: 0.95 };
    }

    // 21. Product Inquiry Keywords
    if (
      /\b(product|item|cover|belt|shoes|shirt|suit|wall\s*max|chair|kursi|snoring|dilator|kharat[eo]n?|kharate|silicone|protection|brush|bottle|bottal|mat|cleaner|cleaning|lunch\s*box|cutter|chopper|mop|dispenser|stand|holder|light|fan|watch)\b/i.test(clean) ||
      (/\b(dikhao|dikha\s*do|dikha\s*dein|dikhana|dikha\s*bhejo|show\s*me|mujhe\s*.*chahiye)\b/i.test(clean) && !/\b(order|parcel|booking|status|cancel|confirm)\b/i.test(clean))
    ) {
      return { intent: 'PRODUCT_INQUIRY', confidence: 0.90 };
    }

    return { intent: 'GENERAL_QUERY', confidence: 0.60 };
  }
}

export default IntentResolver;