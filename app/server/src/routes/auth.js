import express from 'express';
import { z } from 'zod';
import { shopify, normalizeShop } from '../lib/shopify.js';
import { prisma } from '../lib/db.js';
import { registerWebhooksForShop } from './webhooks.js';
import { syncShopifyData } from '../services/shopifySync.js';
import jwt from 'jsonwebtoken';

export function authRouter() {
  const router = express.Router();

  // SHOPIFY AUTH START
  router.get('/shopify', async (req, res) => {
    console.log("SHOP PARAM:", req.query.shop);

    if (!req.query.shop) {
      return res.status(400).send('❌ Missing shop parameter. Usage: /auth/shopify?shop=your-store.myshopify.com');
    }

    let shop;

    try {
      shop = normalizeShop(req.query.shop);
    } catch (err) {
      console.error("SHOP NORMALIZATION ERROR:", err.message);
      return res.status(400).send(`❌ ${err.message || 'Invalid shop format. Use: your-store.myshopify.com'}`);
    }

    console.log("NORMALIZED SHOP:", shop);

    try {
      await shopify.auth.begin({
        shop,
        callbackPath: '/auth/shopify/callback',
        isOnline: false,
        rawRequest: req,
        rawResponse: res
      });
    } catch (err) {
      console.error("SHOPIFY AUTH BEGIN ERROR:", err);
      return res.status(500).send(`❌ Failed to start Shopify authorization: ${err.message || String(err)}`);
    }

    return;
  });

  // SHOPIFY CALLBACK
  router.get('/shopify/callback', async (req, res) => {
    console.log("OAUTH CALLBACK COOKIE HEADER EXISTS:", !!req.headers.cookie);
    console.log("OAUTH CALLBACK QUERY:", Object.keys(req.query).sort().join(","));
    console.log("OAUTH CALLBACK HMAC EXISTS:", !!req.query.hmac);
    console.log("OAUTH CALLBACK STATE EXISTS:", !!req.query.state);
    console.log("OAUTH CALLBACK STATE VALUE:", req.query.state);

    try {
      const callbackRes = await shopify.auth.callback({
        rawRequest: req,
        rawResponse: res
      });

      const shop = callbackRes.session.shop;
      const accessToken = callbackRes.session.accessToken;

      let org = await prisma.organization.findFirst();

      if (!org) {
        org = await prisma.organization.create({
          data: { name: 'Default Organization' }
        });
      }

      const shopRecord = await prisma.shop.upsert({
        where: { domain: shop },
        update: {
          accessToken,
          isActive: true
        },
        create: {
          domain: shop,
          accessToken,
          organizationId: org.id
        }
      });

      // Register webhooks
      try {
        await registerWebhooksForShop({
          shop,
          accessToken
        });
      } catch (webhookErr) {
        console.warn('⚠️ Webhook registration notice:', webhookErr.message);
      }

      // Initial Sync: Fetch real Orders, Customers, and Products from Shopify
      try {
        await syncShopifyData(shop);
      } catch (syncErr) {
        console.error('⚠️ [OAUTH CALLBACK] Initial sync notice (non-fatal):', syncErr.message);
      }

      const jwtSecret = process.env.JWT_SECRET;

      if (!jwtSecret) {
        throw new Error('JWT_SECRET is not configured');
      }

      const frontendUrl =
        (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

      const token = jwt.sign(
        {
          shopId: shopRecord.id,
          shopDomain: shop,
          orgId: org.id
        },
        jwtSecret,
        {
          expiresIn: '24h'
        }
      );

      console.log(`✅ [OAUTH SUCCESS] Shop ${shop} connected. Redirecting to dashboard with token.`);
      return res.redirect(`${frontendUrl}/?token=${token}`);

    } catch (error) {
      console.error("CALLBACK ERROR:", error);

      return res
        .status(500)
        .send(`Auth callback error: ${error?.message || String(error)}`);
    }
  });

  // LIST SHOPS
  router.get('/shops', async (_req, res) => {
    const shops = await prisma.shop.findMany({
      orderBy: { installedAt: 'desc' },
      select: {
        domain: true,
        installedAt: true,
        isActive: true
      }
    });

    return res.json({ shops });
  });

  return router;
}

export function requireShopParam(req) {
  const schema = z.object({
    shop: z.string().min(1)
  });

  const parsed = schema.safeParse(req.params);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Missing shop param'
    };
  }

  return {
    ok: true,
    shop: parsed.data.shop
  };
}
