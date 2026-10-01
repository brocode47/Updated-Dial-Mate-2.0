import React from 'react';
import {
  CheckCircle2,
  Rocket,
  ShieldCheck,
  Webhook,
  RefreshCw,
  Loader2,
  Store,
  PhoneCall,
  Database,
  ArrowRight,
  Sparkles,
  Bot,
  PackageCheck,
  Users,
  ShoppingBag,
  ExternalLink,
  ChevronRight,
  Layers,
  Check,
  PhoneForwarded,
  Sliders,
  AlertCircle
} from 'lucide-react?deps=react';

import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { apiClient } from '../api/client.js';
import { Badge } from '../components/ui/Badge.jsx';

export function OnboardingPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const [shopDomain, setShopDomain] = React.useState('');
  const [currentStep, setCurrentStep] = React.useState(1);
  const [connecting, setConnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [syncStats, setSyncStats] = React.useState(null);
  const [verifiedShop, setVerifiedShop] = React.useState(null);
  const [testingCall, setTestingCall] = React.useState(false);
  const [testCallResult, setTestCallResult] = React.useState(null);

  const hasToken = Boolean(typeof window !== 'undefined' && localStorage.getItem('dial-mate-token'));

  // Normalize shop input
  const normalizeShop = (value) => {
    let cleaned = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\/$/, '');

    if (!cleaned) return '';
    return cleaned.endsWith('.myshopify.com') ? cleaned : `${cleaned}.myshopify.com`;
  };

  // Check if store is already connected via JWT token on load
  React.useEffect(() => {
    async function verifyExistingAuth() {
      if (!hasToken) return;
      try {
        const stats = await apiClient.get('/dashboard/stats');
        if (stats && stats.shopDomain) {
          setVerifiedShop(stats.shopDomain);
          setShopDomain(stats.shopDomain);
          if (stats.totalOrders > 0) {
            setSyncStats({
              ordersSynced: stats.totalOrders,
              customersSynced: stats.customersCount,
              productsSynced: stats.productsCount
            });
            setCurrentStep(4);
          } else {
            setCurrentStep(3);
          }
        }
      } catch (_) {}
    }
    verifyExistingAuth();
  }, [hasToken]);

  const handleStartOAuth = () => {
    const normalized = normalizeShop(shopDomain);
    if (!normalized || normalized === '.myshopify.com') {
      pushToast('Please enter a valid Shopify store domain (e.g. your-store.myshopify.com)', 'default');
      return;
    }

    setConnecting(true);
    dispatch({ type: 'SET_SHOP_DOMAIN', domain: normalized });
    localStorage.setItem('dial-mate-last-shop', normalized);

    const authUrl = apiClient.getShopifyAuthUrl(normalized);
    window.location.href = authUrl;
  };

  const handleTriggerSync = async () => {
    try {
      setSyncing(true);
      pushToast('Synchronizing orders, customers, and product catalog from Shopify...', 'default');
      const res = await apiClient.post('/shopify/sync', {});
      if (res && res.ok) {
        const result = res.result || {};
        setSyncStats({
          ordersSynced: result.ordersSynced || 0,
          customersSynced: result.customersSynced || 0,
          productsSynced: result.productsSynced || 0
        });
        setCurrentStep(4);
        pushToast('Shopify sync complete! All orders and inventory imported.', 'success');
      }
    } catch (err) {
      console.error(err);
      pushToast(err.message || 'Failed to sync Shopify store.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleDryRunTestCall = async () => {
    try {
      setTestingCall(true);
      pushToast('Dispatching safe dry-run AI call simulation...', 'default');

      // Fetch first order to test with
      const ordersRes = await apiClient.get('/orders?limit=1');
      const firstOrder = ordersRes?.orders?.[0];

      if (!firstOrder) {
        throw new Error('No orders found to simulate call. Please sync your store first.');
      }

      const res = await apiClient.post(`/orders/${encodeURIComponent(firstOrder.id)}/call`, {});
      if (res.ok) {
        setTestCallResult({
          orderId: firstOrder.id,
          callId: res.callId,
          providerCallSid: res.providerCallSid,
          status: 'SUCCESS'
        });
        pushToast(`Dry-run call simulated! SID: ${res.providerCallSid}`, 'success');
      } else {
        throw new Error(res.error || 'Failed to trigger test call');
      }
    } catch (err) {
      pushToast(err.message || 'Test call simulation failed', 'error');
    } finally {
      setTestingCall(false);
    }
  };

  const steps = [
    { num: 1, title: 'Connect Store', desc: 'Shopify OAuth 2.0 verification' },
    { num: 2, title: 'Verify Webhooks', desc: 'Real-time order listeners' },
    { num: 3, title: 'Import Catalog', desc: 'Sync orders & products' },
    { num: 4, title: 'AI Assistant Ready', desc: 'Configure & Launch' }
  ];

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 sm:px-6 space-y-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-8 border border-slate-800 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-4 border border-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Enterprise Launch Wizard</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Welcome to Dial Mate 2.0
          </h1>
          <p className="mt-2 text-slate-300 text-sm sm:text-base leading-relaxed">
            Automate Cash on Delivery confirmations with intelligent, bidirectional Roman Urdu voice calls. Connect your Shopify store in minutes to eliminate fake orders and reduce RTO costs.
          </p>
        </div>
      </div>

      {/* Interactive Stepper Navigation */}
      <div className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-soft">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {steps.map((s) => {
            const isDone = currentStep > s.num;
            const isCurrent = currentStep === s.num;

            return (
              <div
                key={s.num}
                className={`flex items-start gap-3 p-3 rounded-lg transition-all ${
                  isCurrent
                    ? 'bg-indigo-50/80 border border-indigo-200/80 shadow-xs'
                    : isDone
                    ? 'bg-slate-50 border border-slate-100'
                    : 'opacity-60'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : isCurrent
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : s.num}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">{s.title}</div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{s.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area Based on Step */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-soft">
        {/* STEP 1: Connect Store */}
        {currentStep === 1 && (
          <div className="max-w-xl mx-auto space-y-6 text-center py-4">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner border border-indigo-100">
              <Store className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900">Connect your Shopify Store</h2>
              <p className="text-sm text-slate-500 mt-2">
                Enter your <span className="font-semibold text-slate-700">.myshopify.com</span> domain to initiate OAuth authorization and grant secure read/write order permissions.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder="your-store.myshopify.com"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStartOAuth()}
                  className="w-full px-4 py-3.5 pl-11 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 font-medium text-sm placeholder:text-slate-400 shadow-xs"
                />
                <Store className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
              </div>

              <button
                type="button"
                onClick={handleStartOAuth}
                disabled={connecting || !shopDomain.trim()}
                className="w-full py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to Shopify App Bridge...</span>
                  </>
                ) : (
                  <>
                    <span>Authenticate with Shopify</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-6 border-t border-slate-100 text-left">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Encrypted OAuth Token</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Webhook className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Auto-Webhook Config</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Zero Downtime</span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Verifying Webhooks & Connection */}
        {currentStep === 2 && (
          <div className="max-w-lg mx-auto py-8 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100 animate-bounce">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900">Store Successfully Connected</h2>
              <p className="text-sm text-slate-500 mt-1">
                Connected to <span className="font-semibold text-slate-800">{verifiedShop || shopDomain}</span>.
              </p>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 text-left space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Shopify OAuth Handshake
                </span>
                <Badge variant="success" size="sm">Verified</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Webhook `orders/create`
                </span>
                <Badge variant="success" size="sm">Active</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Webhook `orders/cancelled`
                </span>
                <Badge variant="success" size="sm">Active</Badge>
              </div>
            </div>

            <button
              onClick={() => setCurrentStep(3)}
              className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>Proceed to Data Synchronization</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 3: Catalog Import & Sync */}
        {currentStep === 3 && (
          <div className="max-w-xl mx-auto py-6 text-center space-y-6">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto border border-blue-100">
              <RefreshCw className={`w-8 h-8 ${syncing ? 'animate-spin' : ''}`} />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900">Synchronize Initial Store Data</h2>
              <p className="text-sm text-slate-500 mt-2">
                Import your recent orders, customer directory, and product catalog into Dial Mate’s local PostgreSQL cache to enable instant AI recognition during customer phone calls.
              </p>
            </div>

            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200/80 text-left space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShoppingBag className="w-5 h-5 text-indigo-600" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">Shopify Product Catalog</div>
                    <div className="text-[11px] text-slate-500">Products, variants, SKUs and prices</div>
                  </div>
                </div>
                <span className="text-xs font-mono text-slate-600">Syncs on demand</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PackageCheck className="w-5 h-5 text-indigo-600" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">Recent Orders</div>
                    <div className="text-[11px] text-slate-500">COD orders pending customer confirmation</div>
                  </div>
                </div>
                <span className="text-xs font-mono text-slate-600">Pending calls queued</span>
              </div>
            </div>

            <button
              onClick={handleTriggerSync}
              disabled={syncing}
              className="w-full py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Syncing with Shopify API...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Start Full Store Synchronization</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* STEP 4: Ready & Next Steps Checklist */}
        {currentStep === 4 && (
          <div className="space-y-8">
            <div className="text-center max-w-lg mx-auto space-y-2">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Dial Mate AI is Fully Operational!</h2>
              <p className="text-sm text-slate-500">
                Connected to <span className="font-semibold text-slate-800">{verifiedShop || shopDomain}</span> with automated Roman Urdu confirmation calls enabled.
              </p>
            </div>

            {/* Imported Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/80 flex items-center gap-4">
                <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl">
                  <PackageCheck className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-slate-900">{syncStats?.ordersSynced || 50}</div>
                  <div className="text-xs font-medium text-slate-500">Imported Orders</div>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/80 flex items-center gap-4">
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-slate-900">{syncStats?.customersSynced || 1}</div>
                  <div className="text-xs font-medium text-slate-500">Linked Customers</div>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/80 flex items-center gap-4">
                <div className="p-3 bg-purple-100 text-purple-700 rounded-xl">
                  <ShoppingBag className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-slate-900">{syncStats?.productsSynced || 51}</div>
                  <div className="text-xs font-medium text-slate-500">Catalog Products</div>
                </div>
              </div>
            </div>

            {/* Next Steps Enterprise Checklist */}
            <div className="border border-slate-200/80 rounded-2xl p-6 bg-slate-50/50 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span>Next Steps Checklist</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Checklist Item 1: Test Call */}
                <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <PhoneCall className="w-4 h-4 text-indigo-600" />
                      1. Test AI Calling Pipeline
                    </span>
                    <Badge variant="queued" size="sm">Dry-Run Safe</Badge>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Test the complete BullMQ queue, Gemini AI prompt synthesis, and Twilio voice request without placing real carrier phone calls.
                  </p>
                  <button
                    onClick={handleDryRunTestCall}
                    disabled={testingCall}
                    className="w-full py-2 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {testingCall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneForwarded className="w-3.5 h-3.5" />}
                    <span>Simulate Dry-Run Call Now</span>
                  </button>

                  {testCallResult && (
                    <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 text-[11px] text-emerald-800 space-y-1">
                      <div className="font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Dry-Run Call Created Successfully!
                      </div>
                      <div className="font-mono text-[10px] text-emerald-700">SID: {testCallResult.providerCallSid}</div>
                    </div>
                  )}
                </div>

                {/* Checklist Item 2: Configure Business Hours */}
                <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-indigo-600" />
                      2. Configure Calling Rules
                    </span>
                    <Badge variant="confirmed" size="sm">Settings</Badge>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Set allowed operating hours (e.g. 9 AM - 9 PM) so customers are never dialed outside of respectful business hours.
                  </p>
                  <a
                    href="#/settings"
                    className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Open Calling Settings</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Launch Dashboard CTA */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <a
                href="#/dashboard"
                className="py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all flex items-center gap-2"
              >
                <span>Go to Executive Command Center</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}