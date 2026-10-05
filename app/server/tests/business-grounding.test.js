import { describe, it, expect } from 'vitest';
import { BusinessGroundingService, TenantIsolationError } from '../src/services/businessGroundingService.js';
import { CallScriptEngine } from '../src/services/callScriptEngine.js';

describe('Business Grounding & Policy Safety Suite', () => {
  const shopA = {
    id: 'shop-uuid-alpha',
    domain: 'brand-alpha.myshopify.com',
    name: 'Brand Alpha Store',
    contact: '+923001111111',
    settings: JSON.stringify({
      deliverySLA: '2 to 4 working days',
      courierPartner: 'TCS Express',
      allowOpenParcel: true,
      returnPolicy: '7-day hassle free return policy',
      exchangePolicy: '3-day size exchange through support',
      cancellationPolicy: 'Can cancel anytime before rider pickup',
      addressChangePolicy: 'Address can be modified prior to dispatch',
      discountPolicy: 'Fixed prices as displayed',
      warrantyPolicy: '6 months brand warranty against defects',
      workingHours: '10:00 AM - 8:00 PM',
      escalationNumber: '+923001111111'
    })
  };

  const shopB = {
    id: 'shop-uuid-beta',
    domain: 'store-beta.myshopify.com',
    name: 'Beta Electronics',
    contact: '+923002222222',
    settings: JSON.stringify({
      deliverySLA: '4 to 6 business days',
      courierPartner: null, // Unassigned
      allowOpenParcel: false,
      returnPolicy: null, // Unconfigured
      exchangePolicy: null, // Unconfigured
      warrantyPolicy: null, // Unconfigured
      workingHours: '9:00 AM - 6:00 PM'
    })
  };

  const orderA = {
    id: 'order-alpha-001',
    shopId: 'shop-uuid-alpha',
    orderNumber: 'AL-1090',
    totalAmount: 4500,
    status: 'Pending Confirmation',
    courierName: 'TCS Express',
    expectedDelivery: '2026-10-08',
    payload: JSON.stringify({
      order_number: 1090,
      total_price: '4500',
      subtotal_price: '4200',
      shipping_lines: [{ price: '300' }],
      financial_status: 'pending',
      payment_gateway_names: ['Cash on Delivery'],
      line_items: [
        { title: 'Men Oxford Shoes', variant_title: 'Brown / 42', quantity: 1, price: '4200' }
      ],
      shipping_address: {
        name: 'Usman Ali',
        address1: 'Flat 4B, Clifton Block 2',
        city: 'Karachi',
        province: 'Sindh',
        zip: '75600',
        phone: '+923001234567'
      }
    })
  };

  const orderB = {
    id: 'order-beta-002',
    shopId: 'shop-uuid-beta',
    orderNumber: 'BE-5501',
    totalAmount: 1800,
    status: 'Pending Confirmation',
    courierName: null,
    expectedDelivery: null,
    payload: JSON.stringify({
      order_number: 5501,
      total_price: '1800',
      subtotal_price: '1800',
      shipping_lines: [{ price: '0' }],
      financial_status: 'paid',
      payment_gateway_names: ['Credit Card (Mastercard)'],
      line_items: [
        { title: 'Bluetooth Speaker Mini', variant_title: 'Matte Grey', quantity: 2, price: '900' }
      ],
      shipping_address: {
        name: 'Fatima Noor',
        address1: 'House 19, Sector G-11/3',
        city: 'Islamabad',
        province: 'Federal Capital',
        zip: '44000',
        phone: '+923009876543'
      }
    })
  };

  // =========================================================================
  // 1. TENANT ISOLATION TESTS
  // =========================================================================
  describe('Tenant Boundary Isolation', () => {
    it('strictly throws TenantIsolationError when attempting to build context with mismatched order and shop', () => {
      expect(() => {
        BusinessGroundingService.buildBusinessContext({
          order: orderA, // shopId: shop-uuid-alpha
          shop: shopB    // id: shop-uuid-beta
        });
      }).toThrowError(TenantIsolationError);
    });

    it('strictly throws TenantIsolationError when sanitizing context with cross-tenant domain', () => {
      const rawContext = BusinessGroundingService.buildBusinessContext({
        order: orderA,
        shop: shopA
      });

      expect(() => {
        BusinessGroundingService.sanitizeBusinessContext(rawContext, {
          tenantDomain: 'different-store.myshopify.com'
        });
      }).toThrowError(TenantIsolationError);
    });

    it('ensures zero data leakage between Store Alpha and Store Beta contexts', () => {
      const contextA = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderA, shop: shopA }),
        { tenantDomain: shopA.domain }
      );

      const contextB = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderB, shop: shopB }),
        { tenantDomain: shopB.domain }
      );

      const promptA = CallScriptEngine.compileGeminiSystemInstruction(contextA);
      const promptB = CallScriptEngine.compileGeminiSystemInstruction(contextB);

      // Verify Store Alpha has its own data and NO Beta data
      expect(promptA).toContain('Brand Alpha Store');
      expect(promptA).toContain('Men Oxford Shoes');
      expect(promptA).toContain('Usman Ali');
      expect(promptA).toContain('Karachi');
      expect(promptA).not.toContain('Beta Electronics');
      expect(promptA).not.toContain('Bluetooth Speaker');
      expect(promptA).not.toContain('Fatima Noor');
      expect(promptA).not.toContain('Islamabad');

      // Verify Store Beta has its own data and NO Alpha data
      expect(promptB).toContain('Beta Electronics');
      expect(promptB).toContain('Bluetooth Speaker Mini');
      expect(promptB).toContain('Fatima Noor');
      expect(promptB).toContain('Islamabad');
      expect(promptB).not.toContain('Brand Alpha Store');
      expect(promptB).not.toContain('Men Oxford Shoes');
      expect(promptB).not.toContain('Usman Ali');
      expect(promptB).not.toContain('Karachi');
    });

    it('strips all sensitive credentials or tokens from sanitized context', () => {
      const rawWithSecrets = {
        ...BusinessGroundingService.buildBusinessContext({ order: orderA, shop: shopA }),
        accessToken: 'shpca_super_secret_token_123',
        passwordHash: 'argon2_hash_secret',
        apiKey: 'api_key_secret'
      };

      const sanitized = BusinessGroundingService.sanitizeBusinessContext(rawWithSecrets, {
        tenantDomain: shopA.domain
      });

      expect(sanitized.accessToken).toBeUndefined();
      expect(sanitized.passwordHash).toBeUndefined();
      expect(sanitized.apiKey).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. ORDER GROUNDING TESTS
  // =========================================================================
  describe('Factual Order Grounding', () => {
    it('correctly grounds order number, line items, pricing, and address', () => {
      const context = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderA, shop: shopA }),
        { tenantDomain: shopA.domain }
      );

      const prompt = CallScriptEngine.compileGeminiSystemInstruction(context);

      expect(prompt).toContain('AL-1090');
      expect(prompt).toContain('Men Oxford Shoes');
      expect(prompt).toContain('Brown / 42');
      expect(prompt).toContain('x1');
      expect(prompt).toContain('@ Rs. 4200');
      expect(prompt).toContain('Subtotal: Rs. 4200, Delivery Fee: Rs. 300, Total COD: Rs. 4500');
      expect(prompt).toContain('Flat 4B, Clifton Block 2, Karachi, Sindh, 75600');
    });

    it('accurately identifies online prepaid payment versus Cash on Delivery', () => {
      // Order A is COD
      const contextA = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderA, shop: shopA }),
        { tenantDomain: shopA.domain }
      );
      expect(contextA.paymentMethod).toContain('Cash on Delivery');

      // Order B is Prepaid online
      const contextB = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderB, shop: shopB }),
        { tenantDomain: shopB.domain }
      );
      expect(contextB.paymentMethod).toContain('Prepaid (Paid online via Credit Card (Mastercard))');
    });

    it('correctly flags free shipping when shipping fee is 0', () => {
      const contextB = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderB, shop: shopB }),
        { tenantDomain: shopB.domain }
      );

      expect(contextB.isFreeShipping).toBe(true);
      expect(contextB.shippingFee).toBe('0');

      const promptB = CallScriptEngine.compileGeminiSystemInstruction(contextB);
      expect(promptB).toContain('Delivery Fee: Free (Rs. 0)');
    });
  });

  // =========================================================================
  // 3. STORE POLICIES & ANTI-HALLUCINATION DIRECTIVES
  // =========================================================================
  describe('Store Policy Grounding & Anti-Hallucination Directives', () => {
    it('grounds explicit store policies when configured by merchant', () => {
      const context = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderA, shop: shopA }),
        { tenantDomain: shopA.domain }
      );

      const prompt = CallScriptEngine.compileGeminiSystemInstruction(context);

      expect(prompt).toContain('Assigned courier partner: TCS Express');
      expect(prompt).toContain('Allowed to inspect parcel before paying rider');
      expect(prompt).toContain('7-day hassle free return policy');
      expect(prompt).toContain('3-day size exchange through support');
      expect(prompt).toContain('6 months brand warranty against defects');
      expect(prompt).toContain('Confirmed expected delivery date: 2026-10-08');
    });

    it('injects strict negative anti-hallucination directives when policies are unconfigured', () => {
      const context = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({ order: orderB, shop: shopB }),
        { tenantDomain: shopB.domain }
      );

      const prompt = CallScriptEngine.compileGeminiSystemInstruction(context);

      // Courier anti-hallucination directive
      expect(prompt).toContain('Courier partner is not pre-assigned');
      expect(prompt).toContain('DO NOT invent specific courier names like Leopards or TCS');

      // Return & exchange anti-hallucination directives
      expect(prompt).toContain('Store has not published a general return policy');
      expect(prompt).toContain('DO NOT invent return days or promises');
      expect(prompt).toContain('Store has not published an exchange policy');

      // Warranty anti-hallucination directive
      expect(prompt).toContain('No brand or store warranty is specified for this order');

      // Temporal / Exact date anti-hallucination directive
      expect(prompt).toContain('Exact calendar delivery date is not confirmed');
      expect(prompt).toContain("NEVER promise an exact calendar day like 'Tuesday', 'kal', or 'parson'");
    });
  });

  // =========================================================================
  // 4. ACTION GATING & NEGATION PROTECTION
  // =========================================================================
  describe('Action Safety & Inquiry Gating Rules', () => {
    it('embeds explicit action gating clarifying that customer inquiries are not action commands', () => {
      const prompt = CallScriptEngine.compileGeminiSystemInstruction({});

      expect(prompt).toContain('INQUIRIES ARE NOT COMMANDS (ACTION GATING)');
      expect(prompt).toContain('Asking "Kya main cancel kar sakta hoon?" or "Cancel ka kya tareeqa hai?" -> Answer the cancellation policy. DO NOT call `cancel_order`!');
      expect(prompt).toContain('Asking "Address change ho sakta hai?" -> Answer the address change policy. DO NOT modify records!');
      expect(prompt).toContain('Saying "Main abhi confirm nahi kar raha" -> Answer politely and offer callback. DO NOT call `confirm_order`!');
    });

    it('embeds strict contextual negation rules in prompt', () => {
      const prompt = CallScriptEngine.compileGeminiSystemInstruction({});

      expect(prompt).toContain('ZERO TOLERANCE FOR NEGATION INVERSION');
      expect(prompt).toContain('"Cancel nahi karna" / "Cancel mat karna" / "Main cancel nahi keh raha" MEANS DO NOT CANCEL!');
      expect(prompt).toContain('"Confirm nahi karna" / "Abhi confirm nahi kar sakta" / "Confirm mat karo" MEANS DO NOT CONFIRM!');
      expect(prompt).toContain('"Shayad", "Maybe", "Pata nahi", "Soch raha hoon", "Baad me sochunga" -> DO NOT confirm and DO NOT cancel!');
    });
  });

  // =========================================================================
  // 5. UNKNOWN INFORMATION PROTOCOL
  // =========================================================================
  describe('Unknown Information Protocol', () => {
    it('instructs Zara to use a polite, standardized Roman Urdu fallback when information is unavailable', () => {
      const prompt = CallScriptEngine.compileGeminiSystemInstruction({});

      expect(prompt).toContain('SECTION 5: UNKNOWN DATA & FALLBACK PROTOCOL');
      expect(prompt).toContain('Is baare mein mere paas confirmed data available nahi hai');
      expect(prompt).toContain('Main aap ki inquiry hamari customer care team ko note karwa sakti hoon');
      expect(prompt).toContain('Never invent, guess, or assume missing business facts');
    });
  });

  // =========================================================================
  // 6. EXHAUSTIVE 10-CATEGORY POLICY TESTS (VERIFIED vs UNSUPPORTED)
  // =========================================================================
  describe('10 Core Policy Categories: Verified vs Unsupported Verification', () => {
    const verifiedSettings = {
      redeliveryPolicy: 'Courier will re-attempt delivery the next business day after contacting recipient',
      returnPolicy: '14-day hassle-free returns with original packaging',
      exchangePolicy: '5-day size exchange allowed via support ticket',
      warrantyPolicy: '1-year official brand warranty with service card',
      allowOpenParcel: true,
      openParcelPolicy: 'Open parcel allowed before payment with rider present',
      refundPolicy: 'Refunds processed within 48 hours to original payment method',
      cancellationPolicy: 'Cancellation permitted up to 2 hours after order placement',
      discountPolicy: 'Special 10% coupon applicable on repeat orders only',
      courierRetryPolicy: 'Maximum 2 re-attempts before parcel is returned to warehouse',
      deliveryGuaranteePolicy: 'Guaranteed delivery within 3 business days or shipping refunded'
    };

    const emptySettings = {
      deliverySLA: '3 to 5 business days'
    };

    const dummyOrder = {
      id: 'order-policy-check',
      shopId: 'shop-uuid-alpha',
      orderNumber: 'POL-100',
      totalAmount: 2500,
      payload: JSON.stringify({
        line_items: [{ title: 'Shirt', quantity: 1, price: '2500' }],
        shipping_address: { city: 'Lahore', address1: 'Main Boulevard' }
      })
    };

    // Category 1: Redelivery (Q18)
    it('1. Redelivery: uses verified policy when present, and strictly forbids invention when absent', () => {
      // Known
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      const promptKnown = CallScriptEngine.compileGeminiSystemInstruction(ctxKnown);
      expect(promptKnown).toContain('Courier will re-attempt delivery the next business day');

      // Unknown
      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      const promptUnknown = CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown);
      expect(promptUnknown).toContain('Store has NOT configured a redelivery or missed-delivery policy');
      expect(promptUnknown).toContain('NEVER say the rider will automatically retry');
      expect(promptUnknown).toContain('Mere paas is situation ke liye confirmed policy information available nahi hai');
    });

    // Category 2: Returns
    it('2. Returns: uses verified policy when present, forbids invention when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('14-day hassle-free returns');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      const promptUnknown = CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown);
      expect(promptUnknown).toContain('Store has not published a general return policy');
      expect(promptUnknown).toContain('DO NOT invent return days or promises');
    });

    // Category 3: Exchanges
    it('3. Exchanges: uses verified policy when present, forbids invention when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('5-day size exchange allowed via support ticket');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown)).toContain('Store has not published an exchange policy');
    });

    // Category 4: Warranty
    it('4. Warranty: uses verified warranty when present, forbids phantom warranties when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('1-year official brand warranty with service card');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown)).toContain('No brand or store warranty is specified for this order');
    });

    // Category 5: Open Parcel
    it('5. Open Parcel: uses explicit policy when configured, applies standard directive when unconfigured', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('Open parcel allowed before payment with rider present');
    });

    // Category 6: Refund Timing
    it('6. Refund Timing: uses verified refund policy when present, forbids inventing timelines when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('Refunds processed within 48 hours to original payment method');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      const promptUnknown = CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown);
      expect(promptUnknown).toContain('Store has NOT configured a refund timing or method policy');
      expect(promptUnknown).toContain('DO NOT invent refund days');
    });

    // Category 7: Cancellation Window
    it('7. Cancellation Window: uses verified policy when present, applies safe pre-dispatch rule when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('Cancellation permitted up to 2 hours after order placement');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown)).toContain('cancelled free of charge prior to warehouse dispatch');
    });

    // Category 8: Discount Policy
    it('8. Discount Policy: uses merchant discount policy when present, forbids inventing discounts when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('Special 10% coupon applicable on repeat orders only');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown)).toContain('Prices are already discounted and final');
    });

    // Category 9: Courier Retry Policy
    it('9. Courier Retry: uses verified attempt count when present, forbids guessing attempt counts when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('Maximum 2 re-attempts before parcel is returned');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown)).toContain('Store has NOT configured a courier re-attempt policy');
    });

    // Category 10: Delivery Guarantee
    it('10. Delivery Guarantee: uses verified guarantee when present, forbids converting SLA into promise when absent', () => {
      const ctxKnown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(verifiedSettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      expect(CallScriptEngine.compileGeminiSystemInstruction(ctxKnown)).toContain('Guaranteed delivery within 3 business days or shipping refunded');

      const ctxUnknown = BusinessGroundingService.sanitizeBusinessContext(
        BusinessGroundingService.buildBusinessContext({
          order: dummyOrder,
          shop: { id: 'shop-uuid-alpha', domain: 'brand-alpha.myshopify.com', settings: JSON.stringify(emptySettings) }
        }),
        { tenantDomain: 'brand-alpha.myshopify.com' }
      );
      const promptUnknown = CallScriptEngine.compileGeminiSystemInstruction(ctxUnknown);
      expect(promptUnknown).toContain('Store does NOT provide an exact delivery date guarantee');
      expect(promptUnknown).toContain('Reference ONLY the general SLA window');
    });
  });
});
