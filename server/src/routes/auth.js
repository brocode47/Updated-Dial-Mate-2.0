/* __imports_rewritten__ */
import express from 'express';
import { z } from 'zod';
import { shopify, normalizeShop } from '../lib/shopify.js';
import { prisma } from '../lib/db.js';
import { registerWebhooksForShop } from './webhooks.js';

export function authRouter() {
  const router = express.Router();

  // ✅ SHOPIFY AUTH START
  router.get('/shopify', async (req, res) => {
    console.log("SHOP PARAM:", req.query.shop);

    // ❌ Missing shop
    if (!req.query.shop) {
      return res.status(400).send('❌ Missing shop parameter');
    }

    let shop;

    // ❌ Invalid shop format handling
    try {
      shop = normalizeShop(req.query.shop);
    } catch (err) {
      console.error("SHOP NORMALIZATION ERROR:", err.message);
      return res.status(400).send('❌ Invalid shop format. Use: your-store.myshopify.com');
    }

    console.log("NORMALIZED SHOP:", shop);

    // ✅ Start OAuth
    await shopify.auth.begin({
      shop,
      callbackPath: '/auth/shopify/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res
    });

    return; // ⚠️ Do NOT redirect manually
  });

  // ✅ SHOPIFY CALLBACK
  router.get('/shopify/callback', async (req, res) => {
    try {
      const callbackRes = await shopify.auth.callback({
        rawRequest: req,
        rawResponse: res
      });

      const shop = callbackRes.session.shop;
      const accessToken = callbackRes.session.accessToken;

      // ✅ Save in DB using Prisma
      let org = await prisma.organization.findFirst();
      if (!org) {
        org = await prisma.organization.create({ data: { name: 'Default Organization' } });
      }

      await prisma.shop.upsert({
        where: { domain: shop },
        update: { accessToken, isActive: true },
        create: { domain: shop, accessToken, organizationId: org.id }
      });

      // ✅ Register webhooks
      await registerWebhooksForShop({ shop, accessToken });

      // ✅ SUCCESS RESPONSE (no frontend needed)
      return res.send(`
        <h2>✅ Dial Mate Installed Successfully</h2>
        <p>Your Shopify store is now connected.</p>
      `);

    } catch (error) {
      console.error("CALLBACK ERROR:", error);
      return res.status(500).send(`Auth callback error: ${error?.message || String(error)}`);
    }
  });

  // ✅ DEBUG ROUTE (check installed shops)
  router.get('/shops', async (_req, res) => {
    const shops = await prisma.shop.findMany({
      orderBy: { installedAt: 'desc' },
      select: { domain: true, installedAt: true, isActive: true }
    });
    return res.json({ shops });
  });

  return router;
}

// ✅ Utility
export function requireShopParam(req) {
  const schema = z.object({ shop: z.string().min(1) });
  const parsed = schema.safeParse(req.params);
  if (!parsed.success) return { ok: false, error: 'Missing shop param' };
  return { ok: true, shop: parsed.data.shop };
}