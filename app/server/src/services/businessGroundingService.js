/**
 * Business Grounding & Policy Sanitization Service for Dial Mate 2.0
 * 
 * Enforces strict tenant isolation, factual order grounding, store policy resolution,
 * anti-hallucination constraints, and safe unknown-data fallbacks for conversational AI.
 */

export class TenantIsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

export class BusinessGroundingService {
  /**
   * Builds raw business context from verified database records
   * Scoped strictly to the provided order and shop
   */
  static buildBusinessContext({ order, shop, customer = null }) {
    if (!order) {
      throw new Error('Order record is required to build business context');
    }
    if (!shop) {
      throw new Error('Shop record is required to build business context');
    }

    // Tenant Isolation Guard: Verify order belongs to the specified shop
    if (order.shopId && order.shopId !== shop.id) {
      throw new TenantIsolationError(
        `Cross-tenant violation: Order ${order.id} (shopId: ${order.shopId}) does not belong to Shop ${shop.id} (${shop.domain})`
      );
    }
    if (order.shop?.domain && order.shop.domain !== shop.domain) {
      throw new TenantIsolationError(
        `Cross-tenant violation: Order ${order.id} belongs to ${order.shop.domain}, not ${shop.domain}`
      );
    }

    // Parse Order Payload safely
    let payload = {};
    if (order.payload) {
      try {
        payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
      } catch (err) {
        console.warn('Could not parse order payload:', err.message);
      }
    }

    // Parse Shop Settings safely
    let settings = {};
    if (shop.settings) {
      try {
        settings = typeof shop.settings === 'string' ? JSON.parse(shop.settings) : shop.settings;
      } catch (err) {
        console.warn('Could not parse shop settings:', err.message);
      }
    }

    // 1. Resolve Customer Information
    const custRecord = customer || order.customer;
    const customerFirstName = custRecord?.firstName || payload.customer?.first_name || '';
    const customerLastName = custRecord?.lastName || payload.customer?.last_name || '';
    const rawCustomerName = `${customerFirstName} ${customerLastName}`.trim() ||
      payload.shipping_address?.name ||
      'Customer';
    const customerPhone = custRecord?.phone || payload.shipping_address?.phone || payload.phone || 'On file';

    // 2. Resolve Line Items
    let lineItems = [];
    if (Array.isArray(payload.line_items) && payload.line_items.length > 0) {
      lineItems = payload.line_items.map((item) => ({
        title: item.title || item.name || 'Store Item',
        variantTitle: item.variant_title || item.variantTitle || '',
        quantity: Number(item.quantity || 1),
        price: item.price ? String(item.price) : '',
        sku: item.sku || null
      }));
    } else if (order.lineItemsSummary) {
      lineItems = [{ title: order.lineItemsSummary, variantTitle: '', quantity: 1, price: String(order.totalAmount || '0') }];
    } else {
      lineItems = [{ title: 'Order Items', variantTitle: '', quantity: 1, price: String(order.totalAmount || '0') }];
    }

    const primaryProductName = lineItems[0]?.title || 'Store Items';

    // 3. Resolve Pricing & Payment Method
    const subtotalPrice = payload.subtotal_price ? String(payload.subtotal_price) : null;
    let shippingFee = '0';
    if (payload.shipping_lines?.[0]?.price) {
      shippingFee = String(payload.shipping_lines[0].price);
    } else if (payload.total_shipping_price_set?.shop_money?.amount) {
      shippingFee = String(payload.total_shipping_price_set.shop_money.amount);
    }

    const totalPrice = String(order.totalAmount || payload.total_price || '0');
    const isFreeShipping = Number(shippingFee) === 0;

    // Detect Payment Method (COD vs Prepaid Online)
    let paymentMethod = 'Cash on Delivery (COD)';
    const financialStatus = (payload.financial_status || '').toLowerCase();
    const gateways = Array.isArray(payload.payment_gateway_names) ? payload.payment_gateway_names : [];
    if (financialStatus === 'paid' || financialStatus === 'authorized') {
      const gatewayName = gateways[0] || 'Online Payment';
      paymentMethod = `Prepaid (Paid online via ${gatewayName})`;
    } else if (settings.orderRules?.codOnly !== false) {
      paymentMethod = 'Cash on Delivery (COD)';
    }

    // 4. Resolve Shipping Address
    const shippingAddress = payload.shipping_address || {};
    const addressParts = [
      shippingAddress.address1,
      shippingAddress.address2,
      shippingAddress.city || custRecord?.city,
      shippingAddress.province || shippingAddress.state,
      shippingAddress.zip
    ].filter(Boolean);

    const formattedAddress = addressParts.length > 0
      ? addressParts.join(', ')
      : (custRecord?.address ? `${custRecord.address}, ${custRecord.city || ''}` : 'Address on file');

    const destinationCity = shippingAddress.city || custRecord?.city || null;
    const destinationProvince = shippingAddress.province || shippingAddress.state || null;

    // 5. Resolve Store & Courier Policies
    const shopName = shop.name || shop.domain?.replace('.myshopify.com', '') || 'Store';
    const shopDomain = shop.domain;
    const supportContact = settings.escalationNumber || settings.workingHoursPhone || shop.contact || null;
    const supportHours = settings.workingHours || '9:00 AM - 9:00 PM';
    const deliverySLA = settings.deliverySLA || '3 to 5 business days';
    const deliveryCoverage = settings.deliveryCoverage || 'Nationwide delivery across all major cities and towns in Pakistan';

    // Open parcel policy resolution
    let openParcelPolicy = null;
    if (settings.openParcelPolicy) {
      openParcelPolicy = settings.openParcelPolicy;
    } else if (settings.allowOpenParcel === true) {
      openParcelPolicy = 'Allowed to inspect parcel before paying rider';
    } else if (settings.allowOpenParcel === false) {
      openParcelPolicy = 'Courier policy does not permit opening parcel before payment; covered by store return/exchange policy';
    }

    // Other store policies
    const returnPolicy = settings.returnPolicy || null;
    const exchangePolicy = settings.exchangePolicy || null;
    const cancellationPolicy = settings.cancellationPolicy || 'Orders can be cancelled free of charge prior to warehouse dispatch';
    const addressChangePolicy = settings.addressChangePolicy || 'Delivery address can be modified prior to order dispatch by providing updated details';
    const discountPolicy = settings.discountPolicy || 'Prices are already discounted and final; no additional discounts can be applied on this order';
    const warrantyPolicy = settings.warrantyPolicy || null;
    const redeliveryPolicy = settings.redeliveryPolicy || settings.missedDeliveryPolicy || null;
    const courierRetryPolicy = settings.courierRetryPolicy || null;
    const refundPolicy = settings.refundPolicy || settings.refundTimingPolicy || null;
    const deliveryGuaranteePolicy = settings.deliveryGuaranteePolicy || settings.deliveryGuarantee || null;

    // Courier partner & tracking
    const courierPartner = order.courierName || settings.courierPartner || null;
    const trackingNumber = order.trackingNumber || null;
    const expectedDeliveryDate = order.expectedDelivery || null;

    return {
      orderId: order.id,
      orderNumber: order.orderNumber || (payload.order_number ? `#${payload.order_number}` : order.id.slice(0, 6)),
      shopId: shop.id,
      shopDomain,
      shopName,
      customerName: rawCustomerName,
      customerPhone,
      lineItems,
      productName: primaryProductName,
      subtotalPrice,
      shippingFee,
      isFreeShipping,
      totalPrice,
      paymentMethod,
      shippingAddress: formattedAddress,
      destinationCity,
      destinationProvince,
      deliverySLA,
      deliveryCoverage,
      openParcelPolicy,
      returnPolicy,
      exchangePolicy,
      cancellationPolicy,
      addressChangePolicy,
      discountPolicy,
      warrantyPolicy,
      redeliveryPolicy,
      courierRetryPolicy,
      refundPolicy,
      deliveryGuaranteePolicy,
      courierPartner,
      trackingNumber,
      expectedDeliveryDate,
      supportContact,
      supportHours
    };
  }

