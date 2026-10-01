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
  Wifi,
  Copy,
  ExternalLink,
  ChevronRight,
  Check,
  Smartphone,
  Calendar,
  Layers,
  Globe
} from 'lucide-react?deps=react';

import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { apiClient } from '../api/client.js';
import { ShopifyConnectModal } from '../components/ShopifyConnectModal.jsx';
import { ConfirmationModal } from '../components/ui/ConfirmationModal.jsx';
import { Badge } from '../components/ui/Badge.jsx';

export function SettingsPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const [activeTab, setActiveTab] = React.useState('store');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [connectModalOpen, setConnectModalOpen] = React.useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState(null);

  // Store Profile
  const [shopName, setShopName] = React.useState('');
  const [shopDomain, setShopDomain] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [logo, setLogo] = React.useState('');

  // AI Voice Persona
  const [aiName, setAiName] = React.useState('Zara');
  const [tone, setTone] = React.useState('Professional & Courteous');
  const [language, setLanguage] = React.useState('Roman Urdu & English');
  const [fallbackMessage, setFallbackMessage] = React.useState(
    'Assalam o Alaikum! Main {shopName} se baat kar rahi hoon. Aap ka Cash on Delivery order confirm karne ke liye call kiya hai.'
  );

  // Calling Rules
  const [aiCallingEnabled, setAiCallingEnabled] = React.useState(true);
  const [maxAttempts, setMaxAttempts] = React.useState(3);
  const [retryDelayMinutes, setRetryDelayMinutes] = React.useState(15);
  const [autoCallOnOrder, setAutoCallOnOrder] = React.useState(true);
  const [escalationNumber, setEscalationNumber] = React.useState('+923001234567');

  // Business Hours
  const [callingHoursStart, setCallingHoursStart] = React.useState('09:00');
  const [callingHoursEnd, setCallingHoursEnd] = React.useState('21:00');
  const [callingDays, setCallingDays] = React.useState('All Days (Mon-Sun)');
  const [allowWeekendCalling, setAllowWeekendCalling] = React.useState(true);

  // COD Rules
  const [codOnly, setCodOnly] = React.useState(true);
  const [minOrderValue, setMinOrderValue] = React.useState(0);
  const [maxOrderValue, setMaxOrderValue] = React.useState(500000);
  const [excludedTags, setExcludedTags] = React.useState('VIP, PREPAID, NO_CALL');
  const [autoCancelHighRisk, setAutoCancelHighRisk] = React.useState(false);

  // WhatsApp Fallback
  const [enableWhatsappFallback, setEnableWhatsappFallback] = React.useState(true);
  const [templateLanguage, setTemplateLanguage] = React.useState('roman_urdu');
  const [customWhatsappTemplate, setCustomWhatsappTemplate] = React.useState(
    'Assalam o Alaikum {customerName}! Aap ke order #{orderNumber} (Rs. {orderTotal}) ki confirmation darkaar hai. Barah-e-karam reply karein: 1 for Confirm, 2 for Cancel.'
  );

  // WhatsApp WA-AKG Info
  const [whatsappInfo, setWhatsappInfo] = React.useState({
    isConnected: true,
    sessionId: 'WA-AKG-PROD-GATEWAY',
    provider: 'WA-AKG',
    status: 'CONNECTED'
  });

  // Track initial snapshot for isDirty check
  const [initialSnapshot, setInitialSnapshot] = React.useState(null);

  const hasToken = Boolean(typeof window !== 'undefined' && localStorage.getItem('dial-mate-token'));

  // Load settings from backend
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
          if (res.businessRules.escalationNumber) setEscalationNumber(res.businessRules.escalationNumber);
          if (res.businessRules.autoCallOnOrder !== undefined) setAutoCallOnOrder(Boolean(res.businessRules.autoCallOnOrder));
        }
        if (res.aiCalling) {
          if (res.aiCalling.enabled !== undefined) setAiCallingEnabled(Boolean(res.aiCalling.enabled));
          if (res.aiCalling.maxAttempts !== undefined) setMaxAttempts(Number(res.aiCalling.maxAttempts));
          if (res.aiCalling.retryDelayMinutes !== undefined) setRetryDelayMinutes(Number(res.aiCalling.retryDelayMinutes));
          if (res.aiCalling.callingDays) setCallingDays(res.aiCalling.callingDays);
          if (res.aiCalling.callingHours) {
            const parts = res.aiCalling.callingHours.split('-').map(s => s.trim());
            if (parts.length === 2) {
              setCallingHoursStart(parts[0]);
              setCallingHoursEnd(parts[1]);
            }
          }
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

        setInitialSnapshot(JSON.stringify(res));
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
          workingHours: `${callingHoursStart} - ${callingHoursEnd}`,
          escalationNumber: escalationNumber.trim(),
          autoCallOnOrder,
          maxRetries: Number(maxAttempts)
        },
        aiCalling: {
          enabled: aiCallingEnabled,
          maxAttempts: Number(maxAttempts),
          retryDelayMinutes: Number(retryDelayMinutes),
          callingHours: `${callingHoursStart} - ${callingHoursEnd}`,
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
        pushToast('Enterprise configuration saved and active!', 'success');
        setInitialSnapshot(JSON.stringify(payload));
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

  const handleDisconnectConfirm = () => {
    setDisconnectModalOpen(false);
    apiClient.logout();
  };

  const copyText = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    pushToast('Copied to clipboard', 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const insertVariable = (variable) => {
    setCustomWhatsappTemplate((prev) => `${prev} ${variable}`);
  };

  const tabs = [
    { id: 'store', label: 'Store Settings', icon: Store, desc: 'Shopify OAuth & Profile' },
    { id: 'ai', label: 'AI Voice Agent', icon: Bot, desc: 'Urdu Persona & Tone' },
    { id: 'calling', label: 'Calling Rules', icon: Phone, desc: 'Retries & Escalations' },
    { id: 'cod', label: 'COD Rules', icon: Shield, desc: 'Order Eligibility & Limits' },
    { id: 'hours', label: 'Business Hours', icon: Clock, desc: 'Calling Windows & Days' },
    { id: 'whatsapp', label: 'WhatsApp Integration', icon: MessageSquare, desc: 'WA-AKG Fallback & Script' },
    { id: 'twilio', label: 'Twilio Configuration', icon: Wifi, desc: 'Telephony & Webhooks' }
  ];

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 mx-auto animate-spin text-indigo-600" />
        <div className="mt-3 text-sm font-medium text-slate-600">Loading enterprise configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl pb-16">
      {/* Enterprise Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Sliders className="w-3 h-3 text-indigo-600" />
              Enterprise Preferences
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-xs font-mono text-slate-500">Live Production Sync</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Platform Settings & Rules Engine
          </h1>
          <p className="text-sm text-slate-500">
            Configure automated Urdu confirmation calling, Gemini voice persona, COD qualification filters, and WhatsApp fallbacks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs hover:shadow transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save All Settings</span>
          </button>
        </div>
      </div>

      {/* Main Settings Layout: Left Nav + Right Pane */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Navigation Sidebar */}
        <div className="md:col-span-4 lg:col-span-3 space-y-1.5">
          <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-xs space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-indigo-50/80 text-indigo-900 border border-indigo-200/80 font-semibold shadow-xs'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate">{tab.label}</div>
                    <div className="text-[10px] text-slate-400 truncate">{tab.desc}</div>
                  </div>
                  {isActive && <ChevronRight className="w-4 h-4 text-indigo-600 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Quick System Status Card */}
          <div className="bg-slate-900 text-slate-300 rounded-2xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                Live Engines
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                Active
              </span>
            </div>
            <div className="space-y-1.5 text-[11px] font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Shopify OAuth:</span>
                <span className="text-emerald-400">Connected</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Twilio Carrier:</span>
                <span className="text-emerald-400">Dry-Run (Active)</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>WhatsApp Bridge:</span>
                <span className="text-emerald-400">WA-AKG Ready</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Content Form Pane */}
        <div className="md:col-span-8 lg:col-span-9">
          <form onSubmit={handleSaveSettings} className="space-y-6">
            {/* 1. STORE SETTINGS */}
            {activeTab === 'store' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Shopify Store Profile</h2>
                    <p className="text-xs text-slate-500">Connected store identity and metadata synced with Shopify Admin.</p>
                  </div>
                  <Badge variant="success">Store Active</Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Store Brand Name</label>
                    <input
                      type="text"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      placeholder="e.g. Sunday Bazaar Official"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Shopify Domain (Verified via OAuth)</label>
                    <div className="relative mt-1.5">
                      <input
                        type="text"
                        value={shopDomain || '0qwck2-s1.myshopify.com'}
                        readOnly
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-600 cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => copyText(shopDomain, 'domain')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                        title="Copy domain"
                      >
                        {copiedKey === 'domain' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Support / Escalation Phone</label>
                    <input
                      type="text"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder="+92 300 1234567"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Brand Logo URL</label>
                    <input
                      type="url"
                      value={logo}
                      onChange={(e) => setLogo(e.target.value)}
                      placeholder="https://yourstore.com/logo.png"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTriggerSync}
                      disabled={syncing}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold shadow-xs transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-indigo-600' : ''}`} />
                      <span>{syncing ? 'Syncing...' : 'Sync Store Data Now'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConnectModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition"
                    >
                      <Store className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Switch Shopify Store</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDisconnectModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Disconnect & Logout</span>
                  </button>
                </div>
              </div>
            )}

            {/* 2. AI AGENT PERSONA */}
            {activeTab === 'ai' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">AI Voice Persona & Urdu Dialect</h2>
                    <p className="text-xs text-slate-500">Configure how the AI agent speaks, sounds, and handles order inquiries.</p>
                  </div>
                  <Badge variant="primary">Gemini 2.0 Telephony</Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">AI Agent Representative Name</label>
                    <input
                      type="text"
                      value={aiName}
                      onChange={(e) => setAiName(e.target.value)}
                      placeholder="e.g. Zara or Ayesha"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Name introduced to customers during the opening greeting.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Voice Tone & Style</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    >
                      <option value="Professional & Courteous">Professional & Courteous (Recommended)</option>
                      <option value="Warm & Friendly">Warm & Friendly (High Conversion)</option>
                      <option value="Calm & Direct">Calm & Direct (Short Duration)</option>
                      <option value="Urgent & Clear">Urgent & Clear</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">Spoken Language Mode</label>
                    <div className="grid sm:grid-cols-3 gap-3 mt-1.5">
                      {[
                        { id: 'Roman Urdu & English', label: 'Roman Urdu & English', desc: 'Bilingual conversational mix (Standard for Pakistani E-Commerce)' },
                        { id: 'Pure Urdu', label: 'Urdu Script Voice', desc: 'Formal Urdu dialect with clear pronunciation' },
                        { id: 'English Only', label: 'English Only', desc: 'International accent for overseas clientele' }
                      ].map((langOpt) => (
                        <div
                          key={langOpt.id}
                          onClick={() => setLanguage(langOpt.id)}
                          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                            language === langOpt.id
                              ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">{langOpt.label}</span>
                            {language === langOpt.id && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">{langOpt.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Opening Spoken Greeting & Dialogue Prompt
                    </label>
                    <textarea
                      rows={3}
                      value={fallbackMessage}
                      onChange={(e) => setFallbackMessage(e.target.value)}
                      placeholder="Opening line spoken when customer answers..."
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 leading-relaxed font-sans"
                    />
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Supports variables: <code className="text-indigo-600">{'{shopName}'}</code>, <code className="text-indigo-600">{'{customerName}'}</code>, <code className="text-indigo-600">{'{orderTotal}'}</code>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 3. CALLING RULES */}
            {activeTab === 'calling' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Outbound Calling Automation & Retries</h2>
                    <p className="text-xs text-slate-500">Configure BullMQ queue behavior, retry intervals, and maximum dialing attempts.</p>
                  </div>
                  {/* Master Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiCallingEnabled}
                      onChange={(e) => setAiCallingEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    <span className="ml-2.5 text-xs font-bold text-slate-800">
                      {aiCallingEnabled ? 'Calls Active' : 'Calls Paused'}
                    </span>
                  </label>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">Trigger on New Order</span>
                      <input
                        type="checkbox"
                        checked={autoCallOnOrder}
                        onChange={(e) => setAutoCallOnOrder(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Automatically place incoming Shopify COD orders into the BullMQ dialer queue within 60 seconds of order creation.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Maximum Call Attempts</label>
                    <select
                      value={maxAttempts}
                      onChange={(e) => setMaxAttempts(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    >
                      <option value={1}>1 Attempt (No retries on busy/no-answer)</option>
                      <option value={2}>2 Attempts</option>
                      <option value={3}>3 Attempts (Recommended)</option>
                      <option value={4}>4 Attempts (Aggressive)</option>
                    </select>
                    <p className="mt-1 text-[11px] text-slate-400">After maximum attempts fail, WhatsApp fallback triggers automatically.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Retry Delay Interval</label>
                    <select
                      value={retryDelayMinutes}
                      onChange={(e) => setRetryDelayMinutes(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    >
                      <option value={10}>10 Minutes</option>
                      <option value={15}>15 Minutes (Optimal)</option>
                      <option value={30}>30 Minutes</option>
                      <option value={60}>60 Minutes (1 Hour)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Human Escalation Phone Number</label>
                    <input
                      type="text"
                      value={escalationNumber}
                      onChange={(e) => setEscalationNumber(e.target.value)}
                      placeholder="+92 300 0000000"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Called if customer requests immediate human representative transfer.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 4. COD RULES */}
            {activeTab === 'cod' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Cash on Delivery (COD) Qualification</h2>
                    <p className="text-xs text-slate-500">Filter which orders are eligible for automated calls vs skipped.</p>
                  </div>
                  <Badge variant="warning">RTO Prevention Engine</Badge>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-slate-900">Cash on Delivery (COD) Exclusivity</div>
                        <div className="text-[11px] text-slate-500">Only trigger calls for orders placed with COD payment gateway.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={codOnly}
                        onChange={(e) => setCodOnly(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Minimum Order Value (PKR)</label>
                    <input
                      type="number"
                      value={minOrderValue}
                      onChange={(e) => setMinOrderValue(e.target.value)}
                      placeholder="0"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Orders below this amount will skip calling.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Maximum Order Value (PKR)</label>
                    <input
                      type="number"
                      value={maxOrderValue}
                      onChange={(e) => setMaxOrderValue(e.target.value)}
                      placeholder="500000"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">High-value ceiling for automated processing.</p>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">Excluded Shopify Tags (Comma-separated)</label>
                    <input
                      type="text"
                      value={excludedTags}
                      onChange={(e) => setExcludedTags(e.target.value)}
                      placeholder="VIP, PREPAID, NO_CALL, VERIFIED"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {excludedTags.split(',').filter(t => t.trim()).map((tag, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-mono font-medium">
                          {tag.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. BUSINESS HOURS */}
            {activeTab === 'hours' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Calling Hours & Operating Schedule</h2>
                    <p className="text-xs text-slate-500">Prevent disturbing customers outside socially acceptable hours in Pakistan.</p>
                  </div>
                  <Badge variant="neutral">Asia/Karachi (PKT, UTC+5)</Badge>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Calling Window Start Time (PKT)</label>
                    <input
                      type="time"
                      value={callingHoursStart}
                      onChange={(e) => setCallingHoursStart(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Calling Window End Time (PKT)</label>
                    <input
                      type="time"
                      value={callingHoursEnd}
                      onChange={(e) => setCallingHoursEnd(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">Operating Days</label>
                    <select
                      value={callingDays}
                      onChange={(e) => setCallingDays(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    >
                      <option value="All Days (Mon-Sun)">All Days (Monday - Sunday)</option>
                      <option value="Monday - Saturday">Monday - Saturday (Exclude Sundays)</option>
                      <option value="Monday - Friday">Monday - Friday (Standard Business Week)</option>
                    </select>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 sm:col-span-2 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-900">Night-time Queue Holding</div>
                      <div className="text-[11px] text-slate-500">
                        Orders placed outside calling hours remain paused in queue and resume automatically at {callingHoursStart} PKT.
                      </div>
                    </div>
                    <Badge variant="success">Auto-Queue Active</Badge>
                  </div>
                </div>
              </div>
            )}

            {/* 6. WHATSAPP INTEGRATION */}
            {activeTab === 'whatsapp' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">WhatsApp Fallback Gateway (WA-AKG)</h2>
                    <p className="text-xs text-slate-500">Dispatch interactive WhatsApp confirmation templates when calls fail or go unanswered.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableWhatsappFallback}
                      onChange={(e) => setEnableWhatsappFallback(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    <span className="ml-2.5 text-xs font-bold text-slate-800">
                      {enableWhatsappFallback ? 'Fallback Enabled' : 'Fallback Disabled'}
                    </span>
                  </label>
                </div>

                <div className="grid gap-5 lg:grid-cols-12">
                  <div className="lg:col-span-7 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">Template Script Language</label>
                      <select
                        value={templateLanguage}
                        onChange={(e) => setTemplateLanguage(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      >
                        <option value="roman_urdu">Roman Urdu (Maximum Response Rate in PK)</option>
                        <option value="urdu">Urdu Script (اردو)</option>
                        <option value="english">English</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold text-slate-700">WhatsApp Message Template</label>
                        <span className="text-[10px] text-slate-400">Click variable to insert</span>
                      </div>

                      {/* Clickable Variable Chips */}
                      <div className="flex flex-wrap gap-1.5 my-2">
                        {['{customerName}', '{orderNumber}', '{orderTotal}', '{shopName}'].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => insertVariable(v)}
                            className="px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-mono text-[10px] border border-emerald-200 transition"
                          >
                            +{v}
                          </button>
                        ))}
                      </div>

                      <textarea
                        rows={4}
                        value={customWhatsappTemplate}
                        onChange={(e) => setCustomWhatsappTemplate(e.target.value)}
                        placeholder="WhatsApp message body..."
                        className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 leading-relaxed font-sans"
                      />
                    </div>
                  </div>

                  {/* Smartphone Message Preview */}
                  <div className="lg:col-span-5 bg-slate-900 p-4 rounded-2xl border border-slate-800 text-white space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold">Customer Chat Preview</span>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono">WA-AKG 2.0</span>
                    </div>

                    <div className="bg-[#0b141a] p-3 rounded-xl min-h-[160px] flex flex-col justify-end">
                      <div className="bg-[#005c4b] p-3 rounded-2xl rounded-tr-none text-white text-xs max-w-[90%] self-end shadow-md space-y-1">
                        <p className="leading-relaxed">
                          {customWhatsappTemplate
                            .replace('{customerName}', 'Ahmed Khan')
                            .replace('{orderNumber}', '1042')
                            .replace('{orderTotal}', 'Rs. 3,450')
                            .replace('{shopName}', shopName || 'Dial Mate')}
                        </p>
                        <div className="text-[9px] text-emerald-200 text-right">Just now • ✓✓</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7. TWILIO CONFIGURATION */}
            {activeTab === 'twilio' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Twilio Telephony & Voice Stream</h2>
                    <p className="text-xs text-slate-500">Supervise Twilio voice trunking, media streaming, and dry-run protection.</p>
                  </div>
                  <Badge variant="primary">Twilio Voice Pipeline</Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 space-y-2 sm:col-span-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                      <Shield className="w-4 h-4 text-indigo-600" />
                      <span>Dry-Run Calling Protection Active</span>
                    </div>
                    <p className="text-xs text-indigo-900 leading-relaxed">
                      Telephony is operating in production dry-run mode (<code>DRY_RUN_CALLS=true</code>). All call flows, speech recognition, database states, and webhooks execute end-to-end without debiting carrier balance.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Inbound Twilio Webhook URL</label>
                    <div className="relative mt-1.5">
                      <input
                        type="text"
                        readOnly
                        value="https://api.sundaybazaaar.com/webhooks/twilio/stream"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-600 cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => copyText('https://api.sundaybazaaar.com/webhooks/twilio/stream', 'webhook')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                        title="Copy webhook URL"
                      >
                        {copiedKey === 'webhook' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Status Callback Endpoint</label>
                    <div className="relative mt-1.5">
                      <input
                        type="text"
                        readOnly
                        value="https://api.sundaybazaaar.com/webhooks/twilio/status"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-600 cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => copyText('https://api.sundaybazaaar.com/webhooks/twilio/status', 'status')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                        title="Copy status URL"
                      >
                        {copiedKey === 'status' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Submit Action */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs hover:shadow transition disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Save All Changes</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Disconnect Confirmation Modal */}
      <ConfirmationModal
        isOpen={disconnectModalOpen}
        onClose={() => setDisconnectModalOpen(false)}
        onConfirm={handleDisconnectConfirm}
        title="Disconnect Shopify Store?"
        message="This will sign out the current merchant session and revoke local API keys. You will need to re-authenticate with Shopify to access live order data."
        confirmText="Yes, Disconnect"
        cancelText="Keep Connected"
        tone="danger"
      />

      {/* Shopify Connect Modal */}
      <ShopifyConnectModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        defaultDomain={shopDomain}
      />
    </div>
  );
}