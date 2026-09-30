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
  ShoppingBag
} from 'lucide-react?deps=react';

import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { apiClient } from '../api/client.js';

export function OnboardingPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const [shopDomain, setShopDomain] = React.useState('');
  const [currentStep, setCurrentStep] = React.useState(1);
  const [connecting, setConnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [syncStats, setSyncStats] = React.useState(null);
  const [verifiedShop, setVerifiedShop] = React.useState(null);

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
          // If already connected with orders, advance to complete
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

    // Direct clean redirect to backend OAuth endpoint without any SPA hash
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
        pushToast('Store data synchronized successfully!', 'success');
      } else {
        throw new Error(res.error || 'Sync returned an unexpected response');
      }
    } catch (err) {
      pushToast(err.message || 'Synchronization failed. Please verify store connection.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const goToDashboard = () => {
    window.location.hash = '/dashboard';
  };

  return (
    <div className="mx-auto max-w-4xl py-6 sm:py-10">
      {/* Onboarding Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary)/0.2)] bg-[hsl(var(--primary)/0.08)] px-3.5 py-1 text-xs font-semibold text-[hsl(var(--primary))]">
          <Sparkles size={13} />
          <span>Enterprise Merchant Onboarding</span>
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl text-[hsl(var(--foreground))]">
          Launch Dial Mate for Shopify
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm sm:text-base text-[hsl(var(--foreground)/0.65)]">
          Automate COD order confirmation calls in natural Roman Urdu and conversational English, prevent fake deliveries, and track live customer response outcomes.
        </p>
      </div>

      {/* Stepper Progress Bar */}
      <div className="mt-8 sm:mt-12 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-6 shadow-sm">
        <div className="grid grid-cols-4 gap-2 sm:gap-4 text-center">
          {[
            { step: 1, label: 'Welcome', icon: Bot },
            { step: 2, label: 'Connect Store', icon: Store },
            { step: 3, label: 'Initial Sync', icon: Database },
            { step: 4, label: 'Launch', icon: Rocket }
          ].map((s) => {
            const isDone = currentStep > s.step;
            const isCurrent = currentStep === s.step;
            const Icon = s.icon;

            return (
              <div key={s.step} className="flex flex-col items-center">
                <div
                  className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition-colors ${
                    isDone
                      ? 'bg-emerald-500 text-white'
                      : isCurrent
                      ? 'bg-[hsl(var(--primary))] text-white shadow-sm ring-4 ring-[hsl(var(--primary)/0.15)]'
                      : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.4)]'
                  }`}
                >
                  {isDone ? <CheckCircle2 size={18} /> : <Icon size={18} />}
                </div>
                <span className={`mt-2 text-xs font-semibold ${isCurrent ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--foreground)/0.5)]'}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Panels */}
      <div className="mt-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-8 shadow-sm">
        {/* Step 1: Welcome */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">Welcome to Dial Mate AI</h2>
              <p className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                Dial Mate acts as your store's dedicated Urdu voice agent. Here is how your automated workflow will work:
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]">
                  <Webhook size={18} />
                </div>
                <h3 className="mt-3 text-sm font-bold text-[hsl(var(--foreground))]">1. Order Webhook</h3>
                <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--foreground)/0.6)]">
                  When a customer places a COD order on your Shopify store, Dial Mate receives the order securely via webhooks.
                </p>
              </div>

              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <PhoneCall size={18} />
                </div>
                <h3 className="mt-3 text-sm font-bold text-[hsl(var(--foreground))]">2. Urdu AI Voice Call</h3>
                <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--foreground)/0.6)]">
                  The automated AI dials the Pakistani number, greets the customer in Urdu, confirms item details, and listens for confirmation or cancellation.
                </p>
              </div>

              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--secondary)/0.1)] text-[hsl(var(--secondary))]">
                  <PackageCheck size={18} />
                </div>
                <h3 className="mt-3 text-sm font-bold text-[hsl(var(--foreground))]">3. Live Dashboard Updates</h3>
                <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--foreground)/0.6)]">
                  Confirmed and cancelled orders update in real time with call recordings, transcript logs, and retry attempts.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
              <button
                onClick={() => setCurrentStep(2)}
                className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition"
              >
                <span>Continue to Store Connection</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Connect Store */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">Connect your Shopify Store</h2>
              <p className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                Enter your Shopify store domain to authorize permissions through official Shopify OAuth.
              </p>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] p-4 sm:p-5">
              <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--foreground)/0.7)]">
                Shopify Store Domain
              </label>
              <div className="relative mt-2">
                <Store size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  type="text"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  placeholder="e.g. 0qwck2-s1.myshopify.com"
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2.5 pl-10 pr-4 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/0.15)] transition"
                />
              </div>

              {shopDomain ? (
                <div className="mt-2 text-xs text-[hsl(var(--foreground)/0.6)]">
                  Target: <span className="font-semibold text-[hsl(var(--primary))]">{normalizeShop(shopDomain)}</span>
                </div>
              ) : null}

              <div className="mt-4 rounded-lg bg-[hsl(var(--primary)/0.06)] p-3 text-xs text-[hsl(var(--foreground)/0.7)]">
                <div className="flex items-center gap-2 font-semibold text-[hsl(var(--primary))]">
                  <ShieldCheck size={15} />
                  <span>Verified Scopes Requested</span>
                </div>
                <div className="mt-1">
                  Orders (Read & Write), Customers (Read), Products & Inventory (Read).
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[hsl(var(--border))]">
              <button
                onClick={() => setCurrentStep(1)}
                className="rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition"
              >
                Back
              </button>

              <button
                onClick={handleStartOAuth}
                disabled={connecting || !shopDomain.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition disabled:opacity-50"
              >
                {connecting ? <Loader2 size={16} className="animate-spin" /> : <Store size={16} />}
                <span>{connecting ? 'Redirecting to Shopify...' : 'Authorize with Shopify'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Initial Sync */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 size={22} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">Shopify Store Connected!</h2>
                <p className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                  {verifiedShop ? `Successfully authorized with ${verifiedShop}.` : 'Your store is authorized and linked to your tenant organization.'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-5">
              <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">Initial Catalog & Order Synchronization</h3>
              <p className="mt-1 text-xs text-[hsl(var(--foreground)/0.6)]">
                Sync live orders, customer records, and product prices to train your Urdu AI calling engine with accurate product names and amounts.
              </p>

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleTriggerSync}
                  disabled={syncing}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition disabled:opacity-50"
                >
                  {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  <span>{syncing ? 'Importing from Shopify...' : 'Start Initial Synchronization'}</span>
                </button>

                <button
                  onClick={goToDashboard}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition"
                >
                  <span>Skip to Dashboard</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Ready & Launch */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <Rocket size={22} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">You are Ready for Launch!</h2>
                <p className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Your store is fully integrated and synchronized with Dial Mate.
                </p>
              </div>
            </div>

            {/* Sync summary cards */}
            {syncStats && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center shadow-xs">
                  <div className="flex justify-center text-[hsl(var(--primary))] mb-1"><PackageCheck size={20} /></div>
                  <div className="text-2xl font-extrabold text-[hsl(var(--foreground))]">{syncStats.ordersSynced}</div>
                  <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Orders Synced</div>
                </div>

                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center shadow-xs">
                  <div className="flex justify-center text-emerald-600 mb-1"><Users size={20} /></div>
                  <div className="text-2xl font-extrabold text-[hsl(var(--foreground))]">{syncStats.customersSynced}</div>
                  <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Customers Linked</div>
                </div>

                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center shadow-xs">
                  <div className="flex justify-center text-[hsl(var(--accent))] mb-1"><ShoppingBag size={20} /></div>
                  <div className="text-2xl font-extrabold text-[hsl(var(--foreground))]">{syncStats.productsSynced}</div>
                  <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Products Ready</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-700 dark:text-emerald-300">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={16} />
                <span>Next steps:</span>
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-emerald-700/80 dark:text-emerald-300/80">
                <li>Go to the Dashboard to track incoming COD orders in real time.</li>
                <li>Test an outbound call using the "Call" button on any pending order.</li>
                <li>Configure your AI voice preferences and working hours in Settings.</li>
              </ul>
            </div>

            <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
              <button
                onClick={goToDashboard}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition"
              >
                <span>Go to Dashboard</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}