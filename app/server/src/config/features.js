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
  }
};

export function isFeatureEnabled(featureName) {
  return !!config.features[featureName];
}
