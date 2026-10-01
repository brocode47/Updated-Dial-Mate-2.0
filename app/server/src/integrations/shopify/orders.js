import { getShopifyClient } from './client.js';

/**
 * Resilient wrapper for Shopify API calls with exponential backoff for 429 Rate Limits.
 */
async function withRetry(shopDomain, operation, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const client = await getShopifyClient(shopDomain);
      return await operation(client);
    } catch (error) {
      if (error.response?.code === 429 && attempt < maxRetries - 1) {
        const retryAfter = error.response.headers?.['retry-after'] || 2;
        console.warn(`⏳ [Rate Limit] Shopify API rate limit hit for ${shopDomain}. Retrying in ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        attempt++;
        continue;
      }
      throw error;
    }
  }
}

export async function fetchOrderDetails(shopDomain, orderId) {
  const response = await withRetry(shopDomain, (client) =>
    client.get({ path: `orders/${orderId}` })
  );
  return response.body.order;
}

export async function fetchOrderByNumber(shopDomain, orderNumber) {
  // Try to find the order by name/number
  const response = await withRetry(shopDomain, (client) =>
    client.get({ path: 'orders', query: { name: orderNumber, status: 'any' } })
  );
  const orders = response.body.orders || [];
  return orders[0] || null;
}

export async function fetchCustomerDetails(shopDomain, customerId) {
  const response = await withRetry(shopDomain, (client) =>
    client.get({ path: `customers/${customerId}` })
  );
  return response.body.customer;
}

export async function fetchRecentOrders(shopDomain, limit = 50) {
  const response = await withRetry(shopDomain, (client) =>
    client.get({ path: 'orders', query: { status: 'any', limit } })
  );
  return response.body.orders;
}

export async function updateOrderNote(shopDomain, orderId, note) {
  const response = await withRetry(shopDomain, (client) =>
    client.put({
      path: `orders/${orderId}`,
      data: { order: { id: orderId, note } },
      type: 'application/json',
    })
  );
  return response.body.order;
}

export async function addOrderTag(shopDomain, orderId, tag) {
  try {
    const order = await fetchOrderDetails(shopDomain, orderId);
    const existingTags = order.tags ? order.tags.split(',').map((t) => t.trim()) : [];
    if (existingTags.includes(tag)) return order;
    
    existingTags.push(tag);
    const response = await withRetry(shopDomain, (client) =>
      client.put({
        path: `orders/${orderId}`,
        data: { order: { id: orderId, tags: existingTags.join(', ') } },
        type: 'application/json',
      })
    );
    return response.body.order;
  } catch (err) {
    console.warn(`⚠️ [Shopify:addOrderTag] Notice for order ${orderId}: ${err.message}`);
    return null;
  }
}

export async function removeOrderTag(shopDomain, orderId, tag) {
  const order = await fetchOrderDetails(shopDomain, orderId);
  const existingTags = order.tags ? order.tags.split(',').map((t) => t.trim()) : [];
  const filteredTags = existingTags.filter(t => t !== tag);
  
  if (existingTags.length === filteredTags.length) return order; // Tag wasn't there
  
  const response = await withRetry(shopDomain, (client) =>
    client.put({
      path: `orders/${orderId}`,
      data: { order: { id: orderId, tags: filteredTags.join(', ') } },
      type: 'application/json',
    })
  );
  return response.body.order;
}

export async function cancelOrder(shopDomain, orderId, reason = 'customer') {
  // Shopify allows cancellation with a POST to /admin/api/2024-01/orders/{order_id}/cancel.json
  const response = await withRetry(shopDomain, (client) =>
    client.post({
      path: `orders/${orderId}/cancel`,
      data: { reason }, // e.g. 'customer', 'inventory', 'fraud', 'declined', 'other'
      type: 'application/json',
    })
  );
  return response.body.order;
}
