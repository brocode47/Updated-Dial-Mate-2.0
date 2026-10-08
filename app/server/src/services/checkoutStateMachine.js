import { PhoneNormalizer } from './phoneNormalizer.js';
import { ProductSummaryService } from './productSummaryService.js';
import { DeliveryService } from './deliveryService.js';

export const CheckoutStep = {
  IDLE: 'IDLE',
  PRODUCT_SELECTED: 'PRODUCT_SELECTED',
  PRODUCT_REVIEW: 'PRODUCT_REVIEW',
  COLLECTING_CUSTOMER_DETAILS: 'COLLECTING_CUSTOMER_DETAILS',
  COLLECTING_ADDRESS: 'COLLECTING_ADDRESS',
  ORDER_REVIEW: 'ORDER_REVIEW',
  EXPLICIT_CONFIRMATION: 'EXPLICIT_CONFIRMATION',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED'
};

const PAKISTAN_CITIES = [
  'karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'multan',
  'peshawar', 'quetta', 'gujranwala', 'sialkot', 'hyderabad', 'sukkur',
  'abbottabad', 'bahawalpur', 'sargodha', 'gujrat', 'sheikhupura', 'jhelum',
  'sahiwal', 'larkana', 'wah cantt', 'mardan', 'rahim yar khan', 'kasur'
];

/**
 * Deterministic Checkout State Machine for Dial Mate 2.0 / Zara
 */
