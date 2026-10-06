import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { PhoneNormalizer } from '../src/services/phoneNormalizer.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';
import * as aiClientModule from '../src/integrations/ai/client.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';

describe('Dial Mate 2.0 — Conversational Shopify Agent & Multi-Tenant Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ShopifyCatalogService.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ROBUST PHONE NORMALIZATION & TENANT ISOLATION
  // =========================================================================
  describe('Requirement 1: Phone Normalization & Tenant-Scoped Customer Resolution', () => {
    it('normalizes all standard Pakistani phone variations to canonical E.164 and digits', () => {
      const inputs = [
        '+923333255998',
        '923333255998',
        '03333255998',
        '0333-3255998',
        '+92 333 3255998',
        '923333255998@s.whatsapp.net'
      ];

      for (const input of inputs) {
        const norm = PhoneNormalizer.normalize(input);
        expect(norm).not.toBeNull();
        expect(norm.e164).toBe('+923333255998');
        expect(norm.digits).toBe('923333255998');
        expect(norm.local).toBe('03333255998');
        expect(norm.last10).toBe('3333255998');
      }
    });

    it('generates multi-variant search list for robust database lookups', () => {
      const variants = PhoneNormalizer.getSearchVariants('0333-3255998');
      expect(variants).toContain('+923333255998');
      expect(variants).toContain('923333255998');
      expect(variants).toContain('03333255998');
      expect(variants).toContain('3333255998');
    });

    it('resolves the same customer regardless of incoming formatting', async () => {
      const mockCustomer = { id: 'cust-123', shopId: 'shop-sunday', phone: '+923333255998' };
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(mockCustomer);

      const res1 = await PhoneNormalizer.resolveCustomer('shop-sunday', '03333255998');
      const res2 = await PhoneNormalizer.resolveCustomer('shop-sunday', '+92 333 3255998');
      const res3 = await PhoneNormalizer.resolveCustomer('shop-sunday', '923333255998@s.whatsapp.net');

      expect(res1.id).toBe('cust-123');
      expect(res2.id).toBe('cust-123');
      expect(res3.id).toBe('cust-123');
    });

    it('strictly enforces tenant isolation: same phone under shop A and shop B are separate customers', async () => {
      const findFirstSpy = vi.spyOn(prisma.customer, 'findFirst').mockImplementation(async ({ where }) => {
        if (where.shopId === 'shop-a') {
          return { id: 'cust-shop-a', shopId: 'shop-a', phone: '+923333255998' };
        }
        if (where.shopId === 'shop-b') {
          return { id: 'cust-shop-b', shopId: 'shop-b', phone: '+923333255998' };
        }
        return null;
      });

      const custA = await PhoneNormalizer.resolveCustomer('shop-a', '03333255998');
      const custB = await PhoneNormalizer.resolveCustomer('shop-b', '03333255998');

      expect(custA.id).toBe('cust-shop-a');
      expect(custA.shopId).toBe('shop-a');
      expect(custB.id).toBe('cust-shop-b');
      expect(custB.shopId).toBe('shop-b');
      expect(custA.id).not.toBe(custB.id);
    });
  });

  // =========================================================================
  // 2. ORDER RESOLUTION
  // =========================================================================
  describe('Requirement 2: Order Resolution & Multi-Order Handling', () => {
    it('resolves active order when phone number in payload matches a local variation (e.g. 03333255998)', async () => {
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({
        id: 'ord-1643',
        orderNumber: '1643',
        status: 'Pending Confirmation',
        totalAmount: 499,
        payload: JSON.stringify({
          order_number: 1643,
          line_items: [{ title: '1 PC Self Adhesive Wall Max' }],
          customer: { phone: '03333255998' }
        })
      });

      const orders = await PhoneNormalizer.resolveOrders('shop-sunday', 'cust-123', '+923333255998');
      expect(orders).toHaveLength(1);
      expect(orders[0].orderNumber).toBe('1643');
      expect(orders[0].items).toBe('1 PC Self Adhesive Wall Max');
      expect(orders[0].totalAmount).toBe(499);
    });

    it('answers single order directly when customer asks "mera order kya hai?"', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({
        id: 'ord-1643',
        orderNumber: '1643',
        status: 'Pending Confirmation',
        totalAmount: 499,
        payload: JSON.stringify({
          line_items: [{ title: '1 PC Self Adhesive Wall Max' }]
        })
      });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'mera order kya hai?'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('order_summary_fastpath');
      expect(result.replyText).toContain('#1643');
      expect(result.replyText).toContain('1 PC Self Adhesive Wall Max');
      expect(result.replyText).toContain('Rs. 499');
      expect(result.replyText).not.toContain('Aapka koi active order nahi hai');
    });

    it('prompts customer to specify when multiple relevant orders exist', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      
      // Spy on PhoneNormalizer.resolveOrders returning 2 orders
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([
        {
          orderId: 'ord-1643',
          orderNumber: '1643',
          status: 'Pending Confirmation',
          totalAmount: 499,
          items: '1 PC Self Adhesive Wall Max'
        },
        {
          orderId: 'ord-1640',
          orderNumber: '1640',
          status: 'Delivered',
          totalAmount: 1200,
          items: 'Kitchen Shelf Organizer'
        }
      ]);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'mera order kya hai?'
      });

      expect(result.success).toBe(true);
      expect(result.replyText).toContain('Aapke 2 orders record mein hain');
      expect(result.replyText).toContain('#1643');
      expect(result.replyText).toContain('#1640');
      expect(result.replyText).toContain('Aap kis order ke baare mein maloomat chahtay hain?');
    });

    it('politely asks for order number when no relevant order is found, never falsely saying inactive if not found', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-new', phone: '+923000000000' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([]);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923000000000',
        messageText: 'mera order kya hai?'
      });

      expect(result.success).toBe(true);
      expect(result.replyText).toContain('Mujhe aapke number se koi order nahi mila');
      expect(result.replyText).toContain('order number (jaise #1643) share kar saktay hain');
    });
  });

  // =========================================================================
  // 3. SHOPIFY PRICE HANDLING & ZERO-NaN GUARANTEE
  // =========================================================================
  describe('Requirement 3: Shopify Price Handling & Zero-NaN Guarantee', () => {
    it('normalizes Shopify raw string prices to valid numbers and formatted strings', async () => {
      vi.spyOn(prisma.product, 'findMany').mockResolvedValue([
        {
          id: 'prod-wall-max',
          name: '1 PC Self Adhesive Wall Max',
          description: 'Strong adhesive hook for wall',
          price: 499,
          stock: 50,
          category: 'Hardware',
          variants: JSON.stringify([{ price: '499.00', inventory_quantity: 50 }])
        }
      ]);

      const result = await ShopifyCatalogService.searchProducts('test.myshopify.com', 'wall max');
      expect(result.success).toBe(true);
      expect(result.products).toHaveLength(1);
      const p = result.products[0];

      // Numeric guarantee
      expect(typeof p.numericPrice).toBe('number');
      expect(p.numericPrice).toBe(499);
      expect(Number.isFinite(p.numericPrice)).toBe(true);
      expect(isNaN(p.numericPrice)).toBe(false);

      // Formatted price guarantee
      expect(p.formattedPrice).toBe('Rs. 499');
    });

    it('regression test: reproduces previous Number("Rs. 499.00") failure and proves permanent prevention', () => {
      // The bug that caused Rs. NaN in live chat:
      const badAttempt = Number("Rs. 499.00");
      expect(isNaN(badAttempt)).toBe(true); // Demonstrates the historical failure

      // Permanent safe parsing in dialmate:
      const rawPrice = "Rs. 499.00";
      const cleanDigits = rawPrice.replace(/,/g, '').match(/\d+(?:\.\d+)?/)[0];
      const safeParsed = parseFloat(cleanDigits);
      expect(safeParsed).toBe(499);
      expect(Number.isFinite(safeParsed)).toBe(true);

      // Sanitizer eliminates any accidental NaN from ever reaching customer
      const sanitized = WhatsAppAgentService.sanitizeResponse("Product price is Rs. NaN");
      expect(sanitized).not.toContain('NaN');
      expect(sanitized).toContain('Price on request');
    });

    it('handles products with missing or zero price without NaN', async () => {
      vi.spyOn(prisma.product, 'findMany').mockResolvedValue([
        {
          id: 'prod-free',
          name: 'Sample Tester',
          description: 'Sample item',
          price: 0,
          stock: 10,
          category: 'Samples',
          variants: JSON.stringify([{ price: null, inventory_quantity: 10 }])
        }
      ]);

      const result = await ShopifyCatalogService.searchProducts('test.myshopify.com', 'sample');
      expect(result.products[0].formattedPrice).toBe('Price on request');
      expect(result.products[0].formattedPrice).not.toContain('NaN');
    });
  });

  // =========================================================================
  // 4 & 5. REAL CATALOG SEARCH & PAGINATION (NO 3-PRODUCT LIMIT)
  // =========================================================================
  describe('Requirements 4 & 5: Full Catalog Search & Pagination (183 Products)', () => {
    it('searches across full catalog and returns a manageable page of 5 products with total count', async () => {
      // Mock catalog of 20 products
      const mockCatalog = Array.from({ length: 20 }, (_, i) => ({
        id: `prod-${i + 1}`,
        name: `Product ${i + 1} Household Item`,
        description: `Description for item ${i + 1}`,
        price: 500 + i * 50,
        stock: 10,
        category: 'Home',
        variants: JSON.stringify([{ price: String(500 + i * 50), inventory_quantity: 10 }])
      }));
      vi.spyOn(prisma.product, 'findMany').mockResolvedValue(mockCatalog);

      const page1 = await ShopifyCatalogService.searchProducts('sundaybazaaar.store', 'household', { page: 1, limit: 5 });
      expect(page1.totalFound).toBe(20);
      expect(page1.count).toBe(5);
      expect(page1.products).toHaveLength(5);
      expect(page1.products[0].title).toBe('Product 1 Household Item');
      expect(page1.page).toBe(1);
      expect(page1.totalPages).toBe(4);

      const page2 = await ShopifyCatalogService.searchProducts('sundaybazaaar.store', 'household', { page: 2, limit: 5 });
      expect(page2.count).toBe(5);
      expect(page2.products[0].title).toBe('Product 6 Household Item');
      expect(page2.page).toBe(2);
    });

    it('prioritizes exact and strong title matches over loose token matches', async () => {
      vi.spyOn(prisma.product, 'findMany').mockResolvedValue([
        {
          id: 'prod-loose',
          name: 'Super Glue Adhesive Bottle',
          description: 'A generic adhesive product',
          price: 250,
          stock: 10,
          category: 'Tools',
          variants: null
        },
        {
          id: 'prod-exact',
          name: '1 PC Self Adhesive Wall Max',
          description: 'Multipurpose heavy duty wall hook',
          price: 499,
          stock: 20,
          category: 'Hardware',
          variants: null
        }
      ]);

      const result = await ShopifyCatalogService.searchProducts('sundaybazaaar.store', 'adhesive wall max');
      expect(result.products).toHaveLength(2);
      expect(result.products[0].title).toBe('1 PC Self Adhesive Wall Max'); // Exact multi-keyword match ranks first
    });
  });

  // =========================================================================
  // 6, 7 & 8. PRODUCT DETAILS, STORE & COLLECTION TOOLS
  // =========================================================================
  describe('Requirements 6, 7 & 8: get_shopify_product_details, Storefront URLs & Collections', () => {
    it('get_shopify_product_details tool returns authoritative title, price, inStock and storefront URL', async () => {
      vi.spyOn(prisma.product, 'findMany').mockResolvedValue([
        {
          id: 'prod-wall-max-1',
          name: '1 PC Self Adhesive Wall Max',
          description: 'Heavy duty adhesive wall hook',
          price: 499,
          stock: 25,
          category: 'Hardware',
          variants: JSON.stringify([{ price: '499.00', inventory_quantity: 25 }])
        }
      ]);

      const details = await ToolDispatcher.dispatch('get_shopify_product_details', {
        query: 'adhesive wall max'
      }, { shopDomain: 'sundaybazaaar.store' });

      expect(details.success).toBe(true);
      expect(details.product.title).toBe('1 PC Self Adhesive Wall Max');
      expect(details.product.formattedPrice).toBe('Rs. 499');
      expect(details.product.available).toBe(true);
      expect(details.product.url).toContain('https://sundaybazaaar.store/products/');
      expect(details.product.url).not.toContain('admin');
      expect(details.product.url).not.toContain('myshopify.com');
    });

    it('get_shopify_collections returns real storefront collection links', async () => {
      const res = await ToolDispatcher.dispatch('get_shopify_collections', {}, { shopDomain: 'sundaybazaaar.store' });
      expect(res.success).toBe(true);
      expect(res.collections.length).toBeGreaterThan(0);
      const kitchen = res.collections.find(c => c.handle === 'kitchen-collections');
      expect(kitchen).toBeDefined();
      expect(kitchen.url).toBe('https://sundaybazaaar.store/collections/kitchen-collections');
    });

    it('get_store_info returns official storefront and catalog URLs', async () => {
      const res = await ToolDispatcher.dispatch('get_store_info', {}, { shopDomain: 'sundaybazaaar.store' });
      expect(res.success).toBe(true);
      expect(res.storefrontUrl).toBe('https://sundaybazaaar.store');
      expect(res.catalogUrl).toBe('https://sundaybazaaar.store/collections/all-products');
    });
  });

  // =========================================================================
  // 9, 10 & 11. CONVERSATIONAL STATE, ORDINAL REFERENCES & "AUR DIKHAO"
  // =========================================================================
  describe('Requirements 9, 10 & 11: Conversational Memory, Ordinal References & "Aur Dikhao"', () => {
    it('maintains structured conversational state per conversation', async () => {
      const convId = 'conv-test-state-1';
      const mockProducts = [
        { title: '1 PC Self Adhesive Wall Max', formattedPrice: 'Rs. 499', url: 'https://sundaybazaaar.store/products/wall-max', available: true },
        { title: 'Chair Protection Cover', formattedPrice: 'Rs. 1500', url: 'https://sundaybazaaar.store/products/chair-cover', available: true }
      ];

      await ConversationStateService.updateState(convId, {
        lastProducts: mockProducts,
        currentPage: 1,
        totalFound: 10,
        lastQuery: 'wall max'
      });

      const state = await ConversationStateService.getState(convId);
      expect(state.currentPage).toBe(1);
      expect(state.lastProducts).toHaveLength(2);
      expect(state.lastQuery).toBe('wall max');
    });

    it('resolves Roman Urdu ordinal references ("pehle wale", "doosre wale", "iska price")', async () => {
      const convId = 'conv-test-state-2';
      const mockProducts = [
        { title: '1 PC Self Adhesive Wall Max', formattedPrice: 'Rs. 499', url: 'https://sundaybazaaar.store/products/wall-max', available: true },
        { title: 'Kitchen Storage Rack', formattedPrice: 'Rs. 1200', url: 'https://sundaybazaaar.store/products/kitchen-rack', available: true },
        { title: 'Velvet Sofa Cover', formattedPrice: 'Rs. 2500', url: 'https://sundaybazaaar.store/products/sofa-cover', available: true }
      ];

      await ConversationStateService.updateState(convId, {
        lastProducts: mockProducts,
        currentPage: 1
      });

      // Test "pehle wale" (1st product)
      const first = await ConversationStateService.resolveProductReference(convId, 'pehle wale ki price batao');
      expect(first.title).toBe('1 PC Self Adhesive Wall Max');

      // Test "doosre wale ka link" (2nd product)
      const second = await ConversationStateService.resolveProductReference(convId, 'doosre wale ka link bhejo');
      expect(second.title).toBe('Kitchen Storage Rack');

      // Test "teesra wala" (3rd product)
      const third = await ConversationStateService.resolveProductReference(convId, 'teesre wale ka stock');
      expect(third.title).toBe('Velvet Sofa Cover');

      // Test pronoun "iska price"
      const pronoun = await ConversationStateService.resolveProductReference(convId, 'iska price kya hai?');
      expect(pronoun.title).toBe('Velvet Sofa Cover'); // Resolves most recently referenced
    });

    it('handles "aur dikhao" by advancing pagination from saved conversational state', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-more-1', isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([]);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      // Set initial page 1 state
      await ConversationStateService.updateState('conv-more-1', {
        currentPage: 1,
        lastQuery: 'items',
        totalFound: 10
      });

      // Mock searchProducts page 2 returning next 5 products
      vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
        success: true,
        query: 'items',
        page: 2,
        limit: 5,
        totalFound: 10,
        count: 2,
        totalPages: 2,
        storefrontDomain: 'sundaybazaaar.store',
        allProductsUrl: 'https://sundaybazaaar.store/collections/all-products',
        products: [
          { title: 'Item 6 Hook', formattedPrice: 'Rs. 300', url: 'https://sundaybazaaar.store/products/hook' },
          { title: 'Item 7 Mat', formattedPrice: 'Rs. 600', url: 'https://sundaybazaaar.store/products/mat' }
        ]
      });

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'aur dikhao'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('catalog_pagination_more');
      expect(result.replyText).toContain('Item 6 Hook');
      expect(result.replyText).toContain('Item 7 Mat');
      expect(result.replyText).toContain('https://sundaybazaaar.store/collections/all-products');
    });

    it('notifies customer naturally when "aur dikhao" reaches end of catalog', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-more-end', isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([]);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      await ConversationStateService.updateState('conv-more-end', {
        currentPage: 2,
        lastQuery: 'special',
        totalFound: 10
      });

      // Page 3 has 0 products
      vi.spyOn(ShopifyCatalogService, 'searchProducts').mockResolvedValue({
        success: true,
        query: 'special',
        page: 3,
        limit: 5,
        totalFound: 10,
        count: 0,
        totalPages: 2,
        storefrontDomain: 'sundaybazaaar.store',
        allProductsUrl: 'https://sundaybazaaar.store/collections/all-products',
        products: []
      });

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'aur dikhao'
      });

      expect(result.success).toBe(true);
      expect(result.replyText).toContain('Is category mein mazeed items nahi hain');
      expect(result.replyText).toContain('https://sundaybazaaar.store/collections/all-products');
    });
  });

  // =========================================================================
  // 12, 13 & 14. INTENTS, GEMINI TOOL LOOP & DIRECT NATURAL ANSWERS
  // =========================================================================
  describe('Requirements 12, 13 & 14: Intent Separation & Direct Product Answers', () => {
    it('distinguishes distinct customer intents accurately', () => {
      expect(WhatsAppAgentService.detectIntent('catalog dikhao').intent).toBe('CATALOG');
      expect(WhatsAppAgentService.detectIntent('chair protection cover hai?').intent).toBe('PRODUCT_INQUIRY');
      expect(WhatsAppAgentService.detectIntent('adhesive wall max ki price batao?').intent).toBe('PRODUCT_DETAIL');
      expect(WhatsAppAgentService.detectIntent('aur dikhao').intent).toBe('MORE');
      expect(WhatsAppAgentService.detectIntent('pehle wale ka link').intent).toBe('ORDINAL_REFERENCE');
      expect(WhatsAppAgentService.detectIntent('kitchen collection dikhao').intent).toBe('COLLECTION');
      expect(WhatsAppAgentService.detectIntent('website ka link do').intent).toBe('STORE_LINK');
      expect(WhatsAppAgentService.detectIntent('mera order confirm kar do').intent).toBe('CONFIRM');
      expect(WhatsAppAgentService.detectIntent('order cancel kardo').intent).toBe('CANCEL');
      expect(WhatsAppAgentService.detectIntent('asli insan se baat karni hai').intent).toBe('HUMAN_TRANSFER');
    });

    it('answers price directly when customer asks for a product price', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      const convId = 'conv-price-query';
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: convId, isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([]);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      // Seed state with the product
      await ConversationStateService.updateState(convId, {
        lastProducts: [
          {
            title: '1 PC Self Adhesive Wall Max',
            formattedPrice: 'Rs. 499',
            url: 'https://sundaybazaaar.store/products/1-pc-self-adhesive-wall-max',
            available: true
          }
        ]
      });

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'pehle wale ki price kya hai?'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('ordinal_reference_resolution');
      expect(result.replyText).toContain('1 PC Self Adhesive Wall Max');
      expect(result.replyText).toContain('Rs. 499');
      expect(result.replyText).toContain('https://sundaybazaaar.store/products/1-pc-self-adhesive-wall-max');
      expect(result.replyText).not.toContain('Hamare paas yeh products available hain');
    });
  });

  // =========================================================================
  // 17 & 18. SAFETY: CONFIRM, CANCEL, NEGATION & HUMAN ESCALATION
  // =========================================================================
  describe('Requirements 17 & 18: Confirm/Cancel Safety, Negation & Human Escalation', () => {
    it('protects against confirmation negation ("confirm nahi karna")', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-safe-1', isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([{
        orderId: 'ord-1643',
        orderNumber: '1643',
        status: 'Pending Confirmation',
        totalAmount: 499,
        items: '1 PC Self Adhesive Wall Max'
      }]);
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'confirm nahi karna'
      });

      expect(result.success).toBe(true);
      expect(dispatchSpy).not.toHaveBeenCalledWith('confirm_order', expect.anything(), expect.anything());
      expect(result.replyText).toContain('Aapka order confirm nahi kiya gaya hai');
    });

    it('protects against cancellation negation ("cancel mat karna")', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-safe-2', isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([{
        orderId: 'ord-1643',
        orderNumber: '1643',
        status: 'Pending Confirmation',
        totalAmount: 499,
        items: '1 PC Self Adhesive Wall Max'
      }]);
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch');
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'cancel mat karna'
      });

      expect(result.success).toBe(true);
      expect(dispatchSpy).not.toHaveBeenCalledWith('cancel_order', expect.anything(), expect.anything());
      expect(result.replyText).toContain('aapka order cancel nahi kiya gaya');
    });

    it('notifies human support on escalation without terminating conversation, but respects manual takeover', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({ id: 'shop-1', domain: 'sundaybazaaar.store' });
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'cust-1', phone: '+923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-esc', isTakeover: false, messages: [] });
      vi.spyOn(PhoneNormalizer, 'resolveOrders').mockResolvedValue([]);
      const updateConvSpy = vi.spyOn(prisma.conversation, 'update').mockResolvedValue({});
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true, transferred: true });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      const result = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'mujhe real person se baat karni hai'
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('request_human_transfer');
      expect(dispatchSpy).toHaveBeenCalled();
      // Human escalation is an event, NOT a terminal isTakeover lock
      expect(updateConvSpy).not.toHaveBeenCalledWith({
        where: { id: 'conv-esc' },
        data: { isTakeover: true }
      });

      // Subsequent message while manual takeover is true
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-esc', isTakeover: true, messages: [] });
      const subsequentResult = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '+923333255998',
        messageText: 'kya koi hai?'
      });

      expect(subsequentResult.handledByHuman).toBe(true);
      expect(subsequentResult.replyText).toBeUndefined(); // AI is completely silent!
    });
  });
});
