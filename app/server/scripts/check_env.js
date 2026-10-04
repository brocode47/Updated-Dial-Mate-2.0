import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.log('ENV FILE NOT FOUND AT:', envPath);
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
const lines = content.split('\n');
const config = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    config[key] = val;
  }
}

const checkKey = (k) => {
  const val = config[k];
  if (!val || val.trim() === '') return 'MISSING';
  return 'CONFIGURED';
};

console.log('=== ENVIRONMENT INSPECTION (NO SECRETS EXPOSED) ===');
console.log('AI_CALL_MODE:', config['AI_CALL_MODE'] || 'MISSING');
console.log('ADMIN_TEST_NUMBERS status:', checkKey('ADMIN_TEST_NUMBERS'));

if (config['ADMIN_TEST_NUMBERS']) {
  const nums = config['ADMIN_TEST_NUMBERS'].split(',').map(n => {
    n = n.trim();
    return n.length > 4 ? '*'.repeat(n.length - 4) + n.slice(-4) : '***';
  });
  console.log('ADMIN_TEST_NUMBERS (masked):', nums.join(', '));
}

const reportKeys = [
  'DATABASE_URL',
  'REDIS_URL',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'GEMINI_API_KEY',
  'GEMINI_LIVE_MODEL',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_APP_URL',
  'SHOPIFY_CUSTOM_APP_TOKEN',
  'SHOPIFY_SHOP'
];

reportKeys.forEach(k => {
  console.log(k + ':', checkKey(k));
});

if (config['DATABASE_URL']) {
  try {
    const u = new URL(config['DATABASE_URL']);
    console.log('DATABASE Host:', u.host, '| Database:', u.pathname);
  } catch (e) {
    console.log('DATABASE_URL format: custom / unparseable as standard URL');
  }
}

if (config['REDIS_URL']) {
  try {
    const u = new URL(config['REDIS_URL']);
    console.log('REDIS Host:', u.host);
  } catch (e) {
    console.log('REDIS_URL format: custom / unparseable as standard URL');
  }
}
