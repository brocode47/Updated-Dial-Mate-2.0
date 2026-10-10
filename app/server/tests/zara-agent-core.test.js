import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZaraAgentCore, ZARA_TOOL_DEFINITIONS } from '../src/services/zaraAgentCore.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { OrderResolver } from '../src/services/orderResolver.js';
import { HumanEscalationService } from '../src/services/humanEscalationService.js';

describe('ZaraAgentCore — Phase 2 Intelligent Conversational LLM Engine', () => {
  const mockShop = {
    id: 'shop-1',
    domain: 'sundaybazaaar.store',
    name: 'Sunday Bazaaar Official'
  };

  const mockCustomer = {
    id: 'cust-1',
    firstName: 'Zubair',
    phone: '+923001234567'
  };

  const mockProductChair = {
    id: 'prod-101',
    title: 'Wooden Silicone Chair Protection Cover',
    price: 'Rs. 499',
    formattedPrice: 'Rs. 499',
    numericPrice: 499,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/chair-cover',
    available: true,
    description: 'Silicone chair leg protector, 24 pieces pack.'
  };

  const mockProductSnoring = {
    id: 'prod-202',
    title: 'Anti Snoring Magnetic Nasal Dilator',
    price: 'Rs. 999',
    formattedPrice: 'Rs. 999',
    numericPrice: 999,
    deliveryCharge: 199,
    url: 'https://sundaybazaaar.store/products/snoring-dilator',
    available: true,
    description: 'Relieves snoring and improves breathing.'
  };

  const mockOrder1643 = {
    id: 'ord-1643',
    orderNumber: '1643',
    items: 'Wooden Silicone Chair Protection Cover',
    status: 'In Transit',
    totalAmount: 698,
    shippingFee: 199,
    customerPhone: '+923001234567',
    payload: {
      order_number: '1643',
      shipping_address: { phone: '+923001234567' }
    }
  };

  const mockOrderForeign = {
    id: 'ord-9999',
    orderNumber: '9999',
    items: 'Leather Belt',
    status: 'Delivered',
    totalAmount: 1499,
    customerPhone: '+923339999999',
    payload: {
      order_number: '9999',
      shipping_address: { phone: '+923339999999' }
    }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // =========================================================================
  // 1. PROTOCOL & MULTI-TURN HISTORY TESTS
  // =========================================================================

  it('correctly structures multi-turn history for Gemini contents protocol', () => {
    const rawTurns = [
      { role: 'user', text: 'Salam' },
      { role: 'assistant', text: 'Walaikum Assalam! Main Zara hoon.' },
      { role: 'user', text: 'Chair cover dikhao' }
    ];

    const formatted = ZaraAgentCore.formatHistory(rawTurns);
    expect(formatted).toHaveLength(3);
    expect(formatted[0].role).toBe('user');
    expect(formatted[0].parts[0].text).toBe('Salam');
    expect(formatted[1].role).toBe('model');
    expect(formatted[1].parts[0].text).toBe('Walaikum Assalam! Main Zara hoon.');
    expect(formatted[2].role).toBe('user');
    expect(formatted[2].parts[0].text).toBe('Chair cover dikhao');
  });

  it('coalesces consecutive same-role turns to enforce strict alternation', () => {
    const rawTurns = [
      { role: 'user', text: 'first question' },
      { role: 'user', text: 'second question' },
      { role: 'assistant', text: 'combined answer' }
    ];

    const formatted = ZaraAgentCore.formatHistory(rawTurns);
    expect(formatted).toHaveLength(2);
    expect(formatted[0].role).toBe('user');
    expect(formatted[0].parts[0].text).toContain('first question');
    expect(formatted[0].parts[0].text).toContain('second question');
    expect(formatted[1].role).toBe('model');
  });

  // =========================================================================
  // 2. CONVERSATIONAL TOOL LOOP TESTS (MOCK PROTOCOL BOUNDARY)
  // =========================================================================

  it('executes tool call and feeds tool response back to Gemini for grounded answer', async () => {
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      count: 1
    });

    // Mock Gemini protocol:
    // Round 1: Model requests tool call 'search_shopify_products'
    // Round 2: Model receives tool response and produces natural Roman Urdu answer
    const mockGenerateContent = vi.fn()
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'search_shopify_products',
                args: { query: 'chair protection cover' }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              text: 'Ji, hamare paas *Wooden Silicone Chair Protection Cover* available hai Rs. 499 mein.'
            }]
          }
        }]
      });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'chair protection cover dikhao',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.usedLLM).toBe(true);
    expect(result.replyText).toContain('Wooden Silicone Chair Protection Cover');
    expect(result.toolCallsExecuted).toEqual([
      { name: 'search_shopify_products', args: { query: 'chair protection cover' } }
    ]);
    expect(result.proposedStateUpdates.activeProduct.title).toBe(mockProductChair.title);

    // Verify tool feedback was sent to Gemini in second round
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    const secondCallPayload = mockGenerateContent.mock.calls[1][0];
    const userToolResponseTurn = secondCallPayload.contents.find(c =>
      c.parts?.some(p => p.functionResponse?.name === 'search_shopify_products')
    );
    expect(userToolResponseTurn).toBeDefined();
    expect(userToolResponseTurn.parts[0].functionResponse.response.output.products[0].title)
      .toBe(mockProductChair.title);
  });

  it('handles multiple sequential tool calls in a single turn (Search -> Delivery Quote)', async () => {
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
      products: [mockProductChair],
      count: 1
    });
    vi.spyOn(DeliveryService, 'getDeliveryQuote').mockResolvedValue({
      deliveryCharge: 199,
      estimatedDays: '3-4 working days'
    });

    const mockGenerateContent = vi.fn()
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'search_shopify_products',
                args: { query: 'chair cover' }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'get_delivery_quote',
                args: { city: 'Karachi', productPrice: 499 }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              text: 'Ji, chair cover Rs. 499 ka hai aur Karachi ke delivery charges Rs. 199 hain, kul total Rs. 698 banega.'
            }]
          }
        }]
      });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'chair cover aur Karachi delivery ke sath total batao',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.toolCallsExecuted).toHaveLength(2);
    expect(result.toolCallsExecuted[0].name).toBe('search_shopify_products');
    expect(result.toolCallsExecuted[1].name).toBe('get_delivery_quote');
    expect(result.replyText).toContain('698');
  });

  // =========================================================================
  // 3. CONTEXTUAL PRONOUN & CONTINUITY REASONING
  // =========================================================================

  it('maintains active product continuity and pronoun resolution via structured context', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            text: 'Ji, Wooden Silicone Chair Protection Cover ki price Rs. 499 hai.'
          }]
        }
      }]
    });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'iski price kya hai?',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      state: {
        activeProduct: mockProductChair
      },
      turns: [
        { role: 'user', text: 'chair protection cover dikhao' },
        { role: 'assistant', text: 'Ji yeh raha chair protection cover.' }
      ],
      aiClient: mockAiClient
    });

    expect(result.replyText).toContain('499');
    // Ensure active product was embedded in system instruction
    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(callConfig.systemInstruction).toContain('Wooden Silicone Chair Protection Cover');
    expect(callConfig.systemInstruction).toContain('Rs. 499');
  });

  // =========================================================================
  // 4. REJECTION MEMORY ENFORCEMENT
  // =========================================================================

  it('embeds rejected product suppression constraints into system instruction', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            text: 'Theek hai, koi baat nahi! Aap hamari website par doosri categories dekh saktay hain.'
          }]
        }
      }]
    });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    await ZaraAgentCore.handleTurn({
      messageText: 'kuch aur dikhao',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      state: {
        rejectedProducts: [mockProductChair]
      },
      aiClient: mockAiClient
    });

    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(callConfig.systemInstruction).toContain('REJECTED PRODUCTS');
    expect(callConfig.systemInstruction).toContain('Wooden Silicone Chair Protection Cover');
    expect(callConfig.systemInstruction).toContain('NEVER recommend or offer these items again');
  });

  // =========================================================================
  // 5. SECURITY & ORDER AUTHORIZATION ISOLATION
  // =========================================================================

  it('allows verified customer to retrieve their own order', async () => {
    vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValue({
      found: true,
      order: mockOrder1643
    });

    const mockGenerateContent = vi.fn()
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'resolve_order',
                args: { orderNumber: '1643' }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              text: 'Ji Zubair bhai, aapka order #1643 in transit hai.'
            }]
          }
        }]
      });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'mera order 1643 kahan pohcha?',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.replyText).toContain('1643');
    expect(result.proposedStateUpdates.activeOrder.orderNumber).toBe('1643');
  });

  it('blocks Customer A from accessing Customer B order (Authorization Isolation)', async () => {
    vi.spyOn(OrderResolver, 'resolveCustomerOrders').mockResolvedValue({
      found: false,
      unauthorized: true,
      error: 'Order ownership unverified. The order number does not match your registered phone number.'
    });

    const mockGenerateContent = vi.fn()
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'resolve_order',
                args: { orderNumber: '9999' }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              text: 'Maazrat, yeh order number aapke registered phone number se match nahi karta.'
            }]
          }
        }]
      });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    // Caller phone is +923001234567, trying to access order 9999 (owned by +923339999999)
    const result = await ZaraAgentCore.handleTurn({
      messageText: 'order 9999 ki details do',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.replyText).toContain('match nahi karta');
    // Ensure foreign order is NEVER saved into state
    expect(result.proposedStateUpdates.activeOrder).toBeUndefined();
  });

  // =========================================================================
  // 6. GENERAL & CASUAL CONVERSATION (NO UNWANTED PRODUCT PROMOTION)
  // =========================================================================

  it('answers casual remarks and emotional messages naturally without shopping push', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{
            text: 'Aray, pareshan mat hon! Sab theek ho jaye ga. Main aapki kya madad kar sakti hoon?'
          }]
        }
      }]
    });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'main aaj thora upset hun',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.usedLLM).toBe(true);
    expect(result.replyText).toContain('pareshan mat hon');
    expect(result.toolCallsExecuted).toHaveLength(0);
  });

  // =========================================================================
  // 7. TOOL FAILURES & TIMEOUT HANDLING
  // =========================================================================

  it('gracefully communicates tool failure to Gemini without fabricated data', async () => {
    vi.spyOn(ShopifyCatalogService, 'searchProducts').mockRejectedValue(new Error('Shopify API network timeout'));

    const mockGenerateContent = vi.fn()
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'search_shopify_products',
                args: { query: 'ice roller' }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              text: 'Maazrat, is waqt system se connect karne mein masla ho raha hai. Aap thori der baad check karein.'
            }]
          }
        }]
      });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'ice roller dikhao',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.usedLLM).toBe(true);
    expect(result.replyText).toContain('masla ho raha hai');
    // Second round must show tool failure to Gemini
    const secondCall = mockGenerateContent.mock.calls[1][0];
    const toolResp = secondCall.contents.find(c => c.parts?.some(p => p.functionResponse));
    expect(toolResp.parts[0].functionResponse.response.output.success).toBe(false);
  });

  // =========================================================================
  // 8. HUMAN ESCALATION DISPATCH
  // =========================================================================

  it('triggers human escalation tool when requested by customer', async () => {
    vi.spyOn(HumanEscalationService, 'escalateToHuman').mockResolvedValue({
      success: true,
      notificationSent: true
    });

    const mockGenerateContent = vi.fn()
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'request_human_transfer',
                args: { reason: 'Customer wants to talk to a human agent' }
              }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{
              text: 'Maine aapki request human support team ko forward kar di hai, woh jald aapse rabta karegi.'
            }]
          }
        }]
      });

    const mockAiClient = {
      models: { generateContent: mockGenerateContent }
    };

    const result = await ZaraAgentCore.handleTurn({
      messageText: 'mujhe kisi bande se baat karni hai',
      fromPhone: '+923001234567',
      shop: mockShop,
      customer: mockCustomer,
      aiClient: mockAiClient
    });

    expect(result.toolCallsExecuted[0].name).toBe('request_human_transfer');
    expect(result.proposedStateUpdates.humanEscalationRequested).toBe(true);
    expect(result.replyText).toContain('human support team ko forward kar di hai');
  });
});
