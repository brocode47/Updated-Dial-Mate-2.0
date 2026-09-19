import { getShopifyClient } from './client.js';

export async function fetchOrderDetails(shopDomain, orderId) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: `orders/${orderId}`,
  });
  return response.body.order;
}

export async function fetchRecentOrders(shopDomain, limit = 50) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: 'orders',
    query: {
      status: 'any',
      limit,
    },
  });
  return response.body.orders;
}

export async function updateOrderNote(shopDomain, orderId, note) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.put({
    path: `orders/${orderId}`,
    data: {
      order: {
        id: orderId,
        note,
      },
    },
    type: 'application/json',
  });
  return response.body.order;
}

export async function addOrderTag(shopDomain, orderId, tag) {
  const order = await fetchOrderDetails(shopDomain, orderId);
  const existingTags = order.tags ? order.tags.split(',').map((t) => t.trim()) : [];
  if (existingTags.includes(tag)) {
    return order;
  }
  
  existingTags.push(tag);
  
  const client = await getShopifyClient(shopDomain);
  const response = await client.put({
    path: `orders/${orderId}`,
    data: {
      order: {
        id: orderId,
        tags: existingTags.join(', '),
      },
    },
    type: 'application/json',
  });
  return response.body.order;
}
