import {
  CreditCard,
  Gem,
  Globe,
  Users,
  CheckCircle2,
  PhoneCall,
  ShieldCheck,
  Crown,
  Zap,
  ExternalLink
} from 'lucide-react?deps=react';

import { useStore } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { formatCurrency } from '../utils.jsx';

const plans = [
  {
    name: 'Starter',
    price: 4999,
    badge: 'For testing',
    icon: Zap,
    features: [
      'Up to 500 calls / month',
      'Urdu IVR confirmation',
      'Shopify order webhooks',
      'Basic retry system',
      'Dashboard access'
    ]
  },
  {
    name: 'Growth',
    price: 14999,
    badge: 'Most popular',
    icon: Crown,
    highlighted: true,
    features: [
      'Up to 3,000 calls / month',
      'Priority call retries',
      'Shopify tagging',
      'Call analytics',
      'Team access',
      'Priority support'
    ]
  },
  {
    name: 'Scale',
    price: 34999,
    badge: 'For agencies',
    icon: ShieldCheck,
    features: [
      'Up to 10,000 calls / month',
      'Multi-store support',
      'White-label dashboard',
      'Advanced fraud signals',
      'Custom call scripts',
      'Dedicated onboarding'
    ]
  }
];

export function BillingPage() {
  const { state, dispatch } = useStore();
  const { pushToast } = useToast();

  const activePlan = state.billing.currentPlan || 'Starter';

  const handleSelectPlan = (planName) => {
    dispatch({ type: 'UPDATE_PLAN', plan: planName });
    pushToast(`${planName} plan selected. Payment integration will be connected in production.`, 'success');
  };

  return (
    <div className="fade-up space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <PageHeader
          eyebrow="Billing"
          title="Plans, usage, and subscription"
          description="Choose the right Dial Mate plan for automated Shopify order confirmation calls. Billing will be connected through Shopify Billing or Stripe before launch."
        />

        <button
          onClick={() => pushToast('Payment checkout will be added during deployment.', 'default')}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white shadow-medium sm:w-auto"
        >
          <ExternalLink size={16} />
          Manage subscription
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center gap-3 text-[hsl(var(--primary))]">
            <CreditCard size={18} />
            <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Current spend</span>
          </div>
          <div className="mt-3 text-3xl font-bold">{formatCurrency(state.billing.monthlySpend || 0)}</div>
          <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">This month</div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center gap-3 text-[hsl(var(--primary))]">
            <Gem size={18} />
            <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Trial remaining</span>
          </div>
          <div className="mt-3 text-3xl font-bold">{String(state.billing.freeTrialDaysLeft || 0)} days</div>
          <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">Before paid billing</div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center gap-3 text-[hsl(var(--primary))]">
            <Users size={18} />
            <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Team seats</span>
          </div>
          <div className="mt-3 text-3xl font-bold">{String(state.billing.teamSeats || 1)}</div>
          <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">Users included</div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center gap-3 text-[hsl(var(--primary))]">
            <Globe size={18} />
            <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Voice minutes</span>
          </div>
          <div className="mt-3 text-3xl font-bold">{String(state.billing.voiceMinutes || 0)}</div>
          <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">Used this month</div>
        </div>
      </div>

      <SectionCard title="Choose a plan" subtitle="Simple pricing for Shopify stores using automated Urdu order confirmation">
        <div className="grid gap-4 xl:grid-cols-3">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const selected = activePlan === plan.name;

            return (
              <div
                key={plan.name}
                className={`relative rounded-3xl border p-5 shadow-soft transition-all ${
                  plan.highlighted
                    ? 'border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.06)]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon size={18} className="text-[hsl(var(--primary))]" />
                      <h3 className="text-xl font-bold">{plan.name}</h3>
                    </div>
                    <div className="mt-2 inline-flex rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                      {plan.badge}
                    </div>
                  </div>

                  {selected ? (
                    <span className="rounded-full bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-600">
                      Active
                    </span>
                   ) : null}
                </div>

                <div className="mt-5">
                  <span className="text-4xl font-bold">{formatCurrency(plan.price)}</span>
                  <span className="text-sm text-[hsl(var(--foreground)/0.55)]"> / month</span>
                </div>

                <div className="mt-5 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex gap-3 text-sm text-[hsl(var(--foreground)/0.72)]">
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => handleSelectPlan(plan.name)}
                  className={`mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                    selected
                      ? 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]'
                      : 'bg-[hsl(var(--primary))] text-white shadow-medium hover:-translate-y-0.5'
                  }`}
                >
                  {selected ? 'Current plan' : 'Select plan'}
                </button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Included capabilities" subtitle="What clients receive with Dial Mate">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Automatic Shopify calls', PhoneCall],
              ['Urdu confirmation IVR', Globe],
              ['Retry logic', RefreshIcon],
              ['Shopify status tracking', ShieldCheck]
            ].map(([label, Icon]) => (
              <div key={label} className="flex items-center gap-3 rounded-3xl bg-[hsl(var(--muted)/0.45)] p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                  <Icon size={18} />
                </div>
                <div className="text-sm font-semibold">{label}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Billing status" subtitle="Current subscription overview">
          <div className="rounded-3xl bg-[hsl(var(--secondary))] p-5 text-white">
            <div className="text-sm text-white/70">Active plan</div>
            <div className="mt-2 text-4xl font-bold">{activePlan}</div>
            <div className="mt-3 text-sm leading-6 text-white/85">
              Your billing system is ready for production integration. For Shopify App Store distribution, connect Shopify Billing API. For direct SaaS sales, connect Stripe checkout.
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function RefreshIcon(props) {
  return <PhoneCall {...props} />;
}