export class CheckoutStateMachine {
  /**
   * Extracts customer checkout information from unstructured message
   *
   * @param {string} text
   * @returns {{ name?: string, phone?: string, city?: string, address?: string }}
   */
  static extractCustomerInfo(text = '') {
    const raw = String(text || '').trim();
    const clean = raw.toLowerCase();
    const extracted = {};

    // 1. Name extraction
    const nameMatch = clean.match(/(?:mera\s*)?(?:naam|name)\s*(?:hai|hy|he|is|:)?\s*([a-z\s]{2,25}?)(?:\s+(?:hai|hy|he|aur|and|from|se|mein|rehta|rehti|,|\.|$))/i) ||
      clean.match(/^([a-z]{3,15}\s+[a-z]{3,15})$/i);
    if (nameMatch && nameMatch[1]) {
      const candidateName = nameMatch[1].trim();
      const nonNames = ['chair', 'cover', 'order', 'status', 'karo', 'check', 'directory', 'karachi', 'lahore'];
      if (!nonNames.some(w => candidateName.toLowerCase().includes(w))) {
        extracted.name = candidateName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }

    // 2. City extraction
    for (const city of PAKISTAN_CITIES) {
      const cityRegex = new RegExp(`\\b${city}\\b`, 'i');
      if (cityRegex.test(clean)) {
        extracted.city = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }

    // 3. Phone extraction (Pakistani mobile format)
    const phoneMatch = clean.match(/\b(03\d{2}[-.\s]?\d{7}|923\d{2}[-.\s]?\d{7}|\+923\d{2}[-.\s]?\d{7})\b/);
    if (phoneMatch) {
      extracted.phone = phoneMatch[1].replace(/[-.\s]/g, '');
    }

    // 4. Street / Complete Address extraction
    const addrIndicators = /(?:address|adrs|pata)\s*(?:hai|hy|he|is|:)?\s*([^,.\n]+)/i;
    const addrMatch = raw.match(addrIndicators);
    if (addrMatch && addrMatch[1]) {
      let candidateAddr = addrMatch[1].trim();
      // Strip any operational instructions or directory search phrases
      candidateAddr = candidateAddr.replace(/\s*(?:apne|apni)?\s*(?:directory|check\s*karo|status|batao|btao|details?|record|mein|main|se|jo\s*order).*$/i, '').trim();
      candidateAddr = candidateAddr.replace(/\s+(?:hai|hy|he|h)$/i, '').trim();
      const isJustCity = PAKISTAN_CITIES.some(c => candidateAddr.toLowerCase() === c);
      if (candidateAddr.length > 5 && !isJustCity) {
        extracted.address = candidateAddr;
      }
    } else {
      // Look for street, house, block, sector, road, phase patterns
      const streetMatch = raw.match(/\b(?:house|flat|h#|street|st#|block|sector|road|phase|mohalla|scheme|town)\b[^\n,.]+/i);
      if (streetMatch) {
        extracted.address = streetMatch[0].trim();
      }
    }

    return extracted;
  }

  /**
   * Evaluates missing required checkout fields
   *
   * @param {object} checkoutState
   * @returns {string[]} Array of missing field identifiers: ['product', 'name', 'phone', 'address', 'city']
   */
  static getMissingFields(checkoutState = {}) {
    const missing = [];
    if (!checkoutState.product) missing.push('product');
    if (!checkoutState.customerName) missing.push('name');
    if (!checkoutState.customerPhone) missing.push('phone');
    if (!checkoutState.city) missing.push('city');
    if (!checkoutState.address || checkoutState.address.length < 8) missing.push('address');
    return missing;
  }

  /**
   * Updates and advances the checkout state machine
   *
   * @param {object} currentState
   * @param {string} userMessage
   * @param {object} context - { activeProduct, customer, senderPhone, fromPhone }
   * @returns {{ nextState: string, checkout: object, prompt: string, isReadyForConfirmation: boolean }}
   */
  static processTurn(currentState = {}, userMessage = '', context = {}) {
    const extracted = this.extractCustomerInfo(userMessage);

    // Merge product
    const product = context.activeProduct || currentState.product || null;

    // Merge customer identity
    const customerName = extracted.name || currentState.customerName || context.customer?.firstName || null;
    const customerPhone = extracted.phone || currentState.customerPhone || context.customer?.phone || context.senderPhone || null;
    const city = extracted.city || currentState.city || (context.customer?.address?.city) || null;
    let address = extracted.address || currentState.address || null;

    // If city provided but full address missing, keep city
    if (!address && city && extracted.address) {
      address = extracted.address;
    }

    const price = product ? Number(product.numericPrice || 0) : 0;
    const deliveryCharge = product ? (product.deliveryCharge || 199) : 199;
    const total = price > 0 ? (price + deliveryCharge) : 0;

    const updatedCheckout = {
      ...currentState,
      product,
      customerName,
      customerPhone,
      city,
      address,
      price,
      deliveryCharge,
      total,
      quantity: currentState.quantity || 1
    };

    const missing = this.getMissingFields(updatedCheckout);
    updatedCheckout.missingFields = missing;

    // Determine state
    if (!product) {
      return {
        nextState: CheckoutStep.IDLE,
        checkout: updatedCheckout,
        isReadyForConfirmation: false,
        prompt: 'Ji bilkul! Aap kon sa product order karna chahtay hain? Product ka naam bata dein taake main aapka order book kar sakoon.'
      };
    }

    const prodNames = ProductSummaryService.normalizeProductName(product.title);

    // If missing name or phone or address
    if (missing.length > 0) {
      let prompt = '';
      const prodSummary = `*${prodNames.customerFriendlyName}* (Price: Rs. ${price}, Delivery: Rs. ${deliveryCharge}, Total: Rs. ${total})`;

      if (missing.includes('name') && missing.includes('address')) {
        prompt = `Ji bilkul! Aap ${prodSummary} order karna chahtay hain. Order book karne ke liye apna naam, complete delivery address aur city share kar dein.`;
      } else if (missing.includes('address')) {
        const namePart = customerName ? `Aapka naam ${customerName} note ho gaya hai. ` : '';
        const cityPart = city ? `City ${city} ke liye ` : '';
        prompt = `Ji bilkul! ${namePart}${cityPart}baraye meharbani apna mukammal house/street delivery address share kar dein taake order book ho sake.`;
      } else if (missing.includes('city')) {
        prompt = `Ji, baraye meharbani apni city (shehar) ka naam bata dein jahan delivery karni hai.`;
      } else if (missing.includes('name')) {
        prompt = `Ji, baraye meharbani apna naam bata dein jiske naam par parcel book karna hai.`;
      } else if (missing.includes('phone')) {
        prompt = `Ji, baraye meharbani apna contact phone number share kar dein jahan courier rider rabta kar sake.`;
      }

      return {
        nextState: CheckoutStep.COLLECTING_ADDRESS,
        checkout: updatedCheckout,
        isReadyForConfirmation: false,
        prompt
      };
    }

    // All fields present -> ORDER_REVIEW / EXPLICIT_CONFIRMATION
    const reviewPrompt =
      `Ji bilkul! Aapka order details yeh hain:\n\n` +
      `📦 *Product:* ${prodNames.customerFriendlyName}\n` +
      `💰 *Price:* Rs. ${price}\n` +
      `🚚 *Delivery:* Rs. ${deliveryCharge}\n` +
      `💵 *Total COD:* Rs. ${total}\n` +
      `👤 *Naam:* ${customerName}\n` +
      `📞 *Phone:* ${customerPhone}\n` +
      `📍 *Address:* ${address}, ${city}\n\n` +
      `Kya main yeh order confirm kar doon? Reply "Haan" ya "Confirm".`;

    return {
      nextState: CheckoutStep.ORDER_REVIEW,
      checkout: updatedCheckout,
      isReadyForConfirmation: true,
      prompt: reviewPrompt
    };
  }
}

export default CheckoutStateMachine;
