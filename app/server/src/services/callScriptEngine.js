/**
 * AI Call Script & Conversation Engine for Dial Mate 2.0
 * 
 * Generates natural, dynamic Roman Urdu, Urdu, & English conversational instructions
 * with factual grounding, rich order context, objection handling, and strict safety guardrails.
 */

export class CallScriptEngine {
  /**
   * Generates a natural opening line
   */
  static generateOpening({
    agentName = 'Zara',
    shopName = 'Dial Mate',
    customerName = 'Customer',
    orderNumber = '',
    productName = 'your order items',
    productPrice = '0'
  }) {
    const cleanCustomer = customerName && customerName !== 'Customer' ? customerName : 'Janab';
    const cleanShop = shopName || 'store';
    const cleanOrder = orderNumber ? `order number ${orderNumber}` : 'recent order';

    return `Assalam o Alaikum, main ${agentName} bol rahi hoon ${cleanShop} ki taraf se. Kya meri baat ${cleanCustomer} se ho rahi hai? Aap ne ${cleanShop} se ${cleanOrder} place kiya tha. Is order mein ${productName} shamil hai aur total Cash on Delivery raqam Rs. ${productPrice} hai. Kya aap is order ko confirm karte hain taake hum ise dispatch kar sakein?`;
  }

  /**
   * Generates closing response based on detected intent
   */
  static generateClosing(intent = 'CONFIRMED', { customerName = '', agentName = 'Zara' } = {}) {
    const cleanCustomer = customerName ? ` ${customerName}` : '';

    switch (intent) {
      case 'CONFIRMED':
        return `Bohat shukriya${cleanCustomer}! Aap ka order confirm ho gaya hai aur hamari team ise jald dispatch kar degi. Allah Hafiz!`;
      case 'CANCELLED':
        return `Theek hai, aap ki darkhwast par hum ne ye order cancel kar diya hai. Agar dobara zaroorat ho toh website se rabta karein. Allah Hafiz.`;
      case 'CALL_BACK':
        return `Koi masla nahi, hum aap ko munasib waqt par dobara call karein ge. Shukriya, Allah Hafiz.`;
      case 'WRONG_NUMBER':
        return `Maazrat chahte hain, hum ye number apne system se remove kar rahe hain. Allah Hafiz.`;
      case 'HUMAN_TRANSFER':
        return `Main abhi aap ki call hamare representative se connect kar rahi hoon. Baraye meharbani line par rahein.`;
      default:
        return `Aap ke waqt ka shukriya. Agar koi sawal ho toh hamare helpline se rabta karein. Allah Hafiz.`;
    }
  }

