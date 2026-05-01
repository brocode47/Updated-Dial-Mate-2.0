import React from 'react';
import {
  Download,
  LockKeyhole,
  Shield,
  Store,
  Users,
  Mic,
  Image,
  Save,
  Trash2,
  CheckCircle2,
  Database,
  RefreshCw,
  Building2,
  Mail,
  UserRoundCog,
  Globe,
  Phone,
  Bell,
  CreditCard
} from 'lucide-react?deps=react';

import { html } from '../jsx.js';
import { useStore } from '../store.js';
import { useToast } from '../toast.js';
import { PageHeader } from '../components/PageHeader.js';
import { SectionCard } from '../components/SectionCard.js';

export function SettingsPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const [name, setName] = React.useState(state.session.user.name || '');
  const [email, setEmail] = React.useState(state.session.user.email || '');
  const [role, setRole] = React.useState(state.session.user.role || 'Owner');

  const [shopName, setShopName] = React.useState(state.session.shop.name || '');
  const [shopDomain, setShopDomain] = React.useState(state.session.shop.domain || '');
  const [shopPlan, setShopPlan] = React.useState(state.session.shop.plan || 'Starter');
  const [language, setLanguage] = React.useState(state.session.shop.language || 'Urdu First');

  const [supportPhone, setSupportPhone] = React.useState(state.session.shop.supportPhone || '');
  const [supportEmail, setSupportEmail] = React.useState(state.session.shop.supportEmail || '');
  const [timezone, setTimezone] = React.useState(state.session.shop.timezone || 'Asia/Karachi');

  const [backendUrl, setBackendUrl] = React.useState(
    state.backendUrl || 'https://leisa-celebrated-indefectibly.ngrok-free.dev'
  );

  const [checking, setChecking] = React.useState(false);
  const [backendStatus, setBackendStatus] = React.useState(null);

  React.useEffect(() => {
    setName(state.session.user.name || '');
    setEmail(state.session.user.email || '');
    setRole(state.session.user.role || 'Owner');

    setShopName(state.session.shop.name || '');
    setShopDomain(state.session.shop.domain || '');
    setShopPlan(state.session.shop.plan || state.billing.currentPlan || 'Starter');
    setLanguage(state.session.shop.language || 'Urdu First');

    setSupportPhone(state.session.shop.supportPhone || '');
    setSupportEmail(state.session.shop.supportEmail || '');
    setTimezone(state.session.shop.timezone || 'Asia/Karachi');
  }, [state.session.user, state.session.shop, state.billing.currentPlan]);

  const voices = [
    { id: 'urdu_female_v3', label: 'Urdu Female — Warm & polite' },
    { id: 'urdu_male_v3', label: 'Urdu Male — Confident & calm' },
    { id: 'urdu_female_v2', label: 'Urdu Female — Fast & energetic' }
  ];

  const onPickLogo = (file) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      pushToast('Please select an image file.', 'default');
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      dispatch({ type: 'UPDATE_LOGO', logoDataUrl: String(reader.result || '') });
      pushToast('Logo updated.', 'success');
    };

    reader.onerror = () => pushToast('Could not read that file.', 'default');
    reader.readAsDataURL(file);
  };

  const saveAccount = () => {
    dispatch({
      type: 'UPDATE_ACCOUNT',
      user: {
        name: String(name || '').trim() || 'Store Owner',
        email: String(email || '').trim() || 'owner@example.com',
        role: String(role || '').trim() || 'Owner'
      }
    });

    pushToast('Account settings saved.', 'success');
  };

  const saveStoreProfile = () => {
    dispatch({
      type: 'SET_SHOP_INFO',
      shop: {
        name: String(shopName || '').trim() || 'Your Store',
        domain: String(shopDomain || '').trim(),
        plan: String(shopPlan || '').trim() || 'Starter',
        language: String(language || '').trim() || 'Urdu First',
        supportPhone: String(supportPhone || '').trim(),
        supportEmail: String(supportEmail || '').trim(),
        timezone: String(timezone || '').trim() || 'Asia/Karachi'
      }
    });

    pushToast('Store profile saved.', 'success');
  };

  const saveBackend = () => {
    dispatch({
      type: 'SET_BACKEND_URL',
      url: backendUrl.replace(/\/$/, '')
    });

    pushToast('Backend URL saved.', 'success');
  };

  const checkBackend = async () => {
    try {
      setChecking(true);
      setBackendStatus(null);

      const base = backendUrl.replace(/\/$/, '');

      const res = await fetch(`${base}/api/health`, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });

      if (!res.ok) throw new Error('Backend health check failed');

      setBackendStatus('online');
      pushToast('Backend is online.', 'success');
    } catch (err) {
      console.error(err);
      setBackendStatus('offline');
      pushToast('Backend check failed.', 'error');
    } finally {
      setChecking(false);
    }
  };

  const downloadSummary = () => {
    const summary = {
      generatedAt: new Date().toISOString(),
      shop: state.session.shop,
      account: state.session.user,
      backendUrl,
      voice: state.voice,
      scripts: state.scripts,
      billing: state.billing,
      onboarding: state.onboarding
    };

    const blob = new Blob([JSON.stringify(summary, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `dial-mate-settings-summary-${state.session.shop.domain || 'store'}.json`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    pushToast('Settings summary downloaded.', 'success');
  };

  return html`
    <div className="fade-up space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <${PageHeader}
          eyebrow="Configuration"
          title="Settings"
          description="Manage your store profile, account details, backend connection, logo, Urdu voice settings, and operational preferences."
        />

        <button
          onClick=${downloadSummary}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white shadow-medium sm:w-auto"
        >
          <${Download} size=${16} />
          Download summary
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <${SectionCard} title="Store profile" subtitle="Shown across dashboard, sidebar, exports, and client-facing settings">
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Shop name</span>
              <div className="relative">
                <${Building2} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  value=${shopName}
                  onChange=${(e) => setShopName(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                  placeholder="Your store name"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Shopify domain</span>
              <div className="relative">
                <${Store} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  value=${shopDomain}
                  onChange=${(e) => setShopDomain(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                  placeholder="your-store.myshopify.com"
                />
              </div>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Current plan</span>
                <select
                  value=${shopPlan}
                  onChange=${(e) => setShopPlan(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
                >
                  <option value="Starter">Starter</option>
                  <option value="Growth">Growth</option>
                  <option value="Scale">Scale</option>
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium">Primary language</span>
                <select
                  value=${language}
                  onChange=${(e) => setLanguage(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
                >
                  <option value="Urdu First">Urdu First</option>
                  <option value="Roman Urdu">Roman Urdu</option>
                  <option value="English + Urdu">English + Urdu</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Support phone</span>
                <div className="relative">
                  <${Phone} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                  <input
                    value=${supportPhone}
                    onChange=${(e) => setSupportPhone(e.target.value)}
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                    placeholder="+92..."
                  />
                </div>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium">Support email</span>
                <div className="relative">
                  <${Mail} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                  <input
                    value=${supportEmail}
                    onChange=${(e) => setSupportEmail(e.target.value)}
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                    placeholder="support@yourstore.com"
                  />
                </div>
              </label>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Timezone</span>
              <div className="relative">
                <${Globe} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                <select
                  value=${timezone}
                  onChange=${(e) => setTimezone(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                >
                  <option value="Asia/Karachi">Asia/Karachi</option>
                  <option value="Asia/Dubai">Asia/Dubai</option>
                  <option value="Asia/Riyadh">Asia/Riyadh</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </div>
            </label>

            <button
              onClick=${saveStoreProfile}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white sm:w-fit"
            >
              <${Save} size=${16} />
              Save store profile
            </button>
          </div>
        </${SectionCard}>

        <${SectionCard} title="Account settings" subtitle="Update operator profile shown in the top-right menu">
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Name</span>
              <div className="relative">
                <${UserRoundCog} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  value=${name}
                  onChange=${(e) => setName(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                  placeholder="Full name"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Email</span>
              <div className="relative">
                <${Mail} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  value=${email}
                  onChange=${(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
                  placeholder="Email address"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Role</span>
              <select
                value=${role}
                onChange=${(e) => setRole(e.target.value)}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
              >
                <option value="Owner">Owner</option>
                <option value="Admin">Admin</option>
                <option value="Operations">Operations</option>
                <option value="Support">Support</option>
              </select>
            </label>

            <button
              onClick=${saveAccount}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white sm:w-fit"
            >
              <${Save} size=${16} />
              Save account
            </button>
          </div>
        </${SectionCard}>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <${SectionCard} title="Backend connection" subtitle="Used by dashboard, orders, calls, and onboarding">
          <div className="space-y-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Backend API URL</span>
              <input
                value=${backendUrl}
                onChange=${(e) => setBackendUrl(e.target.value)}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
                placeholder="https://your-backend-domain.com"
              />
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick=${saveBackend}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white"
              >
                <${Save} size=${16} />
                Save backend URL
              </button>

              <button
                onClick=${checkBackend}
                disabled=${checking}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                ${checking
                  ? html`<${RefreshCw} size=${16} className="animate-spin" />`
                  : html`<${Database} size=${16} />`}
                Test connection
              </button>
            </div>

            ${backendStatus ? html`
              <div className=${`rounded-2xl p-4 text-sm font-semibold ${
                backendStatus === 'online'
                  ? 'bg-emerald-500/12 text-emerald-600'
                  : 'bg-red-500/12 text-red-600'
              }`}>
                ${backendStatus === 'online' ? 'Backend is online' : 'Backend is offline'}
              </div>
            ` : null}
          </div>
        </${SectionCard}>

        <${SectionCard} title="Branding" subtitle="Upload logo for sidebar, top menu, exports, and client handoff">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                ${state.branding.logoDataUrl
                  ? html`<img src=${state.branding.logoDataUrl} alt="Logo preview" className="h-full w-full object-cover" />`
                  : html`<${Image} size=${24} className="text-[hsl(var(--foreground)/0.45)]" />`}
              </div>

              <div>
                <div className="font-semibold">Company logo</div>
                <div className="text-sm text-[hsl(var(--foreground)/0.62)]">PNG, JPG, or SVG</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange=${(e) => onPickLogo(e.target.files && e.target.files[0])}
                />
                Change logo
              </label>

              ${state.branding.logoDataUrl ? html`
                <button
                  onClick=${() => {
                    dispatch({ type: 'UPDATE_LOGO', logoDataUrl: null });
                    pushToast('Logo removed.', 'success');
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold"
                >
                  <${Trash2} size=${16} />
                  Remove
                </button>
              ` : null}
            </div>
          </div>
        </${SectionCard}>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <${SectionCard} title="Voice calling" subtitle="Choose Urdu voice persona">
          <div className="space-y-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Voice</span>
              <select
                value=${state.voice.voiceId}
                onChange=${(e) => {
                  dispatch({ type: 'UPDATE_VOICE', voiceId: e.target.value });
                  pushToast('Voice updated.', 'success');
                }}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
              >
                ${voices.map((v) => html`
                  <option key=${v.id} value=${v.id}>${v.label}</option>
                `)}
              </select>
            </label>

            <div className="flex items-start gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4 text-sm">
              <${Mic} size=${18} className="mt-0.5 text-[hsl(var(--primary))]" />
              <div>
                <div className="font-semibold">Selected voice</div>
                <div className="mt-1 break-all text-[hsl(var(--foreground)/0.65)]">
                  ${state.voice.voiceId}
                </div>
              </div>
            </div>
          </div>
        </${SectionCard}>

        <${SectionCard} title="Agent scripts" subtitle="Edit Urdu confirmation and cancellation scripts">
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Confirmation script</span>
              <textarea
                rows=${6}
                value=${state.scripts.confirmationUrdu}
                onChange=${(e) =>
                  dispatch({
                    type: 'UPDATE_SCRIPT',
                    key: 'confirmationUrdu',
                    value: e.target.value
                  })}
                className="w-full resize-none rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
              ></textarea>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Cancellation script</span>
              <textarea
                rows=${6}
                value=${state.scripts.cancellationUrdu}
                onChange=${(e) =>
                  dispatch({
                    type: 'UPDATE_SCRIPT',
                    key: 'cancellationUrdu',
                    value: e.target.value
                  })}
                className="w-full resize-none rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
              ></textarea>
            </label>
          </div>
        </${SectionCard}>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <${SectionCard} title="Notification preferences" subtitle="Client-facing notification settings for future email, SMS, and in-app alerts">
          <div className="grid gap-3">
            ${[
              ['Order created alerts', 'Notify when Shopify sends a new order webhook.'],
              ['Failed call alerts', 'Notify when a call fails, is busy, or receives no answer.'],
              ['Retry limit alerts', 'Notify when max retries are reached.'],
              ['Billing alerts', 'Notify when usage approaches plan limits.']
            ].map(([title, body]) => html`
              <div key=${title} className="flex items-start gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
                <${Bell} size=${18} className="mt-0.5 text-[hsl(var(--primary))]" />
                <div>
                  <div className="font-semibold">${title}</div>
                  <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">${body}</div>
                </div>
              </div>
            `)}
          </div>
        </${SectionCard}>

        <${SectionCard} title="Billing and access" subtitle="Operational settings needed for a real SaaS rollout">
          <div className="grid gap-3">
            <div className="flex items-start gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
              <${CreditCard} size=${18} className="mt-0.5 text-[hsl(var(--primary))]" />
              <div>
                <div className="font-semibold">Active plan</div>
                <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                  ${state.billing.currentPlan || shopPlan || 'Starter'} plan selected. Shopify Billing or Stripe checkout can be connected during deployment.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
              <${Users} size=${18} className="mt-0.5 text-[hsl(var(--primary))]" />
              <div>
                <div className="font-semibold">Team access</div>
                <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Owner, Admin, Operations, and Support roles are prepared for multi-user SaaS mode.
                </div>
              </div>
            </div>
          </div>
        </${SectionCard}>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <${SectionCard} title="Security posture" subtitle="Audit and webhook safety">
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
              <${Shield} size=${18} className="mt-0.5 text-[hsl(var(--primary))]" />
              <div>
                <div className="font-semibold">Webhook verification enabled</div>
                <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Shopify webhook HMAC verification protects order events.
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
              <${LockKeyhole} size=${18} className="mt-0.5 text-[hsl(var(--primary))]" />
              <div>
                <div className="font-semibold">Environment secrets</div>
                <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.65)]">
                  Shopify and Twilio credentials remain on the backend only.
                </div>
              </div>
            </div>
          </div>
        </${SectionCard}>

        <${SectionCard} title="Team access" subtitle="Current access list">
          <div className="space-y-3">
            ${state.team.map((member) => html`
              <div key=${member.id} className="flex flex-col gap-3 rounded-3xl border border-[hsl(var(--border))] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] font-semibold text-[hsl(var(--primary))]">
                    ${member.name.split(' ').map((part) => part[0]).join('')}
                  </div>

                  <div>
                    <div className="font-semibold">${member.name}</div>
                    <div className="text-sm text-[hsl(var(--foreground)/0.62)]">${member.role}</div>
                  </div>
                </div>

                <span className=${`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                  member.status === 'Active'
                    ? 'bg-emerald-500/12 text-emerald-600'
                    : 'bg-amber-500/12 text-amber-600'
                }`}>
                  ${member.status}
                </span>
              </div>
            `)}
          </div>
        </${SectionCard}>
      </div>
    </div>
  `;
}