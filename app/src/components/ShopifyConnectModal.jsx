import React from 'react';
import { Store, X, ArrowRight, ShieldCheck, ExternalLink, Loader2 } from 'lucide-react?deps=react';
import { apiClient } from '../api/client.js';

export function ShopifyConnectModal({ isOpen, onClose, defaultDomain = '' }) {
  const [domainInput, setDomainInput] = React.useState(defaultDomain);
  const [error, setError] = React.useState('');
  const [connecting, setConnecting] = React.useState(false);

  React.useEffect(() => {
    if (defaultDomain) {
      setDomainInput(defaultDomain);
    }
  }, [defaultDomain]);

  if (!isOpen) return null;

  const cleanDomain = (val) => {
    let clean = String(val || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .replace(/\/+$/, '');

    if (!clean) return '';
    if (!clean.endsWith('.myshopify.com')) {
      clean = `${clean}.myshopify.com`;
    }
    return clean;
  };

  const handleConnect = (e) => {
    if (e) e.preventDefault();
    setError('');

    const targetShop = cleanDomain(domainInput);

    if (!targetShop || targetShop === '.myshopify.com') {
      setError('Please enter your Shopify store domain (e.g. mystore.myshopify.com)');
      return;
    }

    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    if (!domainRegex.test(targetShop)) {
      setError('Invalid store domain. Must be in the format your-store.myshopify.com');
      return;
    }

    setConnecting(true);

    // Save domain locally for context
    try {
      localStorage.setItem('dial-mate-last-shop', targetShop);
    } catch (_) {}

    // Redirect to Shopify OAuth initiate endpoint
    const authUrl = apiClient.getShopifyAuthUrl(targetShop);
    window.location.href = authUrl;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={() => !connecting && onClose()}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl transition-all sm:p-8">
        {/* Close Button */}
        <button
          onClick={() => !connecting && onClose()}
          disabled={connecting}
          className="absolute right-5 top-5 inline-flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--foreground)/0.5)] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition"
        >
          <X size={18} />
        </button>

        {/* Header with Shopify Icon */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Store size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[hsl(var(--foreground))]">
              Connect Shopify Store
            </h2>
            <p className="text-xs text-[hsl(var(--foreground)/0.6)]">
              Automated COD Confirmation & Order AI
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck size={16} className="shrink-0" />
            Official Shopify OAuth Authorization
          </div>
          <div className="mt-1 text-emerald-700/80 dark:text-emerald-400/80">
            You will be redirected to Shopify to approve app scopes for automated calls and live order synchronization.
          </div>
        </div>

        {/* Store Domain Form */}
        <form onSubmit={handleConnect} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground)/0.7)]">
              Shopify Store Domain
            </label>
            <div className="relative mt-2">
              <input
                type="text"
                autoFocus
                disabled={connecting}
                value={domainInput}
                onChange={(e) => {
                  setDomainInput(e.target.value);
                  if (error) setError('');
                }}
                placeholder="your-store.myshopify.com"
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-4 py-3 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
              />
            </div>
            {error && (
              <p className="mt-2 text-xs font-medium text-rose-500">
                {error}
              </p>
            )}
            <p className="mt-1.5 text-xs text-[hsl(var(--foreground)/0.5)]">
              Example: <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5">bro-code-7492.myshopify.com</code>
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              disabled={connecting}
              onClick={onClose}
              className="rounded-2xl border border-[hsl(var(--border))] px-5 py-2.5 text-sm font-semibold text-[hsl(var(--foreground)/0.8)] hover:bg-[hsl(var(--muted))] transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect Store
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
