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
  UserRoundCog
} from 'lucide-react?deps=react';

import { html } from '../jsx.js';
import { useStore } from '../store.js';

const navItems = [
  { href: '#/onboarding', label: 'Onboarding', icon: Sparkles },
  { href: '#/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '#/orders', label: 'Orders', icon: Package },
  { href: '#/calls', label: 'Calls', icon: Phone },
  { href: '#/billing', label: 'Billing', icon: CreditCard },
  { href: '#/settings', label: 'Settings', icon: Settings }
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);

  const connected = Boolean(state.onboarding.connectedShopify);
  const shopName = state.session.shop.name || 'Your Store';
  const shopDomain = state.session.shop.domain || 'Connect Shopify store';
  const plan = state.session.shop.plan || state.billing.currentPlan || 'Starter';

  const notifications = [
    {
      id: 'setup',
      title: connected ? 'Shopify connected' : 'Shopify setup pending',
      body: connected
        ? 'Your store is connected and ready for order confirmation calls.'
        : 'Connect Shopify from onboarding to start receiving live orders.',
      tone: connected ? 'success' : 'warning'
    },
    {
      id: 'calls',
      title: 'Voice calling ready',
      body: 'Twilio calling system is active for order confirmation.',
      tone: 'success'
    },
    {
      id: 'orders',
      title: 'Order activity',
      body: 'New orders, failed calls, and retries will appear here.',
      tone: 'default'
    }
  ];

  React.useEffect(() => {
    setMenuOpen(false);
    setNotificationsOpen(false);
  }, [route]);

  const goToSettings = () => {
    window.location.hash = '/settings';
  };

  return html`
    <div className="min-h-screen bg-[hsl(var(--background))]">
      ${menuOpen ? html`
        <button
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
          onClick=${() => setMenuOpen(false)}
          aria-label="Close navigation overlay"
        />
      ` : null}

      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside
          className=${`fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-[320px] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card)/0.96)] p-4 shadow-medium backdrop-blur transition-transform duration-300 md:sticky md:w-72 md:translate-x-0 md:p-5 ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,hsla(var(--primary),1),hsla(var(--secondary),1))] text-white shadow-medium">
                  ${state.branding?.logoDataUrl
                    ? html`<img src=${state.branding.logoDataUrl} alt="Company logo" className="h-full w-full object-cover" />`
                    : html`<${Bot} size=${24} />`}
                </div>

                <div className="min-w-0">
                  <div className="truncate text-lg font-bold">Dial Mate</div>
                  <div className="truncate text-xs text-[hsl(var(--foreground)/0.62)]">
                    Shopify call confirmations
                  </div>
                </div>
              </div>
            </div>

            <button
              className="rounded-xl border border-[hsl(var(--border))] p-2 md:hidden"
              onClick=${() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <${X} size=${18} />
            </button>
          </div>

          <div className="mt-5 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 text-white shadow-medium">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-white/70">
                Store
              </div>

              <span className=${`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                connected ? 'bg-emerald-400/20 text-emerald-100' : 'bg-amber-400/20 text-amber-100'
              }`}>
                ${connected ? html`<${CheckCircle2} size=${13} /> Connected` : 'Setup needed'}
              </span>
            </div>

            <div className="mt-3 truncate text-lg font-semibold">${shopName}</div>
            <div className="mt-1 break-all text-sm text-white/72">${shopDomain}</div>

            <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium">
              ${plan} plan
            </div>
          </div>

          <nav className="mt-5 space-y-1.5">
            ${navItems.map((item) => {
              const active = route === item.href.replace('#', '');

              return html`
                <a
                  key=${item.href}
                  href=${item.href}
                  className=${`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                    active
                      ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] shadow-soft'
                      : 'text-[hsl(var(--foreground)/0.72)] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  <${item.icon} size=${18} />
                  <span>${item.label}</span>
                </a>
              `;
            })}
          </nav>

          <div className="mt-auto pt-5">
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                ${connected
                  ? html`<${Wifi} size=${16} className="text-emerald-600" />`
                  : html`<${WifiOff} size=${16} className="text-amber-600" />`}
                System status
              </div>

              <div className="mt-3 space-y-2 text-sm text-[hsl(var(--foreground)/0.68)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Shopify</span>
                  <span className=${connected ? 'text-emerald-600' : 'text-amber-600'}>
                    ${connected ? 'Connected' : 'Pending'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span>Voice calls</span>
                  <span className="text-emerald-600">Ready</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span>Backend</span>
                  <span className="text-emerald-600">Online</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/0.88)] px-4 py-3 backdrop-blur md:px-8 md:py-4">
            <div className="flex items-center gap-3">
              <button
                className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-soft md:hidden"
                onClick=${() => setMenuOpen(true)}
                aria-label="Open menu"
              >
                <${Menu} size=${18} />
              </button>

              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--foreground)/0.55)]">
                  Dial Mate AI Calling Platform
                </div>
                <div className="truncate text-base font-semibold sm:text-lg md:text-2xl">
                  Live COD confirmation command center
                </div>
              </div>

              <button
                className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-soft transition-all hover:-translate-y-0.5"
                onClick=${() => dispatch({ type: 'TOGGLE_THEME' })}
                aria-label="Toggle theme"
              >
                ${state.theme === 'light'
                  ? html`<${Moon} size=${18} />`
                  : html`<${SunMedium} size=${18} />`}
              </button>

              <div className="relative">
                <button
                  onClick=${() => setNotificationsOpen((value) => !value)}
                  className="relative rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-soft transition-all hover:-translate-y-0.5"
                  aria-label="Open notifications"
                >
                  <${Bell} size=${18} />
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-bold text-white">
                    ${String(notifications.length)}
                  </span>
                </button>

                ${notificationsOpen ? html`
                  <div className="absolute right-0 top-12 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-large">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">Notifications</div>
                        <div className="text-xs text-[hsl(var(--foreground)/0.55)]">
                          System updates and order alerts
                        </div>
                      </div>

                      <button
                        onClick=${() => setNotificationsOpen(false)}
                        className="rounded-xl border border-[hsl(var(--border))] p-2"
                        aria-label="Close notifications"
                      >
                        <${X} size=${14} />
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      ${notifications.map((item) => html`
                        <div key=${item.id} className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                          <div className="flex items-start gap-2">
                            ${item.tone === 'success'
                              ? html`<${CheckCircle2} size=${16} className="mt-0.5 shrink-0 text-emerald-600" />`
                              : item.tone === 'warning'
                              ? html`<${AlertCircle} size=${16} className="mt-0.5 shrink-0 text-amber-600" />`
                              : html`<${Bell} size=${16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />`}
                            <div>
                              <div className="text-sm font-semibold">${item.title}</div>
                              <div className="mt-1 text-xs leading-5 text-[hsl(var(--foreground)/0.62)]">
                                ${item.body}
                              </div>
                            </div>
                          </div>
                        </div>
                      `)}
                    </div>
                  </div>
                ` : null}
              </div>

              <button
                onClick=${goToSettings}
                className="hidden items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-left shadow-soft transition-all hover:-translate-y-0.5 lg:flex"
                aria-label="Open user settings"
              >
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--primary)/0.12)] font-semibold text-[hsl(var(--primary))]">
                  ${state.branding?.logoDataUrl
                    ? html`<img src=${state.branding.logoDataUrl} alt="User logo" className="h-full w-full object-cover" />`
                    : getInitials(state.session.user.name)}
                </div>

                <div>
                  <div className="text-sm font-semibold">${state.session.user.name}</div>
                  <div className="flex items-center gap-1 text-xs text-[hsl(var(--foreground)/0.6)]">
                    <${UserRoundCog} size=${12} />
                    ${state.session.user.role}
                  </div>
                </div>
              </button>
            </div>
          </header>

          <main className="px-4 py-5 sm:px-5 md:px-8 md:py-8">
            ${children}
          </main>
        </div>
      </div>
    </div>
  `;
}