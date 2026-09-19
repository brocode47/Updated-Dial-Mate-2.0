import { prisma } from '../lib/db.js';

export async function tenantMiddleware(req, res, next) {
  try {
    // Determine the shop domain from headers or params
    const shopDomain = req.headers['x-shop-domain'] || req.params.shop || req.query.shop;

    if (!shopDomain) {
      return res.status(401).json({ error: 'Missing shop domain for tenant scoping.' });
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { domain: shopDomain },
      include: { organization: true }
    });

    if (!shopRecord) {
      return res.status(403).json({ error: 'Unauthorized. Shop not found.' });
    }

    // Attach to request for downstream handlers
    req.shopRecord = shopRecord;
    req.organizationId = shopRecord.organizationId;

    next();
  } catch (error) {
    console.error('Tenant middleware error:', error);
    res.status(500).json({ error: 'Internal server error during tenant scoping.' });
  }
}
