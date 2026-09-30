import React from 'react';
import {
  Bell,
  Bot,
  CreditCard,
  LayoutDashboard,
  Menu,
  Moon,
  Phone,
  Settings,
  Sparkles,
  SunMedium,
  Package,
  X,
  CheckCircle2,
  Wifi,
  WifiOff,
  AlertCircle,
  UserRoundCog,
  MessageSquare,
  Users,
  BarChart3,
  Store,
  RefreshCw,
  LogOut,
  ChevronDown
} from 'lucide-react?deps=react';

import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { apiClient } from '../api/client.js';
import { ShopifyConnectModal } from './ShopifyConnectModal.jsx';

const navItems = [
  { href: '#/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '#/orders', label: 'Orders', icon: Package },
  { href: '#/calls', label: 'AI Calls', icon: Phone },
  { href: '#/customers', label: 'Customers', icon: Users },
  { href: '#/analytics', label: 'AI Analytics', icon: BarChart3 },
  { href: '#/settings', label: 'Settings', icon: Settings },
  { href: '#/onboarding', label: 'Onboarding', icon: Sparkles }
];

function getInitials(name) {
  return String(name || 'Store Owner')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function AppShell({ route, children }) {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const [connectModalOpen, setConnectModalOpen] = React.useState(false);
  const [syncingShopify, setSyncingShopify] = React.useState(false);
  const [liveShopDomain, setLiveShopDomain] = React.useState(state.session?.shop?.domain || '');
  const [lastSyncTime, setLastSyncTime] = React.useState(null);

  const hasToken = Boolean(typeof window !== 'undefined' && localStorage.getItem('dial-mate-token'));
  const connected = Boolean(hasToken && (liveShopDomain || state.onboarding?.connectedShopify));
  const displayShopDomain = liveShopDomain || state.session?.shop?.domain || (connected ? 'Connected Store' : 'No Store Connected');
  const shopName = state.session?.shop?.name || (connected ? 'Dial Mate Store' : 'Shopify Merchant');

  // Load shop domain & sync status from backend on mount
  React.useEffect(() => {
    async function fetchStoreContext() {
      if (!hasToken) return;
      try {
        const stats = await apiClient.get('/dashboard/stats');
        if (stats && stats.shopDomain) {
          setLiveShopDomain(stats.shopDomain);
          if (stats.lastSyncAt) setLastSyncTime(new Date(stats.lastSyncAt));
          dispatch({ type: 'SET_SHOP_DOMAIN', domain: stats.shopDomain });
        }
      } catch (_) {}
    }
    fetchStoreContext();
  }, [hasToken, dispatch]);

  const notifications = [
    {
      id: 'setup',
      title: connected ? 'Shopify store active' : 'Shopify connection needed',
      body: connected
        ? `Connected to ${displayShopDomain}. Automated Urdu calls are active.`
        : 'Connect your Shopify store to import live COD orders and trigger confirmation calls.',
      tone: connected ? 'success' : 'warning'
    },
    {
      id: 'calls',
      title: 'AI Calling System Online',
      body: 'Twilio bidirectional stream with Urdu speech recognition is ready.',
      tone: 'success'
    }
  ];

  React.useEffect(() => {
    setMenuOpen(false);
    setNotificationsOpen(false);
  }, [route]);

  const handleManualSync = async () => {
    if (!hasToken) {
      setConnectModalOpen(true);
      return;
    }
    try {
      setSyncingShopify(true);
      pushToast('Syncing orders, customers, and catalog from Shopify...', 'default');
      const res = await apiClient.post('/shopify/sync', {});
      if (res && res.ok) {
        const result = res.result || {};
        setLastSyncTime(new Date());
        pushToast(`Sync complete! ${result.ordersSynced || 0} orders, ${result.customersSynced || 0} customers, ${result.productsSynced || 0} products.`, 'success');
        // Trigger a custom event so child pages can reload seamlessly
        window.dispatchEvent(new CustomEvent('dial-mate-sync-complete'));
      }
    } catch (err) {
      pushToast(err.message || 'Shopify sync failed. Please reconnect your store.', 'error');
    } finally {
      setSyncingShopify(false);
    }
  };

  const handleLogout = () => {
    apiClient.logout();
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] antialiased">
      {menuOpen ? (
        <button
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation overlay"
        />
      ) : null}

      <div className="mx-auto flex min-h-screen max-w-[1720px]">
        {/* Enterprise Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-[280px] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm transition-transform duration-200 md:sticky md:w-64 md:translate-x-0 md:p-5 ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Logo & Platform ID */}
          <div className="flex items-center justify-between gap-3">
            <a href="#/dashboard" className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[hsl(var(--secondary))] to-[hsl(var(--primary))] text-white shadow-sm">
                <Bot size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-base font-bold tracking-tight text-[hsl(var(--foreground))]">Dial Mate</span>
                  <span className="rounded-md bg-[hsl(var(--primary)/0.12)] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--primary))]">v2.0</span>
                </div>
                <div className="truncate text-[11px] text-[hsl(var(--foreground)/0.6)]">
                  Shopify AI Calling
                </div>
              </div>
            </a>

            <button
              className="rounded-lg border border-[hsl(var(--border))] p-1.5 md:hidden"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>

          {/* Store Selector & Status Badge */}
          <div className="mt-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.45)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                <Store size={14} />
                <span>Store</span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  connected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {connected ? 'Active' : 'Setup Needed'}
              </span>
            </div>

            <div className="mt-2 truncate text-sm font-semibold text-[hsl(var(--foreground))]">{shopName}</div>
            <div className="mt-0.5 truncate text-xs text-[hsl(var(--foreground)/0.6)]" title={displayShopDomain}>
              {displayShopDomain}
            </div>

            <button
              onClick={() => setConnectModalOpen(true)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-xs font-semibold text-[hsl(var(--foreground))] shadow-xs transition hover:bg-[hsl(var(--muted))]"
            >
              <Store size={13} className="text-[hsl(var(--primary))]" />
              <span>{connected ? 'Switch Store' : 'Connect Shopify'}</span>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="mt-5 space-y-1">
            {navItems.map((item) => {
              const active = route === item.href.replace('#', '') || (item.href === '#/dashboard' && (!route || route === '/'));

              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-semibold'
                      : 'text-[hsl(var(--foreground)/0.7)] hover:bg-[hsl(var(--muted)/0.7)] hover:text-[hsl(var(--foreground))]'
                  }`}
                >
                  <item.icon size={17} className={active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground)/0.55)]'} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>

          {/* System Runtime Status */}
          <div className="mt-auto pt-4">
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-3 text-xs">
              <div className="flex items-center justify-between text-[hsl(var(--foreground)/0.7)]">
                <span className="flex items-center gap-1.5 font-medium">
                  <Wifi size={13} className="text-emerald-500" />
                  Engine Status
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Live</span>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-[hsl(var(--foreground)/0.55)]">
                <div className="flex justify-between">
                  <span>Twilio Voice</span>
                  <span className="text-emerald-600">Connected</span>
                </div>
                <div className="flex justify-between">
                  <span>Urdu AI Stream</span>
                  <span className="text-emerald-600">Ready</span>
                </div>
              </div>
            </div>

            {/* User Account & Logout */}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)] text-xs font-bold text-[hsl(var(--primary))]">
                  {getInitials(state.session?.user?.name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">
                    {state.session?.user?.name || 'Merchant'}
                  </div>
                  <div className="truncate text-[10px] text-[hsl(var(--foreground)/0.55)]">
                    {state.session?.user?.role || 'Store Owner'}
                  </div>
                </div>
              </div>

              {hasToken ? (
                <button
                  onClick={handleLogout}
                  className="rounded-lg p-1.5 text-[hsl(var(--foreground)/0.55)] hover:bg-red-500/10 hover:text-red-600 transition"
                  title="Sign Out / Disconnect Store"
                >
                  <LogOut size={15} />
                </button>
              ) : null}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="min-w-0 flex-1 flex flex-col">
          {/* Header Bar */}
          <header className="sticky top-0 z-20 border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/0.92)] px-4 py-3 backdrop-blur-md md:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 md:hidden"
                  onClick={() => setMenuOpen(true)}
                  aria-label="Open menu"
                >
                  <Menu size={17} />
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground)/0.5)]">
                      Dial Mate Platform
                    </span>
                    {connected ? (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {displayShopDomain}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-sm sm:text-base font-bold text-[hsl(var(--foreground))]">
                    {route === '/orders' ? 'Orders Management' :
                     route === '/calls' ? 'AI Voice Calls & Outcomes' :
                     route === '/customers' ? 'Customer Directory & Profiles' :
                     route === '/analytics' ? 'AI Performance Analytics' :
                     route === '/settings' ? 'Store & AI Voice Configuration' :
                     route === '/onboarding' ? 'Shopify Launch & Integration' :
                     'Live COD Confirmation Command Center'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Manual Sync Button */}
                <button
                  onClick={handleManualSync}
                  disabled={syncingShopify}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--foreground))] shadow-xs transition hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                  title="Synchronize live orders, customers, and products from Shopify"
                >
                  <RefreshCw size={13} className={syncingShopify ? 'animate-spin text-[hsl(var(--primary))]' : ''} />
                  <span className="hidden sm:inline">{syncingShopify ? 'Syncing...' : 'Sync Shopify'}</span>
                </button>

                {/* Connect Store Button */}
                <button
                  onClick={() => setConnectModalOpen(true)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition ${
                    connected
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                      : 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white hover:opacity-90'
                  }`}
                  title="Connect or switch Shopify store"
                >
                  <Store size={13} />
                  <span className="hidden sm:inline">{connected ? 'Store Active' : 'Connect Store'}</span>
                </button>

                {/* Theme Toggle */}
                <button
                  className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-[hsl(var(--foreground)/0.7)] shadow-xs hover:text-[hsl(var(--foreground))] transition"
                  onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
                  aria-label="Toggle theme"
                >
                  {state.theme === 'light' ? <Moon size={16} /> : <SunMedium size={16} />}
                </button>

                {/* Notifications Bell */}
                <div className="relative">
                  <button
                    onClick={() => setNotificationsOpen((v) => !v)}
                    className="relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-[hsl(var(--foreground)/0.7)] shadow-xs hover:text-[hsl(var(--foreground))] transition"
                    aria-label="Notifications"
                  >
                    <Bell size={16} />
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[9px] font-bold text-white">
                      {notifications.length}
                    </span>
                  </button>

                  {notificationsOpen ? (
                    <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-lg">
                      <div className="flex items-center justify-between pb-3 border-b border-[hsl(var(--border))]">
                        <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--foreground))]">System Alerts</span>
                        <button onClick={() => setNotificationsOpen(false)} className="rounded p-1 text-[hsl(var(--foreground)/0.5)] hover:text-[hsl(var(--foreground))]">
                          <X size={14} />
                        </button>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        {notifications.map((item) => (
                          <div key={item.id} className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-2.5 text-xs">
                            <div className="flex items-start gap-2">
                              {item.tone === 'success' ? (
                                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                              ) : (
                                <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                              )}
                              <div>
                                <div className="font-semibold text-[hsl(var(--foreground))]">{item.title}</div>
                                <div className="mt-0.5 leading-relaxed text-[hsl(var(--foreground)/0.65)]">{item.body}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          {/* Page Body */}
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>

      <ShopifyConnectModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        defaultDomain={liveShopDomain}
      />
    </div>
  );
}