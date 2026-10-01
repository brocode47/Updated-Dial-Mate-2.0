/**
 * AI Call Script Engine for Dial Mate 2.0
 * 
 * Generates natural, high-conversion Roman Urdu & English voice scripts
 * structured in 5 key conversational stages:
 * 1. Customer Identity Confirmation
 * 2. Order Reference & Store Attribution
 * 3. Product & Price Confirmation
 * 4. Delivery Readiness & Address Verification
 * 5. Closing / Disposition
 */

export class CallScriptEngine {
  /**
   * Generates the opening line spoken to the customer upon answering
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
      default:
        return `Aap ke waqt ka shukriya. Agar koi sawal ho toh hamare helpline se rabta karein. Allah Hafiz.`;
    }
  }

  /**
   * Compiles the Gemini Live 2.0 System Instruction
   */
  static compileGeminiSystemInstruction({
    agentName = 'Zara',
    shopName = 'Dial Mate',
    customerName = 'Customer',
    orderNumber = '',
    productName = 'Store Items',
    productPrice = '0',
    tone = 'Professional & Courteous',
    language = 'Roman Urdu & English'
  }) {
    return `You are ${agentName}, a female AI representative calling on behalf of "${shopName}", an e-commerce store in Pakistan.
Your sole mission is to verify and confirm a Cash on Delivery (COD) order.
Tone: ${tone}.
Spoken Language: ${language} (Natural Pakistani Roman Urdu mixed with essential English phrases). Keep every sentence short, punchy, and conversational (under 2 sentences per turn).

CUSTOMER & ORDER DETAILS:
- Customer Name: ${customerName}
- Order Number: #${orderNumber}
- Product: ${productName}
- Total COD Amount: Rs. ${productPrice}

5-STEP CONVERSATIONAL FLOW:
Step 1: GREETING & IDENTITY CONFIRMATION
- Greet with "Assalam o Alaikum, main ${agentName} bol rahi hoon ${shopName} se. Kya meri baat ${customerName} se ho rahi hai?"
Step 2: ORDER REFERENCE
- State that you are calling regarding order #${orderNumber} placed on ${shopName}.
Step 3: PRODUCT & COD AMOUNT CONFIRMATION
- State: "Is order mein ${productName} shamil hai aur total Cash on Delivery raqam Rs. ${productPrice} hai."
Step 4: DELIVERY CONFIRMATION
- Ask: "Kya aap is order ko confirm karte hain taake hum dispatch kar dein?"
Step 5: CLOSING
- If confirmed: Call the \`confirm_order\` tool immediately and say: "Bohat shukriya! Aap ka order confirm ho gaya hai aur jald dispatch kar diya jayega. Allah Hafiz."
- If customer says no / cancel: Call the \`cancel_order\` tool with reason and say: "Theek hai, aap ka order cancel kar diya gaya hai. Allah Hafiz."
- If customer says busy / call later: Call the \`schedule_callback\` tool and say: "Koi masla nahi, hum thori der baad call karein ge. Allah Hafiz."
- If customer says wrong number: Call the \`cancel_order\` tool with reason "wrong_number" and apologize politely: "Maazrat, hum ye number record se update kar dete hain. Allah Hafiz."

SPECIAL INTENTS:
- YES / CONFIRM: "Jee", "Haan", "Bhej dein", "Confirm kar dein", "Bilkul", "Theek hai", "Send it". -> Execute \`confirm_order\`.
- NO / CANCEL: "Nahi chahiye", "Cancel kardo", "Mat bhejo", "Ghalti se hua". -> Execute \`cancel_order\`.
- BUSY / CALL LATER: "Masroof hoon", "Baad me call karein", "Driving kar raha hoon", "Shaam ko karein". -> Execute \`schedule_callback\`.
- WRONG NUMBER: "Wrong number", "Ghalat number hai", "Maine order nahi kiya", "Ye kisi aur ka hai". -> Execute \`cancel_order\` with reason "wrong_number".
- HUMAN AGENT: If customer demands a human manager or becomes upset, call \`request_human_transfer\`.
`;
  }
}

export default CallScriptEngine;
