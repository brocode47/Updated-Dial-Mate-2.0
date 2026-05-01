console.log('🔎 SHOPIFY_API_KEY exists:', !!process.env.SHOPIFY_API_KEY);
console.log('🔎 SHOPIFY_API_SECRET exists:', !!process.env.SHOPIFY_API_SECRET);
console.log('🔎 APP_URL:', process.env.APP_URL);

import '@shopify/shopify-api/adapters/node';
/* __imports_rewritten__ */
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

const apiVersion = process.env.SHOPIFY_API_VERSION || LATEST_API_VERSION;

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SHOPIFY_SCOPES || 'read_orders,write_orders').split(',').map((s) => s.trim()).filter(Boolean),
  hostName: new URL(process.env.APP_URL || 'http://localhost:8787').host,
  apiVersion,
  isEmbeddedApp: false,
  logger: {
    log: (_severity, message) => console.log(message)
  }
});

export function normalizeShop(shop) {
  if (!shop) return '';
  const raw = String(shop).trim();
  return raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`;
}
