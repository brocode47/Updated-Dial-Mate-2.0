import 'dotenv/config';

import twilio from 'twilio';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { shopify } from './lib/shopify.js';
import { prisma } from './lib/db.js';
import { authRouter } from './routes/auth.js';
import { webhooksRouter } from './routes/webhooks.js';
import { apiRouter } from './routes/api.js';
import { twilioRouter } from './routes/twilio.js';

const PORT = Number(process.env.PORT || 8787);

const app = express();

app.use((req, res, next) => {
  console.log('🌐 INCOMING REQUEST:', req.method, req.url);
  next();
});

app.disable('x-powered-by');

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

app.options('*', cors());

app.use(morgan('tiny'));

// Required for Twilio form posts
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => {
  res.send('Dial Mate Backend Running ✅');
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Shopify webhooks raw body
app.use('/webhooks', express.raw({ type: 'application/json' }));

app.use('/webhooks', webhooksRouter());
app.use('/auth', authRouter());
app.use('/api', apiRouter());
app.use('/twilio', twilioRouter());

// ===============================
// INIT DB + START SERVER
// ===============================


app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});