// ===============================
// STARTUP SECURITY CHECKS
// ===============================
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16 || jwtSecret === 'fallback_secret_for_dev') {
  console.error('FATAL: JWT_SECRET is missing, too short (min 16 chars), or using a known insecure fallback.');
  console.error('Please configure a strong JWT_SECRET in your environment variables.');
  process.exit(1);
}
