import React from 'react';
import {
  AudioWaveform,
  Bot,
  PhoneMissed,
  UserRoundCog,
  Loader2,
  RefreshCw,
  PhoneCall,
  Search,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock3
} from 'lucide-react?deps=react';

import { html } from '../jsx.js';
import { useToast } from '../toast.js';
import { PageHeader } from '../components/PageHeader.js';
import { SectionCard } from '../components/SectionCard.js';

export function CallsPage() {
  const { pushToast } = useToast();

  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [selectedOrderId, setSelectedOrderId] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [loadingOrderId, setLoadingOrderId] = React.useState(null);

  const backendUrl = 'https://leisa-celebrated-indefectibly.ngrok-free.dev';

  async function loadOrders(showToast = false) {
    try {
      setRefreshing(true);

      const res = await fetch(`${backendUrl}/debug/orders?t=${Date.now()}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });

      if (!res.ok) throw new Error('Failed to fetch calls');

      const data = await res.json();
      const liveOrders = data.orders || [];

      setOrders(liveOrders);

      if (!selectedOrderId && liveOrders.length) {
        setSelectedOrderId(liveOrders[0].id);
      }

      if (showToast) {
        pushToast('Calls refreshed successfully.', 'success');
      }
    } catch (err) {
      console.error(err);
      pushToast('Failed to load calls from backend.', 'default');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  React.useEffect(() => {
    loadOrders();

    const timer = setInterval(() => loadOrders(false), 60000);
    return () => clearInterval(timer);
  }, []);

  const selectedOrder = React.useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || orders[0],
    [orders, selectedOrderId]
  );

  const calls = orders.filter((order) => order.callSid || order.callStatus);

  const completedCalls = calls.filter((order) => order.callStatus === 'completed');
  const failedCalls = calls.filter(
    (order) =>
      order.callStatus === 'failed' ||
      order.callStatus === 'busy' ||
      order.callStatus === 'no-answer'
  );
  const activeCalls = calls.filter(
    (order) =>
      order.callStatus === 'ringing' ||
      order.callStatus === 'in-progress' ||
      order.callStatus === 'initiated'
  );

  const filteredCalls = calls.filter((order) => {
    const q = search.trim().toLowerCase();

    const matchesSearch =
      !q ||
      String(order.id || '').toLowerCase().includes(q) ||
      String(order.shop || '').toLowerCase().includes(q) ||
      String(order.status || '').toLowerCase().includes(q) ||
      String(order.callStatus || '').toLowerCase().includes(q) ||
      String(order.callSid || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (filter === 'completed') return order.callStatus === 'completed';
    if (filter === 'failed') {
      return (
        order.callStatus === 'failed' ||
        order.callStatus === 'busy' ||
        order.callStatus === 'no-answer'
      );
    }
    if (filter === 'active') {
      return (
        order.callStatus === 'ringing' ||
        order.callStatus === 'in-progress' ||
        order.callStatus === 'initiated'
      );
    }

    return true;
  });

  const getCallBadge = (callStatus) => {
    if (callStatus === 'completed') return 'bg-emerald-500/12 text-emerald-600';
    if (callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
      return 'bg-red-500/12 text-red-600';
    }
    if (callStatus === 'ringing' || callStatus === 'in-progress' || callStatus === 'initiated') {
      return 'bg-blue-500/12 text-blue-600';
    }
    return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.7)]';
  };

  const getStatusBadge = (status) => {
    if (status === 'Confirmed') return 'bg-emerald-500/12 text-emerald-600';
    if (status === 'Cancelled') return 'bg-red-500/12 text-red-600';
    return 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]';
  };

  const handleCallNow = async (orderId) => {
    setLoadingOrderId(orderId);

    try {
      const res = await fetch(`${backendUrl}/debug/orders/${encodeURIComponent(orderId)}/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        }
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Call failed');
      }

      pushToast('Call started for order ' + orderId, 'success');
      await loadOrders(false);
    } catch (err) {
      console.error(err);
      pushToast(err.message || 'Call failed.', 'default');
    } finally {
      setLoadingOrderId(null);
    }
  };

  const timeline = selectedOrder
    ? [
        `Order ${selectedOrder.id} received from Shopify`,
        selectedOrder.callSid ? `Call created: ${selectedOrder.callSid}` : 'Call not started yet',
        `Current call status: ${selectedOrder.callStatus || 'pending'}`,
        `Current confirmation status: ${selectedOrder.status || 'Pending Confirmation'}`,
        `Retry attempts: ${selectedOrder.retryCount || 0}`
      ]
    : [];

  return html`
    <div className="fade-up space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <${PageHeader}
          eyebrow="Conversation center"
          title="Calls, retries, and confirmation activity"
          description="Monitor every customer call, retry status, confirmation outcome, and order timeline from one production-ready view."
        />

        <button
          onClick=${() => loadOrders(true)}
          disabled=${refreshing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold shadow-soft disabled:opacity-50 sm:w-auto"
        >
          ${refreshing
            ? html`<${Loader2} size=${16} className="animate-spin" />`
            : html`<${RefreshCw} size=${16} />`}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Total calls</p>
              <h3 className="mt-2 text-3xl font-bold">${calls.length}</h3>
            </div>
            <${PhoneCall} className="text-[hsl(var(--primary))]" />
          </div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Completed</p>
              <h3 className="mt-2 text-3xl font-bold">${completedCalls.length}</h3>
            </div>
            <${CheckCircle2} className="text-emerald-600" />
          </div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Active</p>
              <h3 className="mt-2 text-3xl font-bold">${activeCalls.length}</h3>
            </div>
            <${Clock3} className="text-blue-600" />
          </div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Failed</p>
              <h3 className="mt-2 text-3xl font-bold">${failedCalls.length}</h3>
            </div>
            <${PhoneMissed} className="text-red-600" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <${SectionCard} title="Recent calls" subtitle="Live call records from your backend database">
          <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="relative">
              <${Search} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
              <input
                value=${search}
                onChange=${(e) => setSearch(e.target.value)}
                placeholder="Search order, call SID, status..."
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 lg:justify-end">
              ${[
                ['all', 'All', calls.length],
                ['completed', 'Completed', completedCalls.length],
                ['active', 'Active', activeCalls.length],
                ['failed', 'Failed', failedCalls.length]
              ].map(([key, label, count]) => html`
                <button
                  key=${key}
                  onClick=${() => setFilter(key)}
                  className=${`shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold ${
                    filter === key
                      ? 'bg-[hsl(var(--primary))] text-white shadow-soft'
                      : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))]'
                  }`}
                >
                  ${label} · ${count}
                </button>
              `)}
            </div>
          </div>

          ${loading ? html`
            <div className="flex items-center justify-center py-14">
              <${Loader2} className="mr-2 animate-spin" size=${18} />
              Loading calls...
            </div>
          ` : filteredCalls.length === 0 ? html`
            <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] py-14 text-center">
              <div className="font-semibold">No calls found</div>
              <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.55)]">
                Place an order or manually start a call.
              </div>
            </div>
          ` : html`
            <div className="hidden overflow-hidden rounded-3xl border border-[hsl(var(--border))] lg:block">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[hsl(var(--muted)/0.55)] text-left text-xs uppercase tracking-[0.12em] text-[hsl(var(--foreground)/0.55)]">
                  <tr>
                    <th className="px-5 py-4">Order</th>
                    <th className="px-5 py-4">Call SID</th>
                    <th className="px-5 py-4">Call status</th>
                    <th className="px-5 py-4">Outcome</th>
                    <th className="px-5 py-4">Retry</th>
                    <th className="px-5 py-4 text-right">Action</th>
                  </tr>
                </thead>

                <tbody>
                  ${filteredCalls.map((order) => html`
                    <tr key=${order.id} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                      <td className="px-5 py-4 font-semibold">
                        <button
                          onClick=${() => setSelectedOrderId(order.id)}
                          className="text-left hover:text-[hsl(var(--primary))]"
                        >
                          ${order.id}
                        </button>
                        <div className="mt-1 text-xs font-normal text-[hsl(var(--foreground)/0.52)]">
                          ${order.shop || 'Unknown store'}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div className="max-w-[240px] truncate text-xs text-[hsl(var(--foreground)/0.64)]">
                          ${order.callSid || 'No call SID yet'}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span className=${`rounded-full px-3 py-1 text-xs font-semibold ${getCallBadge(order.callStatus)}`}>
                          ${order.callStatus || 'pending'}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <span className=${`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadge(order.status)}`}>
                          ${order.status || 'Pending'}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        ${order.retryCount || 0}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex justify-end">
                          <button
                            disabled=${loadingOrderId === order.id}
                            onClick=${() => handleCallNow(order.id)}
                            className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            ${loadingOrderId === order.id
                              ? html`<${Loader2} size=${14} className="animate-spin" />`
                              : html`<${RotateCcw} size=${14} />`}
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 lg:hidden">
              ${filteredCalls.map((order) => html`
                <button
                  key=${order.id}
                  onClick=${() => setSelectedOrderId(order.id)}
                  className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-left shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">${order.id}</div>
                      <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">
                        ${order.shop || 'Unknown store'}
                      </div>
                    </div>

                    <span className=${`rounded-full px-3 py-1 text-xs font-semibold ${getCallBadge(order.callStatus)}`}>
                      ${order.callStatus || 'pending'}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                      <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Outcome</div>
                      <div className="mt-1 text-sm font-semibold">${order.status || 'Pending'}</div>
                    </div>

                    <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                      <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Retry</div>
                      <div className="mt-1 text-sm font-semibold">${order.retryCount || 0}</div>
                    </div>
                  </div>

                  <div className="mt-3 break-all rounded-2xl bg-[hsl(var(--muted)/0.35)] p-3 text-xs text-[hsl(var(--foreground)/0.58)]">
                    ${order.callSid || 'No call SID yet'}
                  </div>
                </button>
              `)}
            </div>
          `}
        </${SectionCard}>

        <div className="space-y-5">
          <${SectionCard}
            title="Call detail"
            subtitle="Production call metadata for selected order"
            action=${html`
              <select
                value=${selectedOrder?.id || ''}
                onChange=${(event) => setSelectedOrderId(event.target.value)}
                className="max-w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm"
              >
                ${orders.map((order) => html`
                  <option key=${order.id} value=${order.id}>${order.id}</option>
                `)}
              </select>
            `}
          >
            ${selectedOrder ? html`
              <div className="rounded-3xl bg-[hsl(var(--secondary))] p-5 text-white">
                <div className="flex flex-wrap items-center gap-2 text-sm text-white/75">
                  <${AudioWaveform} size=${16} />
                  ${selectedOrder.callSid || 'No call has been created for this order yet'}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-white/60">Call status</div>
                    <div className="mt-1 text-lg font-semibold">${selectedOrder.callStatus || 'pending'}</div>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-white/60">Order result</div>
                    <div className="mt-1 text-lg font-semibold">${selectedOrder.status || 'Pending'}</div>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-white/60">Retries</div>
                    <div className="mt-1 text-lg font-semibold">${selectedOrder.retryCount || 0}</div>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-white/60">Tag</div>
                    <div className="mt-1 text-lg font-semibold">${selectedOrder.tag || 'None'}</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-[hsl(var(--primary)/0.10)] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <${Bot} size=${16} />
                    Agent summary
                  </div>
                  <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.7)]">
                    Urdu IVR asks customer to press 1 to confirm or 2 to cancel.
                  </div>
                </div>

                <div className="rounded-2xl bg-[hsl(var(--muted))] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <${PhoneMissed} size=${16} />
                    Retry logic
                  </div>
                  <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.7)]">
                    Failed, busy, no-answer, or no-input calls are retried automatically.
                  </div>
                </div>

                <div className="rounded-2xl bg-[hsl(var(--secondary)/0.08)] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <${UserRoundCog} size=${16} />
                    Human ops
                  </div>
                  <div className="mt-2 text-sm text-[hsl(var(--foreground)/0.7)]">
                    Operators can manually retry calls from dashboard or order pages.
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  disabled=${loadingOrderId === selectedOrder.id}
                  onClick=${() => handleCallNow(selectedOrder.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  ${loadingOrderId === selectedOrder.id
                    ? html`<${Loader2} size=${16} className="animate-spin" />`
                    : html`<${PhoneCall} size=${16} />`}
                  Call selected order
                </button>
              </div>
            ` : html`
              <div className="rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm">
                No call selected.
              </div>
            `}
          </${SectionCard}>

          <${SectionCard} title="Order status timeline" subtitle="Webhook, call, retry, and customer decision events">
            ${selectedOrder ? html`
              <ol className="space-y-3">
                ${timeline.map((step, index) => html`
                  <li key=${step + index} className="flex gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--primary))]"></span>
                    <span className="text-sm text-[hsl(var(--foreground)/0.75)]">${step}</span>
                  </li>
                `)}
              </ol>
            ` : html`
              <div className="rounded-2xl bg-[hsl(var(--muted))] p-4 text-sm">
                No timeline available.
              </div>
            `}
          </${SectionCard}>
        </div>
      </div>
    </div>
  `;
}