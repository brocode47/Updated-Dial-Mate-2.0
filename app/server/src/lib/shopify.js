if (process.env.NODE_ENV !== 'test' && !process.env.IS_EVAL_HARNESS) {
  console.log('🔎 SHOPIFY_API_KEY exists:', !!process.env.SHOPIFY_API_KEY);
  console.log('🔎 SHOPIFY_API_SECRET exists:', !!process.env.SHOPIFY_API_SECRET);
  console.log('🔎 APP_URL:', process.env.APP_URL);
}

import '@shopify/shopify-api/adapters/node';
/* __imports_rewritten__ */
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

const apiVersion = process.env.SHOPIFY_API_VERSION || LATEST_API_VERSION;

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || 'test_shopify_api_key',
  apiSecretKey: process.env.SHOPIFY_API_SECRET || 'test_shopify_api_secret',
  scopes: (process.env.SHOPIFY_SCOPES || 'read_orders,write_orders,read_customers,read_products').split(',').map((s) => s.trim()).filter(Boolean),
  hostName: new URL(process.env.APP_URL || 'http://localhost:8787').host,
  apiVersion,
  isEmbeddedApp: false,
  logger: {
    log: (_severity, message) => {
      if (process.env.NODE_ENV !== 'test' && !process.env.IS_EVAL_HARNESS) {
        console.log(message);
      }
    }
  }
});

export function normalizeShop(shop) {
  if (!shop) return '';
  let raw = String(shop).trim().toLowerCase();

  // Strip protocol (http:// or https://)
  raw = raw.replace(/^https?:\/\//i, '');

  // Strip query/path if user pasted full URL (e.g., mystore.myshopify.com/admin)
  raw = raw.split('/')[0].split('?')[0].split('#')[0].trim();

  // Strip trailing slashes
  raw = raw.replace(/\/+$/, '');

  if (!raw) return '';

  // Append .myshopify.com if not present
  if (!raw.endsWith('.myshopify.com')) {
    raw = `${raw}.myshopify.com`;
  }

  // Validate Shopify store subdomain format
  const validShopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  if (!validShopRegex.test(raw)) {
    throw new Error('Invalid shop domain format. Please enter a valid store like your-store.myshopify.com');
  }

  return raw;
}
