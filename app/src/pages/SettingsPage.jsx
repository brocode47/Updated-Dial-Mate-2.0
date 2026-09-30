import React from 'react';
import {
  Save,
  Store,
  Bot,
  MessageSquare,
  Phone,
  Shield,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Building2,
  Clock,
  Radio,
  Sliders,
  Sparkles,
  Wifi
} from 'lucide-react?deps=react';

import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { apiClient } from '../api/client.js';
import { ShopifyConnectModal } from '../components/ShopifyConnectModal.jsx';

export function SettingsPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [connectModalOpen, setConnectModalOpen] = React.useState(false);

  // Profile
  const [shopName, setShopName] = React.useState('');
  const [shopDomain, setShopDomain] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [logo, setLogo] = React.useState('');

  // AI Voice Persona
  const [aiName, setAiName] = React.useState('DialMate AI');
  const [tone, setTone] = React.useState('Professional & Courteous');
  const [language, setLanguage] = React.useState('Roman Urdu & English');
  const [fallbackMessage, setFallbackMessage] = React.useState('Assalam o Alaikum, main Dial Mate AI hoon.');

  // Business Rules
  const [workingHours, setWorkingHours] = React.useState('9:00 AM - 9:00 PM');
  const [escalationNumber, setEscalationNumber] = React.useState('+923001234567');
  const [autoCallOnOrder, setAutoCallOnOrder] = React.useState(true);
  const [maxRetries, setMaxRetries] = React.useState(2);

  // WhatsApp WA-AKG Info
  const [whatsappInfo, setWhatsappInfo] = React.useState({
    isConnected: false,
    sessionId: null,
    provider: 'WA-AKG',
    status: 'DISCONNECTED'
  });

  const hasToken = Boolean(typeof window !== 'undefined' && localStorage.getItem('dial-mate-token'));

  // Load existing persistent settings from backend
  const loadSettings = async () => {
    if (!hasToken) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await apiClient.get('/shop/settings');
      if (res) {
        if (res.profile) {
          setShopName(res.profile.shopName || '');
          setShopDomain(res.profile.shopDomain || '');
          setContact(res.profile.contact || '');
          setLogo(res.profile.logo || '');
        }
        if (res.aiSettings) {
          if (res.aiSettings.aiName) setAiName(res.aiSettings.aiName);
          if (res.aiSettings.tone) setTone(res.aiSettings.tone);
          if (res.aiSettings.language) setLanguage(res.aiSettings.language);
          if (res.aiSettings.fallbackMessage) setFallbackMessage(res.aiSettings.fallbackMessage);
        }
        if (res.businessRules) {
          if (res.businessRules.workingHours) setWorkingHours(res.businessRules.workingHours);
          if (res.businessRules.escalationNumber) setEscalationNumber(res.businessRules.escalationNumber);
          if (res.businessRules.autoCallOnOrder !== undefined) setAutoCallOnOrder(Boolean(res.businessRules.autoCallOnOrder));
          if (res.businessRules.maxRetries !== undefined) setMaxRetries(Number(res.businessRules.maxRetries));
        }
        if (res.whatsapp) {
          setWhatsappInfo(res.whatsapp);
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      pushToast('Unable to load settings from server.', 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadSettings();
  }, [hasToken]);

  const handleSaveSettings = async (e) => {
    e?.preventDefault();
    setSaving(true);

    try {
      const payload = {
        profile: {
          shopName: shopName.trim(),
          contact: contact.trim(),
          logo: logo.trim()
        },
        aiSettings: {
          aiName: aiName.trim(),
          tone: tone.trim(),
          language: language.trim(),
          fallbackMessage: fallbackMessage.trim()
        },
        businessRules: {
          workingHours: workingHours.trim(),
          escalationNumber: escalationNumber.trim(),
          autoCallOnOrder,
          maxRetries: Number(maxRetries)
        }
      };

      const res = await apiClient.put('/shop/settings', payload);
      if (res && res.ok) {
        pushToast('Settings saved to database successfully!', 'success');
        dispatch({
          type: 'SET_SHOP_INFO',
          shop: { name: shopName, domain: shopDomain }
        });
      } else {
        throw new Error(res.error || 'Server rejected settings update');
      }
    } catch (err) {
      pushToast(err.message || 'Failed to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerSync = async () => {
    try {
      setSyncing(true);
      pushToast('Syncing orders, customers, and catalog from Shopify...', 'default');
      const res = await apiClient.post('/shopify/sync', {});
      if (res && res.ok) {
        const synced = res.result || {};
        pushToast(`Sync complete! ${synced.ordersSynced || 0} orders, ${synced.customersSynced || 0} customers, ${synced.productsSynced || 0} products.`, 'success');
      }
    } catch (err) {
      pushToast(err.message || 'Sync failed.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = () => {
    if (window.confirm('Are you sure you want to disconnect this store and sign out?')) {
      apiClient.logout();
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 size={24} className="mx-auto animate-spin text-[hsl(var(--primary))]" />
        <div className="mt-2 text-xs text-[hsl(var(--foreground)/0.6)]">Loading configuration from server...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] md:text-3xl">
            Platform Settings & Configuration
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[hsl(var(--foreground)/0.65)]">
            Manage your Shopify connection, AI persona parameters, WhatsApp integration, and business calling rules.
          </p>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>Save Changes</span>
        </button>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Section 1: Store Connection & Shopify */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-[hsl(var(--border))]">
            <Store size={18} className="text-[hsl(var(--primary))]" />
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">Shopify Store Connection</h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Store Name</label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g. My Fashion Store"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Shopify Store Domain (Read Only)</label>
              <input
                type="text"
                value={shopDomain || 'Not connected'}
                readOnly
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] px-3 py-2 text-xs font-mono text-[hsl(var(--foreground)/0.7)] cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Support Contact Phone</label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="+92 300 1234567"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Brand Logo URL</label>
              <input
                type="url"
                value={logo}
                onChange={(e) => setLogo(e.target.value)}
                placeholder="https://..."
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[hsl(var(--border))]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConnectModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition"
              >
                <Store size={13} className="text-[hsl(var(--primary))]" />
                <span>Reconnect / Switch Shopify Store</span>
              </button>

              <button
                type="button"
                onClick={handleTriggerSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition disabled:opacity-50"
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                <span>Sync Store Data Now</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"
            >
              <LogOut size={13} />
              <span>Disconnect & Sign Out</span>
            </button>
          </div>
        </div>

        {/* Section 2: AI Voice Persona & Script Settings */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-[hsl(var(--border))]">
            <Bot size={18} className="text-[hsl(var(--primary))]" />
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">AI Voice Persona & Dialect</h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">AI Agent Name</label>
              <input
                type="text"
                value={aiName}
                onChange={(e) => setAiName(e.target.value)}
                placeholder="e.g. Zara / DialMate"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Tone of Voice</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value="Professional & Courteous">Professional & Courteous</option>
                <option value="Friendly & Energetic">Friendly & Energetic</option>
                <option value="Calm & Direct">Calm & Direct</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Spoken Language Mode</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value="Roman Urdu & English">Roman Urdu & English (Recommended for Pakistan)</option>
                <option value="Pure Urdu">Pure Urdu</option>
                <option value="English Only">English Only</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Calling Hours Window</label>
              <input
                type="text"
                value={workingHours}
                onChange={(e) => setWorkingHours(e.target.value)}
                placeholder="9:00 AM - 9:00 PM PKT"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                Initial Greeting & Fallback Response
              </label>
              <textarea
                rows={2}
                value={fallbackMessage}
                onChange={(e) => setFallbackMessage(e.target.value)}
                placeholder="Greeting spoken by AI when customer picks up call..."
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-2.5 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              />
              <p className="mt-1 text-[11px] text-[hsl(var(--foreground)/0.55)]">
                This prompt introduces your brand and presents the order confirmation in natural conversational Urdu.
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: Calling & Escalation Rules */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-[hsl(var(--border))]">
            <Phone size={18} className="text-[hsl(var(--primary))]" />
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">Calling Engine & Escalations</h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                Human Agent Transfer Phone Number
              </label>
              <input
                type="text"
                value={escalationNumber}
                onChange={(e) => setEscalationNumber(e.target.value)}
                placeholder="+92 300 0000000"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs font-mono outline-none focus:border-[hsl(var(--primary))] transition"
              />
              <p className="mt-1 text-[11px] text-[hsl(var(--foreground)/0.55)]">
                Calls where customer requests human escalation are transferred directly to this number.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Maximum Call Retries</label>
              <select
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value={1}>1 Retry (2 Total Attempts)</option>
                <option value={2}>2 Retries (3 Total Attempts - Recommended)</option>
                <option value={3}>3 Retries (4 Total Attempts)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 4: WhatsApp Integration Status */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-[hsl(var(--primary))]" />
              <h2 className="text-base font-bold text-[hsl(var(--foreground))]">WhatsApp (WA-AKG) Integration</h2>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                whatsappInfo.isConnected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${whatsappInfo.isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {whatsappInfo.isConnected ? 'Connected' : 'Offline / Standby'}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-lg bg-[hsl(var(--muted)/0.4)] p-3">
              <div className="text-[hsl(var(--foreground)/0.6)] font-medium">Provider</div>
              <div className="mt-1 font-bold text-[hsl(var(--foreground))]">{whatsappInfo.provider || 'WA-AKG'}</div>
            </div>

            <div className="rounded-lg bg-[hsl(var(--muted)/0.4)] p-3">
              <div className="text-[hsl(var(--foreground)/0.6)] font-medium">Session ID</div>
              <div className="mt-1 font-mono text-[hsl(var(--foreground))] truncate" title={whatsappInfo.sessionId || 'None'}>
                {whatsappInfo.sessionId || 'Default Session'}
              </div>
            </div>

            <div className="rounded-lg bg-[hsl(var(--muted)/0.4)] p-3">
              <div className="text-[hsl(var(--foreground)/0.6)] font-medium">WhatsApp Bridge</div>
              <div className="mt-1 text-emerald-600 dark:text-emerald-400 font-semibold">Active Pipeline</div>
            </div>
          </div>
        </div>

        {/* Submit Bar */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50 transition"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            <span>Save All Configuration</span>
          </button>
        </div>
      </form>

      <ShopifyConnectModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        defaultDomain={shopDomain}
      />
    </div>
  );
}