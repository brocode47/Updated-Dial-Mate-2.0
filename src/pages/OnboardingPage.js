import React from 'react';
import {
  CheckCircle2,
  Rocket,
  ShieldCheck,
  Webhook,
  ExternalLink,
  Server,
  RefreshCw,
  Loader2,
  Store,
  PhoneCall,
  Database,
  AlertCircle
} from 'lucide-react?deps=react';

import { html } from '../jsx.js';
import { useStore } from '../store.js';
import { useToast } from '../toast.js';
import { PageHeader } from '../components/PageHeader.js';
import { SectionCard } from '../components/SectionCard.js';

export function OnboardingPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const [shopDomain, setShopDomain] = React.useState(
    state.session.shop.domain || 'bro-code-7492.myshopify.com'
  );
  const [backendUrl, setBackendUrl] = React.useState(
    state.backendUrl || 'https://leisa-celebrated-indefectibly.ngrok-free.dev'
  );
  const [checking, setChecking] = React.useState(false);
  const [connectionStatus, setConnectionStatus] = React.useState(null);

  const baseUrl = backendUrl.replace(/\/$/, '');

  const normalizeShop = (value) => {
    const cleaned = String(value || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

    return cleaned.endsWith('.myshopify.com')
      ? cleaned
      : `${cleaned}.myshopify.com`;
  };

  const steps = [
    {
      label: 'Connect Shopify store',
      done: connectionStatus === 'connected',
      icon: ShieldCheck,
      detail: 'Securely authorize Dial Mate with your Shopify store.'
    },
    {
      label: 'Activate webhooks',
      done: connectionStatus === 'connected',
      icon: Webhook,
      detail: 'New orders trigger confirmation calls automatically.'
    },
    {
      label: 'Enable Urdu voice calling',
      done: true,
      icon: PhoneCall,
      detail: 'Customers hear an Urdu confirmation prompt and press 1 or 2.'
    },
    {
      label: 'Track live orders',
      done: true,
      icon: Database,
      detail: 'Orders, call status, retries, and outcomes appear in the dashboard.'
    },
    {
      label: 'Ready for launch',
      done: connectionStatus === 'connected',
      icon: Rocket,
      detail: 'Once connected, place a test order and verify a live call.'
    }
  ];

  const handleConnect = () => {
    const normalizedShop = normalizeShop(shopDomain);

    if (!normalizedShop || normalizedShop === '.myshopify.com') {
      pushToast('Please enter your Shopify store domain.', 'default');
      return;
    }

    if (!backendUrl) {
      pushToast('Please enter your backend API URL.', 'default');
      return;
    }

    dispatch({ type: 'SET_BACKEND_URL', url: baseUrl });
    dispatch({ type: 'SET_SHOP_DOMAIN', domain: normalizedShop });

    window.location.href = `${baseUrl}/auth/shopify?shop=${encodeURIComponent(normalizedShop)}`;
  };

  const handleVerify = async () => {
    try {
      setChecking(true);
      setConnectionStatus(null);

      dispatch({ type: 'SET_BACKEND_URL', url: baseUrl });
      dispatch({ type: 'SET_SHOP_DOMAIN', domain: normalizeShop(shopDomain) });

      const [healthRes, shopsRes, ordersRes] = await Promise.all([
        fetch(`${baseUrl}/api/health`, {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        }),
        fetch(`${baseUrl}/auth/shops`, {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        }),
        fetch(`${baseUrl}/debug/orders?t=${Date.now()}`, {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        })
      ]);

      if (!healthRes.ok || !shopsRes.ok || !ordersRes.ok) {
        throw new Error('Backend check failed');
      }

      const shopsData = await shopsRes.json();
      const ordersData = await ordersRes.json();

      const normalizedShop = normalizeShop(shopDomain);
      const isConnected = (shopsData.shops || []).some(
        (shop) => shop.shop === normalizedShop
      );

      if (!isConnected) {
        setConnectionStatus('not_connected');
        pushToast('Backend is online, but Shopify store is not connected yet.', 'default');
        return;
      }

      setConnectionStatus('connected');

      dispatch({
        type: 'SYNC_DATA',
        orders: ordersData.orders || [],
        calls: [],
        complianceLogs: []
      });

      pushToast('Store verified successfully.', 'success');
    } catch (err) {
      console.error(err);
      setConnectionStatus('error');
      pushToast('Could not verify connection. Check backend URL and server status.', 'default');
    } finally {
      setChecking(false);
    }
  };

  return html`
    <div className="fade-up space-y-5 sm:space-y-6">
      <${PageHeader}
        eyebrow="Launch setup"
        title="Connect your Shopify store"
        description="Set up Dial Mate in a few steps. Connect your store, verify the backend, then place a test order to confirm the call flow."
      />

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-5">
          <${SectionCard} title="1. Store connection" subtitle="Enter the store and backend details provided during setup">
            <div className="space-y-4">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Shopify store domain</span>
                <div className="relative">
                  <${Store} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                  <input
                    type="text"
                    value=${shopDomain}
                    onChange=${(e) => setShopDomain(e.target.value)}
                    placeholder="your-store.myshopify.com"
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                  />
                </div>
                <span className="text-xs text-[hsl(var(--foreground)/0.55)]">
                  Example: mehrmart.myshopify.com
                </span>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium">Backend API URL</span>
                <div className="relative">
                  <${Server} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                  <input
                    type="text"
                    value=${backendUrl}
                    onChange=${(e) => setBackendUrl(e.target.value)}
                    placeholder="https://your-backend-domain.com"
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                  />
                </div>
                <span className="text-xs text-[hsl(var(--foreground)/0.55)]">
                  This is where your Dial Mate backend is hosted.
                </span>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick=${handleConnect}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white shadow-medium transition-all hover:-translate-y-0.5"
                >
                  <${ExternalLink} size=${16} />
                  Connect Shopify
                </button>

                <button
                  onClick=${handleVerify}
                  disabled=${checking}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold shadow-soft disabled:opacity-50"
                >
                  ${checking
                    ? html`<${Loader2} size=${16} className="animate-spin" />`
                    : html`<${RefreshCw} size=${16} />`}
                  Verify setup
                </button>
              </div>

              ${connectionStatus === 'connected' ? html`
                <div className="flex items-start gap-3 rounded-3xl bg-emerald-500/12 p-4 text-emerald-700">
                  <${CheckCircle2} size=${18} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Store connected</div>
                    <div className="mt-1 text-sm">
                      Your backend, Shopify auth, and order database are connected.
                    </div>
                  </div>
                </div>
              ` : null}

              ${connectionStatus === 'not_connected' ? html`
                <div className="flex items-start gap-3 rounded-3xl bg-amber-500/12 p-4 text-amber-700">
                  <${AlertCircle} size=${18} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Shopify authorization needed</div>
                    <div className="mt-1 text-sm">
                      Click “Connect Shopify” and approve the app installation.
                    </div>
                  </div>
                </div>
              ` : null}

              ${connectionStatus === 'error' ? html`
                <div className="flex items-start gap-3 rounded-3xl bg-red-500/12 p-4 text-red-700">
                  <${AlertCircle} size=${18} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Connection check failed</div>
                    <div className="mt-1 text-sm">
                      Confirm your backend is running and your URL is correct.
                    </div>
                  </div>
                </div>
              ` : null}
            </div>
          </${SectionCard}>

          <${SectionCard} title="2. Test order" subtitle="Recommended client handoff checklist">
            <div className="space-y-3 text-sm text-[hsl(var(--foreground)/0.72)]">
              <div className="flex gap-3 rounded-2xl bg-[hsl(var(--muted)/0.45)] p-4">
                <span className="font-semibold text-[hsl(var(--primary))]">1</span>
                <span>Create a test Shopify order with a real phone number.</span>
              </div>
              <div className="flex gap-3 rounded-2xl bg-[hsl(var(--muted)/0.45)] p-4">
                <span className="font-semibold text-[hsl(var(--primary))]">2</span>
                <span>Answer the call and press 1 to confirm or 2 to cancel.</span>
              </div>
              <div className="flex gap-3 rounded-2xl bg-[hsl(var(--muted)/0.45)] p-4">
                <span className="font-semibold text-[hsl(var(--primary))]">3</span>
                <span>Check Dashboard and Orders pages for updated status.</span>
              </div>
            </div>
          </${SectionCard}>
        </div>

        <div className="space-y-5">
          <${SectionCard} title="Launch checklist" subtitle="Simple readiness view for store owners">
            <div className="space-y-3">
              ${steps.map((step, index) => html`
                <div key=${step.label} className="flex gap-4 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                  <div className=${`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    step.done
                      ? 'bg-emerald-500/12 text-emerald-600'
                      : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.55)]'
                  }`}>
                    <${step.icon} size=${18} />
                  </div>

                  <div>
                    <div className="font-semibold">${String(index + 1)}. ${step.label}</div>
                    <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">
                      ${step.detail}
                    </div>
                  </div>
                </div>
              `)}
            </div>
          </${SectionCard}>

          <${SectionCard} title="What Dial Mate does" subtitle="Client-friendly summary">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
                <div className="font-semibold">Automatic calls</div>
                <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.65)]">
                  New Shopify orders trigger Urdu confirmation calls.
                </div>
              </div>

              <div className="rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
                <div className="font-semibold">Customer input</div>
                <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Customer presses 1 to confirm or 2 to cancel.
                </div>
              </div>

              <div className="rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
                <div className="font-semibold">Retry handling</div>
                <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Failed or unanswered calls can retry automatically.
                </div>
              </div>

              <div className="rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
                <div className="font-semibold">Live dashboard</div>
                <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Store owner can monitor every order and call outcome.
                </div>
              </div>
            </div>
          </${SectionCard}>
        </div>
      </div>
    </div>
  `;
}