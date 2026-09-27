import { shopify } from '../../lib/shopify.js';
import { prisma } from '../../lib/db.js';

/**
 * Get a Shopify REST or GraphQL client for a specific shop domain.
 * If the shop record does not have an accessToken, it will fall back to using
 * the SHOPIFY_API_SECRET as the access token (common for custom single-store apps).
 */
export async function getShopifyClient(shopDomain) {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain }
  });

  if (!shop) {
    throw new Error(`Shop ${shopDomain} not found`);
  }

  const accessToken = shop.accessToken || process.env.SHOPIFY_API_SECRET;

  if (!accessToken) {
    throw new Error(`No access token available for ${shopDomain}`);
  }

  const session = new shopify.session.customAppSession(shopDomain);
  session.accessToken = accessToken;

  // Returning a REST client
  const client = new shopify.clients.Rest({ session });
  return client;
}
