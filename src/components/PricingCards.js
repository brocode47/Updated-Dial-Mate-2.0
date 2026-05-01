import { Check, Crown, PhoneCall, ShieldCheck, Zap } from 'lucide-react?deps=react';
import { html } from '../jsx.js';
import { useStore } from '../store.js';
import { useToast } from '../toast.js';
import { formatCurrency } from '../utils.js';

const plans = [
  {
    name: 'Starter',
    price: 4999,
    badge: 'For testing',
    icon: Zap,
    blurb: 'For small Shopify stores starting automated order confirmations.',
    features: [
      '500 calls per month',
      'Urdu IVR confirmation',
      'Shopify order webhooks',
      'Basic retry handling',
      'Dashboard access'
    ]
  },
  {
    name: 'Growth',
    price: 14999,
    badge: 'Most popular',
    icon: PhoneCall,
    highlighted: true,
    blurb: 'For growing COD stores with daily order volume.',
    features: [
      '3,000 calls per month',
      'Shopify tagging',
      'Manual call and retry actions',
      'Call status analytics',
      'Team access',
      'Priority support'
    ]
  },
  {
    name: 'Scale',
    price: 34999,
    badge: 'For agencies',
    icon: Crown,
    blurb: 'For high-volume brands, agencies, and multi-store operators.',
    features: [
      '10,000 calls per month',
      'Multi-store support',
      'White-label dashboard',
      'Advanced fraud signals',
      'Custom call scripts',
      'Dedicated onboarding'
    ]
  }
];

export function PricingCards() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const activePlan = state.billing.currentPlan || 'Starter';

  return html`
    <div className="grid gap-4 xl:grid-cols-3">
      ${plans.map((plan) => {
        const Icon = plan.icon;
        const selected = activePlan === plan.name;

        return html`
          <div
            key=${plan.name}
            className=${`relative rounded-3xl border p-5 shadow-soft transition-all ${
              plan.highlighted
                ? 'border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.06)]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                  <${Icon} size=${20} />
                </div>

                <div>
                  <h3 className="text-xl font-bold">${plan.name}</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">
                    ${plan.blurb}
                  </p>
                </div>
              </div>

              <span className=${`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                plan.highlighted
                  ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.65)]'
              }`}>
                ${plan.badge}
              </span>
            </div>

            <div className="mt-6">
              <span className="text-4xl font-bold">${formatCurrency(plan.price)}</span>
              <span className="ml-2 text-sm font-medium text-[hsl(var(--foreground)/0.55)]">
                / month
              </span>
            </div>

            <ul className="mt-6 space-y-3">
              ${plan.features.map((feature) => html`
                <li key=${feature} className="flex items-start gap-3 text-sm text-[hsl(var(--foreground)/0.75)]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
                    <${Check} size=${14} />
                  </span>
                  <span>${feature}</span>
                </li>
              `)}
            </ul>

            <button
              onClick=${() => {
                dispatch({ type: 'UPDATE_PLAN', plan: plan.name });
                pushToast(
                  selected
                    ? `${plan.name} is already your active plan.`
                    : `${plan.name} plan selected. Payment checkout will be connected during deployment.`,
                  selected ? 'default' : 'success'
                );
              }}
              className=${`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                selected
                  ? 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]'
                  : 'bg-[hsl(var(--primary))] text-white shadow-medium hover:-translate-y-0.5'
              }`}
            >
              ${selected ? html`<${ShieldCheck} size=${16} /> Current plan` : 'Select ' + plan.name}
            </button>
          </div>
        `;
      })}
    </div>
  `;
}