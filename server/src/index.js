import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { initDb } from './lib/db.js';
import { authRouter } from './routes/auth.js';
import { webhooksRouter } from './routes/webhooks.js';
import { apiRouter } from './routes/api.js';

const PORT = Number(process.env.PORT || 8787);
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const app = express();

app.disable('x-powered-by');

// ✅ CORS
app.use(cors({
  origin: FRONTEND_URL === '*' ? true : FRONTEND_URL,
  credentials: true
}));

app.use(morgan('tiny'));

// ✅ REQUIRED FOR TWILIO
app.use(express.urlencoded({ extended: false }));

// ✅ ROOT
app.get('/', (_req, res) => {
  res.send('Dial Mate Backend Running ✅');
});

// ✅ HEALTH
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// 🚨 Shopify webhooks RAW body (DO NOT TOUCH)
app.use('/webhooks', express.raw({ type: 'application/json' }));

// ===============================
// ✅ TWILIO IVR SYSTEM (DYNAMIC)
// ===============================

// 🎧 Voice + Dynamic Data + Input
app.all("/voice", (req, res) => {
  console.log("📞 Incoming call triggered");

  // ✅ GET DATA FROM URL
  const name = req.query.name || "Customer";
  const product = req.query.product || "your product";
  const price = req.query.price || "0";

  res.set("Content-Type", "text/xml");

  res.send(`
    <Response>
      <Gather numDigits="1" action="/gather" method="POST" timeout="5">
        <Say language="en-PK">
          Assalam o Alaikum ${name}.
          Aap ne ${product} order kiya hai.
          Jiski price ${price} hai.
          Tasdeeq ke liye 1 dabayein.
          Cancel karne ke liye 2 dabayein.
        </Say>
      </Gather>

      <Say>Humein koi input receive nahi hua. Khuda Hafiz.</Say>
    </Response>
  `);
});

// 🎯 Handle User Input
app.post("/gather", async (req, res) => {
  const digit = req.body.Digits;

  console.log("📥 User pressed:", digit);

  let message = "";

  if (digit === "1") {
    message = "Shukriya. Aapka order confirm ho gaya hai.";
    console.log("✅ Order CONFIRMED");

    // TODO: update DB → confirmed
  } else if (digit === "2") {
    message = "Aapka order cancel kar diya gaya hai.";
    console.log("❌ Order CANCELLED");

    // TODO: update DB → cancelled
  } else {
    message = "Ghalat input. Dobara koshish karein.";
    console.log("⚠️ Invalid input received");
  }

  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Say language="en-PK">${message}</Say>
    </Response>
  `);
});

// ===============================
// ✅ ROUTES
// ===============================
app.use('/auth', authRouter());
app.use('/api', express.json(), apiRouter());
app.use('/webhooks', webhooksRouter());

// ✅ Init DB
await initDb();

// ✅ Start server
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});