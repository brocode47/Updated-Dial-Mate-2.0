import { getShopifyClient } from './client.js';

export async function fetchCustomers(shopDomain, limit = 50) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: 'customers',
    query: {
      limit,
    },
  });
  return response.body.customers;
}

export async function fetchCustomerDetails(shopDomain, customerId) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: `customers/${customerId}`,
  });
  return response.body.customer;
}