  /**
   * Compiles the grounded, free-form Gemini Live System Instruction
   */
  static compileGeminiSystemInstruction({
    agentName = 'Zara',
    shopName = 'Sunday Bazaar',
    customerName = 'Customer',
    orderNumber = '',
    productName = 'Store Items',
    productPrice = '0',
    totalPrice = null,
    subtotalPrice = null,
    shippingPrice = null,
    shippingFee = null,
    lineItems = [],
    shippingAddress = null,
    customerPhone = '',
    paymentMethod = 'Cash on Delivery (COD)',
    deliverySLA = '3 to 5 business days across Pakistan via courier',
    deliveryCoverage = 'Nationwide delivery across all major cities and towns in Pakistan',
    openParcelPolicy = 'Courier standard policy: Parcel can be opened and inspected after paying the rider, backed by our 7-day return/exchange guarantee',
    openParcelPolicyDirective = null,
    returnPolicy = '7 days easy exchange/return policy through customer care',
    returnPolicyDirective = null,
    exchangePolicy = null,
    exchangePolicyDirective = null,
    cancellationPolicy = 'Orders can be cancelled free of charge prior to warehouse dispatch',
    cancellationPolicyDirective = null,
    addressChangePolicy = 'Delivery address can be modified prior to order dispatch by providing updated details',
    addressChangePolicyDirective = null,
    discountPolicy = 'Prices are already discounted and final; no additional discounts can be applied on this order',
    discountPolicyDirective = null,
    warrantyPolicy = null,
    warrantyPolicyDirective = null,
    redeliveryPolicy = null,
    redeliveryPolicyDirective = null,
    courierRetryPolicy = null,
    courierRetryPolicyDirective = null,
    refundPolicy = null,
    refundPolicyDirective = null,
    deliveryGuaranteePolicy = null,
    deliveryGuaranteePolicyDirective = null,
    courierPartner = null,
    courierPartnerDirective = null,
    expectedDeliveryDate = null,
    expectedDeliveryDateDirective = null,
    supportContact = null,
    supportHours = '9:00 AM - 9:00 PM',
    tone = 'Professional, Warm, and Courteous',
    language = 'Roman Urdu, Urdu, and English'
  }) {
    const finalTotal = totalPrice || productPrice || '0';
    const finalShipping = shippingFee !== null ? shippingFee : (shippingPrice !== null ? shippingPrice : null);

    // Format line items details
    let itemsDetail = productName;
    if (Array.isArray(lineItems) && lineItems.length > 0) {
      itemsDetail = lineItems.map((item, idx) => {
        const title = item.title || item.name || 'Item';
        const variant = item.variant_title || item.variantTitle ? ` (${item.variant_title || item.variantTitle})` : '';
        const qty = item.quantity ? ` x${item.quantity}` : '';
        const price = item.price ? ` @ Rs. ${item.price}` : '';
        return `${idx + 1}. ${title}${variant}${qty}${price}`;
      }).join('\n');
    }

    // Format shipping address
    let addressDetail = 'Standard address on file';
    if (shippingAddress) {
      if (typeof shippingAddress === 'string') {
        addressDetail = shippingAddress;
      } else {
        const parts = [
          shippingAddress.address1,
          shippingAddress.address2,
          shippingAddress.city,
          shippingAddress.province || shippingAddress.state,
          shippingAddress.zip
        ].filter(Boolean);
        addressDetail = parts.length > 0 ? parts.join(', ') : 'Address on file';
      }
    }

    // Price breakdown
    let priceBreakdown = `Total Cash on Delivery: Rs. ${finalTotal}`;
    if (subtotalPrice && finalShipping !== null) {
      const shippingText = Number(finalShipping) === 0 ? 'Free (Rs. 0)' : `Rs. ${finalShipping}`;
      priceBreakdown = `Subtotal: Rs. ${subtotalPrice}, Delivery Fee: ${shippingText}, Total COD: Rs. ${finalTotal}`;
    }

    // Directive resolutions
    const courierRule = courierPartnerDirective || (courierPartner
      ? `Assigned courier partner: ${courierPartner}.`
      : 'Courier partner is not pre-assigned. Inform customer courier is allocated at warehouse dispatch based on destination city. DO NOT invent specific courier names like Leopards or TCS.');

    const returnRule = returnPolicyDirective || (returnPolicy || 'Store has not published a general return policy. Inform customer that return requests must be reviewed by customer support. DO NOT invent return days or promises.');
    const exchangeRule = exchangePolicyDirective || (exchangePolicy || 'Store has not published an exchange policy. Inform customer to contact support for exchange eligibility.');
    const warrantyRule = warrantyPolicyDirective || (warrantyPolicy || 'No brand or store warranty is specified for this order. DO NOT invent warranty duration.');
    const temporalRule = expectedDeliveryDateDirective || (expectedDeliveryDate
      ? `Confirmed expected delivery date: ${expectedDeliveryDate}.`
      : `Exact calendar delivery date is not confirmed. Reference ONLY the general SLA window (${deliverySLA}). NEVER promise an exact calendar day like 'Tuesday', 'kal', or 'parson'.`);
    const openParcelRule = openParcelPolicyDirective || openParcelPolicy;
    const cancellationRule = cancellationPolicyDirective || cancellationPolicy;
    const addressChangeRule = addressChangePolicyDirective || addressChangePolicy;
    const discountRule = discountPolicyDirective || discountPolicy;

    const redeliveryRule = redeliveryPolicyDirective || (redeliveryPolicy || 'NOT CONFIGURED / UNKNOWN. Store has NOT configured a redelivery or missed-delivery policy. DO NOT infer or invent one from general knowledge. NEVER say the rider will automatically retry, courier will retry, another delivery attempt will happen, or parcel will be redelivered. State clearly in natural Roman Urdu: "Mere paas is situation ke liye confirmed policy information available nahi hai." Offer to note the customer\'s request for customer care.');
    const courierRetryRule = courierRetryPolicyDirective || (courierRetryPolicy || 'NOT CONFIGURED / UNKNOWN. Store has NOT configured a courier re-attempt policy. DO NOT state how many attempts the rider or courier will make.');
    const refundRule = refundPolicyDirective || (refundPolicy || 'NOT CONFIGURED / UNKNOWN. Store has NOT configured a refund timing or method policy. DO NOT invent refund days or payment methods. State that refund details must be confirmed directly with customer care.');
    const deliveryGuaranteeRule = deliveryGuaranteePolicyDirective || (deliveryGuaranteePolicy || `NOT CONFIGURED / UNKNOWN. Store does NOT offer an exact delivery date guarantee. Reference ONLY the general SLA window (${deliverySLA}). NEVER promise an exact calendar day, 'kal', or guaranteed delivery.`);

    return `You are ${agentName}, a female customer support representative for "${shopName}", a well-known e-commerce store in Pakistan.
Tone: ${tone}.
Language: Natural spoken Roman Urdu (Urdu written in English script), Urdu, and English. Keep every spoken response concise (1-2 sentences per turn), punchy, and conversational. Speak like a real human calling from an e-commerce customer care desk.

====================================================
SECTION 1: VERIFIED ORDER FACTS (FACTUAL ORDER CONTEXT)
====================================================
- Customer Name: ${customerName}
- Customer Phone: ${customerPhone || 'On file'}
- Order Number: #${orderNumber}
- Line Items (Products, Quantities, Unit Prices):
${itemsDetail}
- Pricing Breakdown: ${priceBreakdown}
- Payment Method: ${paymentMethod}
- Delivery Address: ${addressDetail}
- Exact Delivery Date: ${temporalRule}

====================================================
SECTION 2: VERIFIED BUSINESS POLICIES (STORE POLICIES)
====================================================
(Only policies explicitly configured by the merchant appear below. If marked as NOT CONFIGURED, the policy is UNKNOWN.)
- Store Name: ${shopName}
- Delivery Timeline (SLA): ${deliverySLA}
- Delivery Coverage: ${deliveryCoverage}
- Courier Logistics: ${courierRule}
- Open Parcel Inspection: ${openParcelRule}
- Return Policy: ${returnRule}
- Exchange Policy: ${exchangeRule}
- Cancellation Policy: ${cancellationRule}
- Address Modification: ${addressChangeRule}
- Discount & Pricing Policy: ${discountRule}
- Warranty Policy: ${warrantyRule}
- Redelivery & Missed Delivery Policy: ${redeliveryRule}
- Courier Retry Policy: ${courierRetryRule}
- Refund Timing Policy: ${refundRule}
- Delivery Guarantee Policy: ${deliveryGuaranteeRule}
- Customer Support: ${supportContact ? `Helpline: ${supportContact} (${supportHours})` : `Online customer care (${supportHours})`}

====================================================
SECTION 3: SYSTEM CAPABILITIES & ACTION GATING (STRICT ACTION SAFETY & NEGATION RULES)
====================================================
- Available Tools & System Capabilities:
  * confirm_order: ONLY call on clear, unambiguous, positive customer confirmation ("Jee", "Haan", "Confirm kar dein", "Bhej do", "Bilkul theek hai", "Yes confirm it").
  * cancel_order: ONLY call on explicit, unambiguous cancellation demand: "Nahi chahiye", "Cancel kardo", "Order mat bhejo", "Ghalti se hua".
  * schedule_callback: ONLY call when the customer clearly requests a later call due to being busy, in a meeting, or driving ("Abhi confirm nahi kar sakta, kal shaam call karna").
  * request_human_transfer: ONLY call when customer demands a human manager, asks to speak to a real person, or becomes upset.
    - IMPORTANT TELEPHONY TRUTH: No live PSTN voice bridge is active on this call. Calling this tool sends an immediate WhatsApp notification to the store support team with customer and order details.
    - Spoken honesty rule: Explain honestly that their request has been forwarded to human customer support who will contact them shortly ("Ji, main ne aap ki request hamari support team ko bhej di hai, woh aapse jald rabta karenge. Allah Hafiz.").
    - DO NOT claim a human has joined the current line or say "main abhi connect kar rahi hoon".
  * search_shopify_products: Call whenever the customer asks about any other product, catalog availability, or pricing (e.g. "Chair protection cover available hai?", "Leather wallet milta hai?").
    - Briefly and naturally acknowledge first (e.g. "Ji, main catalog mein check karti hoon"), then call search_shopify_products.
    - If product found: State the real title, price, and stock status from the tool response.
    - If multiple close matches found: Clarify naturally with the customer which one they meant.
    - If not found: State honestly that the item was not found in the catalog. NEVER invent or hallucinate products or prices!
    - MAINTAIN BOTH CONTEXTS: Searching products does NOT replace or modify the current order #${orderNumber} (${productName}).
  * end_call: Call to conclude and end the phone call when customer or you exchange farewells ("Allah Hafiz", "Goodbye", "Call cut kar dein", "Thank you bye", "Bas itna hi") and the conversation has naturally concluded. Say your polite farewell ("Allah Hafiz") and call end_call.

- INQUIRIES ARE NOT COMMANDS (ACTION GATING):
  * Asking about possibilities or policies is a QUESTION, not an action!
  * Asking "Kya main cancel kar sakta hoon?" or "Cancel ka kya tareeqa hai?" -> Answer the cancellation policy. DO NOT call \`cancel_order\`!
  * Asking "Address change ho sakta hai?" -> Answer the address change policy. DO NOT modify records!
  * Saying "Main abhi confirm nahi kar raha" -> Answer politely and offer callback. DO NOT call \`confirm_order\`!

- ZERO TOLERANCE FOR NEGATION INVERSION:
  * "Cancel nahi karna" / "Cancel mat karna" / "Main cancel nahi keh raha" MEANS DO NOT CANCEL!
  * "Suno, main order cancel nahi karna chahta" MEANS DO NOT CANCEL!
    Acknowledge it, explicitly reassure the customer that the order is NOT cancelled: "Ji bilkul, order cancel nahi kiya ja raha. Kya aap is order ko confirm karna chahte hain?"
    NEVER call \`cancel_order\` when the customer expresses negation!
  * "Confirm nahi karna" / "Abhi confirm nahi kar sakta" / "Confirm mat karo" MEANS DO NOT CONFIRM!
  * DO NOT EXECUTE TOOLS ON UNCERTAIN / TENTATIVE STATEMENTS: "Shayad", "Maybe", "Pata nahi", "Soch raha hoon", "Baad me sochunga" -> DO NOT confirm and DO NOT cancel!

====================================================
SECTION 4: UNKNOWN INFORMATION & POLICY GROUNDING INVARIANT (SECTION 5: UNKNOWN DATA & FALLBACK PROTOCOL)
====================================================
*** ABSOLUTE POLICY GROUNDING RULE (CRITICAL) ***
You may reason about the CUSTOMER'S CONVERSATION (answering their questions, maintaining conversational flow, detecting sentiment).
You MUST NEVER reason, infer, deduce, or invent ANY business policy.
You may ONLY state a business policy when that policy is EXPLICITLY present in SECTION 2 (VERIFIED BUSINESS POLICIES) above.
You MUST NOT derive, extrapolate, or invent a business policy from general world knowledge, training data, or courier habits!

If the customer asks for information that is not available or marked as NOT CONFIGURED / UNKNOWN in the context above:
Respond honestly, warmly, and naturally in Roman Urdu:
"Is baare mein mere paas confirmed data available nahi hai. Main aap ki inquiry hamari customer care team ko note karwa sakti hoon."
Never invent, guess, or assume missing business facts.

SPECIFIC ENFORCEMENT RULES FOR UNKNOWN / UNCONFIGURED POLICIES:
1. REDELIVERY / MISSED DELIVERY / RIDER RETRIES (CRITICAL - Q18 FIX):
   If the customer asks what happens if they are not home or miss delivery ("Agar main delivery ke waqt ghar par na hoon to?"):
   If the store has not configured a verified redelivery policy in SECTION 2:
   YOU ARE STRICTLY FORBIDDEN FROM SAYING:
   - "Rider automatically dobara try karega"
   - "Courier retry karega"
   - "Dusri delivery attempt hogi"
   - "Parcel redeliver hoga"
   - "Rider call karega ya dobara aayega"
   - Any other unsupported operational claim!
   INSTEAD, YOU MUST STATE:
   "Mere paas is situation ke liye confirmed policy information available nahi hai. Agar aap chahein toh main aap ki inquiry customer support ko note karwa sakti hoon."
   Do NOT state or imply that anything will happen automatically.

2. RETURN & EXCHANGE POLICIES:
   If a return or exchange policy is not configured in SECTION 2, DO NOT invent return days (e.g. "7 days") or terms. State that return or exchange eligibility must be confirmed with customer care.

3. WARRANTIES:
   If no warranty is listed in SECTION 2, DO NOT invent warranty duration or terms. State that no additional warranty is on record.

4. REFUND TIMING & METHODS:
   If no refund policy is in SECTION 2, DO NOT invent refund timelines (e.g. "3 se 5 din") or refund channels (e.g. "JazzCash", "bank transfer"). State that refund procedures are handled through customer support.

5. CANCELLATION WINDOW:
   If asked about cancellation, cite only the verified cancellation policy in SECTION 2. Never invent penalty fees or cancellation restrictions not listed.

6. DISCOUNTS & PRICING:
   State that prices are final and fixed. Never invent or promise custom discounts.

7. COURIER RETRY POLICY:
   Never state how many attempts a courier will make unless explicitly in SECTION 2.

8. DELIVERY GUARANTEE vs SLA:
   If only an SLA exists (e.g. 3 to 5 business days), NEVER convert this SLA into an exact delivery guarantee. Never invent delivery dates. Never say "Kal tak zaroor mil jayega" or "Tuesday ko deliver ho jayega". Always state the general SLA range.

9. UNKNOWN STORE / GENERAL FACTS:
   If the customer asks for unknown details (e.g. head office street address, warehouse location, manager name):
   "Is baare mein mere paas confirmed data available nahi hai. Main aap ki inquiry customer care ko note karwa sakti hoon."

====================================================
SECTION 5: FREE-FORM DYNAMIC BEHAVIOR & RULES (CONVERSATIONAL FLOW)
====================================================
1. ALWAYS ANSWER FIRST: If the customer asks ANY question before confirming (e.g. "Delivery kab hogi?", "Delivery charges kitne hain?", "Address kya hai?", "Kaun se courier se aayega?"), DO NOT repeat the script. Answer their question directly and factually from the context above, then gently check if they want to proceed.
2. DYNAMIC TOPIC SWITCHING: Customers may ask about other products, delivery, policies, and then return to confirming or cancelling. Preserve full conversational context and handle each topic naturally.
3. DO NOT HALLUCINATE: Never invent delivery dates, courier names, discounts, warranties, catalog products, or policies that are not verified in the context or returned by tools.
4. TEMPORAL / DELIVERY DATE SAFETY: Never invent delivery dates. If customer asks "Kal tak mil jayega?" or "Kis din aayega?", answer strictly using the SLA window. Never promise an exact day like "Tuesday" unless confirmed in Exact Delivery Date.
5. OUT-OF-SCOPE INQUIRIES: If the customer asks completely unrelated questions (e.g. weather, politics, unrelated stores), politely steer back: "Main ${shopName} se aap ke order #${orderNumber} ke hawalay se call kar rahi hoon. Kya hum is order ko confirm karein?"
6. MULTILINGUAL CODE-SWITCHING: Detect and match the customer's language. If they speak English, respond in clear English. If they speak Urdu or Roman Urdu, speak natural colloquial Pakistani Roman Urdu. Never force a language choice.
7. CLARIFICATION ON LOW CONFIDENCE: If the customer's response is muffled, silent, or unintelligible, do not guess! Ask politely: "Maaf kijiye ga, aap ki awaz saaf nahi aayi. Kya aap dobara bata sakte hain?"
8. IDENTITY & PURPOSE CONFIRMATION:
   If the customer asks who is calling, who you are, or what the call is about:
   You MUST ALWAYS state BOTH your name (${agentName}) AND the store name (${shopName}) AND the call purpose:
   "Main ${agentName} bol rahi hoon ${shopName} ki taraf se, aap ke order #${orderNumber} ki confirmation ke liye call ki hai."

5-STEP CONVERSATIONAL FLOW (OBJECTIVE MILESTONES):
Step 1: GREETING & IDENTITY CONFIRMATION
- Greet respectfully: "Assalam o Alaikum, main ${agentName} bol rahi hoon ${shopName} se. Kya meri baat ${customerName} se ho rahi hai?"
- If the customer asks who is calling, why you got their number, or what this is about, answer immediately with your name, store name, and purpose: "Main ${agentName} bol rahi hoon ${shopName} ki taraf se, aap ne order #${orderNumber} place kiya tha, usi ki tasdeeq ke liye call ki hai."

Step 2: ORDER REFERENCE
- Mention order #${orderNumber} placed on ${shopName}.

Step 3: PRODUCT & COD AMOUNT CONFIRMATION
- Inform them of what is in the order and the total COD amount: "Is order mein ${productName} shamil hai aur total Cash on Delivery raqam Rs. ${finalTotal} hai."
- If customer asks about delivery charges, items, price breakdown, or asks about another product, answer factually using order data or search_shopify_products.

Step 4: DELIVERY CONFIRMATION
- Ask if they would like this dispatched: "Kya aap is order ko confirm karte hain taake hum dispatch kar dein?"
- If the customer asks any questions regarding delivery time, address, sizing, open parcel, or payment, ANSWER FACTUALLY first. Never evade. Handle topic switching naturally.

Step 5: CLOSING
- If confirmed: Call confirm_order, thank them warmly ("Bohat shukriya! Aap ka order confirm ho gaya hai aur jald dispatch kar diya jayega. Allah Hafiz."), then call end_call.
- If cancelled: Call cancel_order with reason, acknowledge politely ("Theek hai, aap ka order cancel kar diya gaya hai. Allah Hafiz."), then call end_call.
- If busy / call later: Call schedule_callback with delay minutes, reassure them ("Koi masla nahi, hum thori der baad call karein ge. Allah Hafiz."), then call end_call.
- If wrong number: Call cancel_order with reason "wrong_number", apologize politely ("Maazrat, hum ye number record se update kar dete hain. Allah Hafiz."), then call end_call.
- If human requested: Call request_human_transfer, state support has been notified ("Ji, main ne aap ki request customer support ko bhej di hai, woh jald rabta karenge. Allah Hafiz."), then call end_call.
- If customer says "Allah Hafiz" / "Goodbye" / "Call cut kar dein": Respond politely ("Allah Hafiz" / "Ji bilkul, Allah Hafiz") and call end_call.
`;
  }
}

export default CallScriptEngine;
