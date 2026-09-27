# Security Concerns

## 1. Authentication and Authorization
**Risk Level:** Critical
**Details:** The API endpoints under `/api/shops/:shop/...` do not appear to enforce robust authorization. A malicious actor could potentially fetch orders or trigger calls for `shop B` simply by changing the URL parameter, assuming `tenantMiddleware` does not validate a cryptographically secure session token.
**Recommendation:** Implement standard session management (e.g., JWT) verifying the user's role against the `User` and `Organization` schema.

## 2. Fraud Risk Scoring is Heuristic-Only
**Risk Level:** Medium
**Details:** The `computeRiskScore()` function assigns arbitrary point values based on simple rules (e.g., `if (isCOD) score += 15`). This can be easily bypassed by attackers and provides a false sense of security.
**Recommendation:** Integrate a real fraud detection service or utilize machine learning models.

## 3. PII Logging & Data Retention
**Risk Level:** High
**Details:** Customer phone numbers, names, and addresses are heavily logged in `console.log` statements (e.g., `console.log('📱 RAW PHONE:', phone);`). This violates privacy standards (GDPR/CCPA) if logs are sent to central logging systems (Datadog/CloudWatch) without masking.
**Recommendation:** Remove PII from `console.log` or use a dedicated logger (like `pino`, which is in `package.json`) configured to redact sensitive fields.

## 4. State Exhaustion (Memory Leak)
**Risk Level:** Medium
**Details:** The `activeCalls` Map stores agent sessions but might not reliably clear them if a call drops abruptly without triggering a hangup event.
**Recommendation:** Add a TTL (Time-To-Live) cleanup sweep for stale calls in the Map, or move state to Redis.

## 5. Missing Rate Limiting
**Risk Level:** High
**Details:** The manual "Call Now" endpoint (`POST /shops/:shop/orders/:orderId/call`) does not have rate limiting. A malicious user could trigger thousands of Twilio calls, resulting in massive financial costs.
**Recommendation:** Add API rate limiting (e.g., `express-rate-limit`) on outbound call triggers.
