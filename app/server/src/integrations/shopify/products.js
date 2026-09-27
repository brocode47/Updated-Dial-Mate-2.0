import { getShopifyClient } from './client.js';

export async function fetchProducts(shopDomain, limit = 50) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: 'products',
    query: {
      limit,
    },
  });
  return response.body.products;
}

export async function fetchProductDetails(shopDomain, productId) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: `products/${productId}`,
  });
  return response.body.product;
}
