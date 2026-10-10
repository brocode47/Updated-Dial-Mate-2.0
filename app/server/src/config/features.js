export const config = {
  appMode: process.env.APP_MODE || 'single_store',
  features: {
    publicSaaS: process.env.FEATURE_PUBLIC_SAAS === 'true',
    billing: process.env.FEATURE_BILLING === 'true',
    multiTenant: process.env.FEATURE_MULTI_TENANT === 'true',
    teamMembers: process.env.FEATURE_TEAM_MEMBERS === 'true',
    whiteLabel: process.env.FEATURE_WHITE_LABEL === 'true',
    shopifyPublicInstall: process.env.FEATURE_SHOPIFY_PUBLIC_INSTALL === 'true',
    usageBilling: process.env.FEATURE_USAGE_BILLING === 'true',
    marketplace: process.env.FEATURE_MARKETPLACE === 'true',
    zaraAgentCore: process.env.USE_ZARA_AGENT_CORE === 'true',
  }
};

export function isFeatureEnabled(featureName) {
  return !!config.features[featureName];
}

/**
 * Evaluates whether ZARA Agent Core should be activated for a given customer.
 *
 * Safety & Staging Guarantees:
 * 1. Default disabled: USE_ZARA_AGENT_CORE=false (default) always returns false.
 * 2. Canary allowlist: USE_ZARA_AGENT_CORE=canary requires matching ZARA_AGENT_TESTER_PHONES.
 * 3. Whitelist filtering: If ZARA_AGENT_TESTER_PHONES is set with USE_ZARA_AGENT_CORE=true,
 *    only allowlisted numbers route to the new agent core. All other customers use legacy path.
 * 4. Zero exposure to client: Evaluation is strictly server-side.
 *
 * @param {string|null} [customerPhone=null]
 * @returns {boolean}
 */
export function isZaraAgentCoreEnabled(customerPhone = null) {
  const flag = String(process.env.USE_ZARA_AGENT_CORE || 'false').trim().toLowerCase();
  if (flag !== 'true' && flag !== 'canary') {
    return false;
  }

  const allowlistRaw = process.env.ZARA_AGENT_TESTER_PHONES || process.env.ZARA_AGENT_CORE_ALLOWLIST;
  // If no allowlist is configured:
  // - In 'true' mode, open to all
  // - In 'canary' mode, default DENY for safety
  if (!allowlistRaw || allowlistRaw.trim() === '' || allowlistRaw.trim() === '*') {
    return flag === 'true';
  }

  if (!customerPhone) return false;
  const cleanPhone = String(customerPhone).replace(/[^0-9]/g, '');
  if (!cleanPhone) return false;
  const last10Caller = cleanPhone.slice(-10);

  const allowedNumbers = allowlistRaw
    .split(',')
    .map(s => s.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean);

  return allowedNumbers.some(allowed => {
    if (cleanPhone === allowed) return true;
    const last10Allowed = allowed.slice(-10);
    return (
      (last10Caller.length >= 9 && last10Allowed.length >= 9 && last10Caller === last10Allowed) ||
      (allowed.length >= 7 && cleanPhone.endsWith(allowed)) ||
      (cleanPhone.length >= 7 && allowed.endsWith(cleanPhone))
    );
  });
}
