import { prisma } from '../lib/db.js';
import jwt from 'jsonwebtoken';

export async function tenantMiddleware(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }

    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('FATAL: JWT_SECRET is missing');
      return res.status(500).json({ error: 'Internal Server Configuration Error' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const shopDomain = decoded.shopDomain;

    if (!shopDomain) {
      return res.status(401).json({ error: 'Missing shop domain in token.' });
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
