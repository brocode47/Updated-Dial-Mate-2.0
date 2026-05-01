import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react?deps=react';
import { html } from './jsx.js';

const ToastContext = React.createContext(null);

const toneStyles = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/20 bg-emerald-500/12 text-emerald-700'
  },
  error: {
    icon: AlertCircle,
    className: 'border-red-500/20 bg-red-500/12 text-red-700'
  },
  warning: {
    icon: AlertCircle,
    className: 'border-amber-500/20 bg-amber-500/12 text-amber-700'
  },
  default: {
    icon: Info,
    className: 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]'
  }
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);

  const removeToast = React.useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = React.useCallback((message, tone = 'default') => {
    const id = String(Date.now()) + Math.random().toString(16).slice(2);

    setToasts((current) => [
      ...current,
      {
        id,
        message,
        tone: toneStyles[tone] ? tone : 'default'
      }
    ]);

    window.setTimeout(() => {
      removeToast(id);
    }, 3200);
  }, [removeToast]);

  const value = React.useMemo(
    () => ({
      pushToast,
      removeToast
    }),
    [pushToast, removeToast]
  );

  return html`
    <${ToastContext.Provider} value=${value}>
      ${children}

      <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-3 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
        ${toasts.map((toast) => {
          const style = toneStyles[toast.tone] || toneStyles.default;
          const Icon = style.icon;

          return html`
            <div
              key=${toast.id}
              className=${`fade-up flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-medium backdrop-blur ${style.className}`}
            >
              <${Icon} size=${18} className="mt-0.5 shrink-0" />

              <div className="min-w-0 flex-1 text-sm font-medium leading-5">
                ${toast.message}
              </div>

              <button
                type="button"
                onClick=${() => removeToast(toast.id)}
                className="shrink-0 rounded-full p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <${X} size=${14} />
              </button>
            </div>
          `;
        })}
      </div>
    </${ToastContext.Provider}>
  `;
}

export function useToast() {
  const context = React.useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return context;
}