  /**
   * Sanitizes the raw context for a specific tenant, stripping secrets,
   * enforcing strict tenant boundaries, and adding anti-hallucination directives
   * for any missing or unconfigured fields.
   */
  static sanitizeBusinessContext(rawContext, { tenantDomain }) {
    if (!rawContext) {
      throw new Error('Raw business context is required for sanitization');
    }
    if (!tenantDomain) {
      throw new Error('Tenant domain is mandatory for business context sanitization');
    }

    // Strict Tenant Boundary Assertion
    if (rawContext.shopDomain !== tenantDomain) {
      throw new TenantIsolationError(
        `Cross-tenant leakage detected: Attempted to sanitize context for ${tenantDomain} using data from ${rawContext.shopDomain}`
      );
    }

    // Deep clone to prevent accidental mutations
    const sanitized = JSON.parse(JSON.stringify(rawContext));

    // Ensure no secrets or credentials leaked in context
    delete sanitized.accessToken;
    delete sanitized.passwordHash;
    delete sanitized.apiKey;
    delete sanitized.apiSecret;

    // Explicit Anti-Hallucination Directives for Unconfigured Fields
    if (!sanitized.courierPartner) {
      sanitized.courierPartnerDirective =
        'Courier partner is not pre-assigned. Inform customer courier is allocated at warehouse dispatch based on delivery city. DO NOT invent specific courier names like Leopards or TCS.';
    } else {
      sanitized.courierPartnerDirective = `Assigned courier partner: ${sanitized.courierPartner}.`;
    }

    if (!sanitized.returnPolicy) {
      sanitized.returnPolicyDirective =
        'Store has not published a general return policy. Inform customer that return requests must be reviewed by customer support. DO NOT invent return days or promises.';
    } else {
      sanitized.returnPolicyDirective = sanitized.returnPolicy;
    }

    if (!sanitized.exchangePolicy) {
      sanitized.exchangePolicyDirective =
        'Store has not published an exchange policy. Inform customer to contact support for exchange eligibility (e.g. size/color). DO NOT invent terms.';
    } else {
      sanitized.exchangePolicyDirective = sanitized.exchangePolicy;
    }

    if (!sanitized.warrantyPolicy) {
      sanitized.warrantyPolicyDirective =
        'No brand or store warranty is specified for this order. DO NOT invent warranty duration.';
    } else {
      sanitized.warrantyPolicyDirective = sanitized.warrantyPolicy;
    }

    if (!sanitized.expectedDeliveryDate) {
      sanitized.expectedDeliveryDateDirective =
        `Exact calendar delivery date is not confirmed. Reference ONLY the general SLA window (${sanitized.deliverySLA}). NEVER promise an exact calendar day like 'Tuesday', 'kal', or 'parson'.`;
    } else {
      sanitized.expectedDeliveryDateDirective = `Confirmed expected delivery date: ${sanitized.expectedDeliveryDate}.`;
    }

    if (!sanitized.openParcelPolicy) {
      sanitized.openParcelPolicyDirective =
        'Courier standard policy: Parcel can be opened and inspected after paying rider, backed by store customer support guarantee.';
    } else {
      sanitized.openParcelPolicyDirective = sanitized.openParcelPolicy;
    }

    // Missed Delivery & Redelivery Directive (Q18 Hardening)
    if (!sanitized.redeliveryPolicy) {
      sanitized.redeliveryPolicyDirective =
        'Store has NOT configured a redelivery or missed-delivery policy. DO NOT infer or invent one from general knowledge. NEVER say the rider will automatically retry, courier will retry, another delivery attempt will happen, or parcel will be redelivered. State clearly in natural Roman Urdu: "Mere paas is situation ke liye confirmed policy information available nahi hai." Offer to note the customer\'s request for customer care.';
    } else {
      sanitized.redeliveryPolicyDirective = sanitized.redeliveryPolicy;
    }

    // Courier Retry Policy Directive
    if (!sanitized.courierRetryPolicy) {
      sanitized.courierRetryPolicyDirective =
        'Store has NOT configured a courier re-attempt policy. DO NOT state how many attempts the rider or courier will make.';
    } else {
      sanitized.courierRetryPolicyDirective = sanitized.courierRetryPolicy;
    }

    // Refund Timing Policy Directive
    if (!sanitized.refundPolicy) {
      sanitized.refundPolicyDirective =
        'Store has NOT configured a refund timing or method policy. DO NOT invent refund days (e.g. "3-5 days") or payment channels. State that refund details must be confirmed directly with customer care.';
    } else {
      sanitized.refundPolicyDirective = sanitized.refundPolicy;
    }

    // Delivery Guarantee Policy Directive
    if (!sanitized.deliveryGuaranteePolicy) {
      sanitized.deliveryGuaranteePolicyDirective =
        `Store does NOT provide an exact delivery date guarantee. Reference ONLY the general SLA window (${sanitized.deliverySLA}). NEVER promise an exact calendar day, 'kal', or guaranteed delivery.`;
    } else {
      sanitized.deliveryGuaranteePolicyDirective = sanitized.deliveryGuaranteePolicy;
    }

    return sanitized;
  }
}

export default BusinessGroundingService;
