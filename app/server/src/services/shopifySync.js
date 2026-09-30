import { prisma } from '../lib/db.js';
import { computeRiskScore } from '../lib/risk.js';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

/**
 * Fetch data directly from Shopify REST Admin API using shop domain and access token.
 */
async function fetchShopifyApi(shopDomain, accessToken, endpoint) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/${endpoint}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error [${response.status}] on ${endpoint}: ${errorText}`);
  }

  return response.json();
}

/**
 * Sync real Orders, Customers, and Products from Shopify into the database.
 * @param {string} shopDomain - The .myshopify.com domain of the store
 */
export async function syncShopifyData(shopDomain) {
  console.log(`🔄 [ShopifySync] Starting data sync for: ${shopDomain}`);

  const shopRecord = await prisma.shop.findUnique({
    where: { domain: shopDomain }
  });

  if (!shopRecord) {
    throw new Error(`Shop record not found for domain: ${shopDomain}`);
  }

  const accessToken = shopRecord.accessToken || process.env.SHOPIFY_API_SECRET;
  if (!accessToken) {
    throw new Error(`No access token available for shop: ${shopDomain}`);
  }

  const results = {
    ordersSynced: 0,
    customersSynced: 0,
    productsSynced: 0,
    errors: []
  };

  // 1. Sync Customers
  try {
    const customersData = await fetchShopifyApi(shopDomain, accessToken, 'customers.json?limit=50');
    const customers = customersData.customers || [];
    console.log(`👤 [ShopifySync] Fetched ${customers.length} customers from Shopify`);

    for (const c of customers) {
      const shopifyId = String(c.id);
      const phone = c.phone || c.default_address?.phone || null;
      const email = c.email || null;
      const firstName = c.first_name || '';
      const lastName = c.last_name || '';

      const existing = await prisma.customer.findFirst({
        where: {
          shopId: shopRecord.id,
          shopifyId
        }
      });

      if (existing) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: { firstName, lastName, email, phone }
        });
      } else {
        await prisma.customer.create({
          data: {
            shopId: shopRecord.id,
            shopifyId,
            firstName,
            lastName,
            email,
            phone
          }
        });
      }
      results.customersSynced++;
    }
  } catch (err) {
    console.error(`⚠️ [ShopifySync] Customer sync error:`, err.message);
    results.errors.push(`Customers: ${err.message}`);
  }

  // 2. Sync Products
  try {
    const productsData = await fetchShopifyApi(shopDomain, accessToken, 'products.json?limit=50');
    const products = productsData.products || [];
    console.log(`🛍️ [ShopifySync] Fetched ${products.length} products from Shopify`);

    for (const p of products) {
      const name = p.title;
      const description = p.body_html || '';
      const category = p.product_type || 'General';
      const firstVariant = p.variants?.[0];
      const price = parseFloat(firstVariant?.price || 0);
      const stock = (p.variants || []).reduce((acc, v) => acc + (Number(v.inventory_quantity) || 0), 0);
      const variants = JSON.stringify(p.variants || []);
      const images = JSON.stringify((p.images || []).map(img => img.src));

      const existing = await prisma.product.findFirst({
        where: {
          shopId: shopRecord.id,
          name
        }
      });

      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            description,
            category,
            price,
            stock,
            variants,
            images
          }
        });
      } else {
        await prisma.product.create({
          data: {
            shopId: shopRecord.id,
            name,
            description,
            category,
            price,
            stock,
            currency: 'PKR',
            variants,
            images
          }
        });
      }
      results.productsSynced++;
    }
  } catch (err) {
    console.error(`⚠️ [ShopifySync] Product sync error:`, err.message);
    results.errors.push(`Products: ${err.message}`);
  }

  // 3. Sync Orders
  try {
    const ordersData = await fetchShopifyApi(shopDomain, accessToken, 'orders.json?status=any&limit=50');
    const orders = ordersData.orders || [];
    console.log(`📦 [ShopifySync] Fetched ${orders.length} orders from Shopify`);

    for (const o of orders) {
      const orderId = String(o.name || o.id);
      const shopifyOrderGid = o.admin_graphql_api_id || `gid://shopify/Order/${o.id}`;
      const orderNumber = String(o.order_number || o.name || '');
      const totalAmount = parseFloat(o.current_total_price || o.total_price || 0);
      const riskScore = computeRiskScore(o);

      let status = 'Pending Confirmation';
      if (o.cancelled_at) {
        status = 'Cancelled';
      } else if (o.financial_status === 'paid' || o.fulfillment_status === 'fulfilled') {
        status = 'Confirmed';
      }

      // Match or find customer
      let customerId = null;
      if (o.customer?.id) {
        const foundCustomer = await prisma.customer.findFirst({
          where: {
            shopId: shopRecord.id,
            shopifyId: String(o.customer.id)
          }
        });
        if (foundCustomer) {
          customerId = foundCustomer.id;
        }
      }

      await prisma.order.upsert({
        where: { id: orderId },
        update: {
          shopId: shopRecord.id,
          customerId,
          shopifyOrderGid,
          orderNumber,
          payload: JSON.stringify(o),
          status,
          totalAmount,
          riskScore
        },
        create: {
          id: orderId,
          shopId: shopRecord.id,
          customerId,
          shopifyOrderGid,
          orderNumber,
          payload: JSON.stringify(o),
          status,
          tag: 'Shopify Sync',
          riskScore,
          totalAmount,
          createdAt: o.created_at ? new Date(o.created_at) : new Date()
        }
      });

      results.ordersSynced++;
    }
  } catch (err) {
    console.error(`⚠️ [ShopifySync] Order sync error:`, err.message);
    results.errors.push(`Orders: ${err.message}`);
  }

  // Log compliance event
  await prisma.complianceLog.create({
    data: {
      shopDomain,
      event: 'Shopify initial sync completed',
      detail: `Synced ${results.ordersSynced} orders, ${results.customersSynced} customers, ${results.productsSynced} products`
    }
  });

  console.log(`✅ [ShopifySync] Sync completed for ${shopDomain}:`, results);
  return results;
}
