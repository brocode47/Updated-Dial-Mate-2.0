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

  // Phase 4: Automated AI Calling
  const [aiCallingEnabled, setAiCallingEnabled] = React.useState(true);
  const [maxAttempts, setMaxAttempts] = React.useState(3);
  const [retryDelayMinutes, setRetryDelayMinutes] = React.useState(15);
  const [callingHours, setCallingHours] = React.useState('09:00 - 21:00');
  const [callingDays, setCallingDays] = React.useState('All Days (Mon-Sun)');

  // Phase 4: Order Qualification Rules
  const [codOnly, setCodOnly] = React.useState(true);
  const [minOrderValue, setMinOrderValue] = React.useState(0);
  const [maxOrderValue, setMaxOrderValue] = React.useState(500000);
  const [excludedTags, setExcludedTags] = React.useState('VIP, PREPAID, NO_CALL');

  // Phase 4: WhatsApp Fallback
  const [enableWhatsappFallback, setEnableWhatsappFallback] = React.useState(true);
  const [templateLanguage, setTemplateLanguage] = React.useState('roman_urdu');
  const [customWhatsappTemplate, setCustomWhatsappTemplate] = React.useState(
    'Assalam o Alaikum {customerName}! Aap ke order #{orderNumber} ki confirmation darkaar hai. Barah-e-karam reply kar dein ke order confirm hai ya cancel.'
  );

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
        if (res.aiCalling) {
          if (res.aiCalling.enabled !== undefined) setAiCallingEnabled(Boolean(res.aiCalling.enabled));
          if (res.aiCalling.maxAttempts !== undefined) setMaxAttempts(Number(res.aiCalling.maxAttempts));
          if (res.aiCalling.retryDelayMinutes !== undefined) setRetryDelayMinutes(Number(res.aiCalling.retryDelayMinutes));
          if (res.aiCalling.callingHours) setCallingHours(res.aiCalling.callingHours);
          if (res.aiCalling.callingDays) setCallingDays(res.aiCalling.callingDays);
        }
        if (res.orderRules) {
          if (res.orderRules.codOnly !== undefined) setCodOnly(Boolean(res.orderRules.codOnly));
          if (res.orderRules.minOrderValue !== undefined) setMinOrderValue(Number(res.orderRules.minOrderValue));
          if (res.orderRules.maxOrderValue !== undefined) setMaxOrderValue(Number(res.orderRules.maxOrderValue));
          if (res.orderRules.excludedTags) setExcludedTags(res.orderRules.excludedTags);
        }
        if (res.whatsapp) {
          setWhatsappInfo(res.whatsapp);
          if (res.whatsapp.enableFallback !== undefined) setEnableWhatsappFallback(Boolean(res.whatsapp.enableFallback));
          if (res.whatsapp.templateLanguage) setTemplateLanguage(res.whatsapp.templateLanguage);
          if (res.whatsapp.customTemplate) setCustomWhatsappTemplate(res.whatsapp.customTemplate);
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
        },
        aiCalling: {
          enabled: aiCallingEnabled,
          maxAttempts: Number(maxAttempts),
          retryDelayMinutes: Number(retryDelayMinutes),
          callingHours: callingHours.trim(),
          callingDays: callingDays.trim(),
          language: language.trim()
        },
        orderRules: {
          codOnly,
          minOrderValue: Number(minOrderValue),
          maxOrderValue: Number(maxOrderValue),
          excludedTags: excludedTags.trim()
        },
        whatsapp: {
          enableFallback: enableWhatsappFallback,
          templateLanguage,
          customTemplate: customWhatsappTemplate.trim()
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

        {/* Section 3: Automated AI Calling Configuration */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-2">
              <Phone size={18} className="text-[hsl(var(--primary))]" />
              <h2 className="text-base font-bold text-[hsl(var(--foreground))]">Automated AI Calling Engine</h2>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiCallingEnabled}
                onChange={(e) => setAiCallingEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[hsl(var(--muted))] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[hsl(var(--primary))]"></div>
              <span className="ml-2 text-xs font-semibold text-[hsl(var(--foreground))]">
                {aiCallingEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Maximum Call Attempts</label>
              <select
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value={1}>1 Attempt (No retries)</option>
                <option value={2}>2 Attempts</option>
                <option value={3}>3 Attempts (Recommended)</option>
                <option value={4}>4 Attempts</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Retry Delay Between Attempts</label>
              <select
                value={retryDelayMinutes}
                onChange={(e) => setRetryDelayMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value={10}>10 Minutes</option>
                <option value={15}>15 Minutes (Recommended)</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>60 Minutes (1 Hour)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Calling Hours Window</label>
              <input
                type="text"
                value={callingHours}
                onChange={(e) => setCallingHours(e.target.value)}
                placeholder="09:00 - 21:00"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs font-mono outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Operating Calling Days</label>
              <select
                value={callingDays}
                onChange={(e) => setCallingDays(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value="All Days (Mon-Sun)">All Days (Mon-Sun)</option>
                <option value="Monday - Saturday">Monday - Saturday</option>
                <option value="Monday - Friday">Monday - Friday</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                Human Agent Escalation Phone
              </label>
              <input
                type="text"
                value={escalationNumber}
                onChange={(e) => setEscalationNumber(e.target.value)}
                placeholder="+92 300 0000000"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs font-mono outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>
          </div>
        </div>

        {/* Section 4: COD Order Qualification & Eligibility Rules */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-[hsl(var(--border))]">
            <Shield size={18} className="text-[hsl(var(--primary))]" />
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">Order Eligibility & Qualification Rules</h2>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] p-3">
              <input
                type="checkbox"
                id="codOnly"
                checked={codOnly}
                onChange={(e) => setCodOnly(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]"
              />
              <label htmlFor="codOnly" className="cursor-pointer">
                <div className="text-xs font-bold text-[hsl(var(--foreground))]">Cash on Delivery (COD) Only</div>
                <div className="text-[11px] text-[hsl(var(--foreground)/0.6)]">Skip prepaid and online paid orders</div>
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Minimum Order Value (PKR)</label>
              <input
                type="number"
                value={minOrderValue}
                onChange={(e) => setMinOrderValue(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs font-mono outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Maximum Order Value (PKR)</label>
              <input
                type="number"
                value={maxOrderValue}
                onChange={(e) => setMaxOrderValue(e.target.value)}
                placeholder="500000"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs font-mono outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                Excluded Shopify Tags (Comma-separated)
              </label>
              <input
                type="text"
                value={excludedTags}
                onChange={(e) => setExcludedTags(e.target.value)}
                placeholder="VIP, PREPAID, NO_CALL, VERIFIED"
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition font-mono"
              />
              <p className="mt-1 text-[11px] text-[hsl(var(--foreground)/0.55)]">
                Orders containing any of these Shopify tags will be excluded from automated AI calling.
              </p>
            </div>
          </div>
        </div>

        {/* Section 5: WhatsApp Fallback Automation */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-[hsl(var(--primary))]" />
              <h2 className="text-base font-bold text-[hsl(var(--foreground))]">WhatsApp Fallback (WA-AKG)</h2>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  whatsappInfo.isConnected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${whatsappInfo.isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {whatsappInfo.isConnected ? 'Bridge Active' : 'Standby'}
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableWhatsappFallback}
                  onChange={(e) => setEnableWhatsappFallback(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[hsl(var(--muted))] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[hsl(var(--primary))]"></div>
                <span className="ml-2 text-xs font-semibold text-[hsl(var(--foreground))]">
                  {enableWhatsappFallback ? 'Fallback On' : 'Fallback Off'}
                </span>
              </label>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">Template Language</label>
              <select
                value={templateLanguage}
                onChange={(e) => setTemplateLanguage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              >
                <option value="roman_urdu">Roman Urdu (Standard)</option>
                <option value="urdu">Urdu Script</option>
                <option value="english">English</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">WA-AKG Integration Session</label>
              <input
                type="text"
                readOnly
                value={whatsappInfo.sessionId || 'Default WA-AKG Bridge'}
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] px-3 py-2 text-xs font-mono text-[hsl(var(--foreground)/0.7)] cursor-not-allowed"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                Fallback WhatsApp Message Template
              </label>
              <textarea
                rows={3}
                value={customWhatsappTemplate}
                onChange={(e) => setCustomWhatsappTemplate(e.target.value)}
                placeholder="Assalam o Alaikum! Aap ke order #{orderNumber} ki confirmation darkaar hai..."
                className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-2.5 text-xs outline-none focus:border-[hsl(var(--primary))] transition font-mono leading-relaxed"
              />
              <p className="mt-1 text-[11px] text-[hsl(var(--foreground)/0.55)]">
                Available variables: {'{customerName}'}, {'{orderNumber}'}, {'{orderTotal}'}, {'{shopName}'}. Dispatched when call attempts remain unanswered.
              </p>
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