import React from 'react';
import {
  Activity,
  BadgeCheck,
  CircleDollarSign,
  PhoneForwarded,
  ShieldAlert,
  TimerReset,
  PhoneCall,
  RotateCcw,
  Loader2,
  Search,
  RefreshCcw,
  Store,
  Hash,
  Download
} from 'lucide-react?deps=react';

import { html } from '../jsx.js';
import { useToast } from '../toast.js';
import { PageHeader } from '../components/PageHeader.js';
import { SectionCard } from '../components/SectionCard.js';
import { StatCard } from '../components/StatCard.js';
import { formatCurrency } from '../utils.js';

export function DashboardPage() {
  const { pushToast } = useToast();

  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadingOrderId, setLoadingOrderId] = React.useState(null);
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');

  const backendUrl = 'https://leisa-celebrated-indefectibly.ngrok-free.dev';

  async function loadOrders(showToast = false) {
    try {
      setRefreshing(true);

      const res = await fetch(`${backendUrl}/debug/orders?t=${Date.now()}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });

      if (!res.ok) throw new Error('Failed to fetch orders');

      const data = await res.json();
      setOrders(data.orders || []);

      if (showToast) pushToast('Orders refreshed successfully.', 'success');
    } catch (err) {
      console.error('❌ Failed to load orders:', err);
      pushToast('Failed to load real orders from backend.', 'error');
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

  const confirmedOrders = orders.filter((order) => order.status === 'Confirmed');
  const cancelledOrders = orders.filter((order) => order.status === 'Cancelled');
  const pendingOrders = orders.filter(
    (order) => order.status !== 'Confirmed' && order.status !== 'Cancelled'
  );
  const failedOrders = orders.filter(
    (order) =>
      order.callStatus === 'failed' ||
      order.callStatus === 'busy' ||
      order.callStatus === 'no-answer'
  );
  const completedCalls = orders.filter((order) => order.callStatus === 'completed');

  const totalRevenue = confirmedOrders.reduce(
    (sum, order) => sum + Number(order.totalAmount || order.total || order.total_price || 0),
    0
  );

  const connectionRate = orders.length
    ? Math.round((completedCalls.length / orders.length) * 100)
    : 0;

  const filteredOrders = orders.filter((order) => {
    const q = search.trim().toLowerCase();

    const matchesSearch =
      !q ||
      String(order.id || '').toLowerCase().includes(q) ||
      String(order.shop || '').toLowerCase().includes(q) ||
      String(order.customerName || '').toLowerCase().includes(q) ||
      String(order.productName || '').toLowerCase().includes(q) ||
      String(order.phone || '').toLowerCase().includes(q) ||
      String(order.status || '').toLowerCase().includes(q) ||
      String(order.callStatus || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (filter === 'confirmed') return order.status === 'Confirmed';
    if (filter === 'cancelled') return order.status === 'Cancelled';
    if (filter === 'pending') return order.status !== 'Confirmed' && order.status !== 'Cancelled';
    if (filter === 'failed') {
      return (
        order.callStatus === 'failed' ||
        order.callStatus === 'busy' ||
        order.callStatus === 'no-answer'
      );
    }

    return true;
  });

  const getStatusBadge = (status) => {
    if (status === 'Confirmed') return 'bg-emerald-500/12 text-emerald-600';
    if (status === 'Cancelled') return 'bg-red-500/12 text-red-600';
    if (status === 'Max Retries Reached' || status === 'No Response') {
      return 'bg-amber-500/12 text-amber-600';
    }
    return 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]';
  };

  const getCallBadge = (callStatus) => {
    if (callStatus === 'completed') return 'bg-emerald-500/12 text-emerald-600';
    if (callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
      return 'bg-red-500/12 text-red-600';
    }
    if (callStatus === 'ringing' || callStatus === 'in-progress') {
      return 'bg-blue-500/12 text-blue-600';
    }
    return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.72)]';
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
      pushToast(err.message || 'Error starting call for ' + orderId, 'error');
    } finally {
      setLoadingOrderId(null);
    }
  };

  const downloadOrdersExcel = () => {
    const start = startDate ? new Date(startDate + 'T00:00:00').getTime() : null;
    const end = endDate ? new Date(endDate + 'T23:59:59').getTime() : null;

    const exportOrders = orders.filter((order) => {
      const created = Number(order.createdAt || order.orderDate || 0);
      if (start && created < start) return false;
      if (end && created > end) return false;
      return true;
    });

    const headers = [
      'Order Number',
      'Customer Name',
      'Product Ordered',
      'Total Price Including Delivery',
      'Customer Phone',
      'Shop',
      'Status',
      'Tag',
      'Call Status',
      'Retry Count',
      'Order Date',
      'Updated At',
      'Call SID'
    ];

    const rows = exportOrders.map((order) => [
      order.id || '',
      order.customerName || '',
      order.productName || '',
      order.totalAmount || order.total || '',
      order.phone || '',
      order.shop || '',
      order.status || '',
      order.tag || '',
      order.callStatus || '',
      order.retryCount || 0,
      order.createdAt ? new Date(order.createdAt).toLocaleString() : '',
      order.updatedAt ? new Date(order.updatedAt).toLocaleString() : '',
      order.callSid || ''
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `dial-mate-orders-${new Date().toISOString().slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    pushToast(`Downloaded ${exportOrders.length} orders.`, 'success');
  };

  return html`
    <div className="fade-up space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <${PageHeader}
          eyebrow="Live dashboard"
          title="Live order confirmation command center"
          description="Track every Shopify order, customer call, retry attempt, and confirmation outcome in real time."
        />

        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center lg:justify-end">
          <input
            type="date"
            value=${startDate}
            onChange=${(e) => setStartDate(e.target.value)}
            className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none"
          />

          <input
            type="date"
            value=${endDate}
            onChange=${(e) => setEndDate(e.target.value)}
            className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm outline-none"
          />

          <button
            onClick=${() => loadOrders(true)}
            disabled=${refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold shadow-soft transition-all hover:-translate-y-0.5 disabled:opacity-60"
          >
            ${refreshing
              ? html`<${Loader2} size=${16} className="animate-spin" />`
              : html`<${RefreshCcw} size=${16} />`}
            Refresh
          </button>

          <button
            onClick=${downloadOrdersExcel}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white shadow-medium transition-all hover:-translate-y-0.5"
          >
            <${Download} size=${16} />
            Download Excel
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <${StatCard} icon=${PhoneForwarded} label="Total orders" value=${String(orders.length)} help="Orders received from Shopify" />
        <${StatCard} icon=${BadgeCheck} label="Confirmed" value=${String(confirmedOrders.length)} help="Orders confirmed by customer" />
        <${StatCard} icon=${Activity} label="Connection rate" value=${connectionRate + '%'} help="Completed calls vs total orders" />
        <${StatCard} icon=${CircleDollarSign} label="Confirmed revenue" value=${formatCurrency(totalRevenue)} help="Revenue from confirmed orders" />
        <${StatCard} icon=${ShieldAlert} label="Cancelled" value=${String(cancelledOrders.length)} help="Orders cancelled by customer" />
        <${StatCard} icon=${TimerReset} label="Pending" value=${String(pendingOrders.length)} help="Orders awaiting action" />
      </div>

      <${SectionCard} title="Live orders" subtitle="Customer, product, phone, total, call status, and confirmation outcome">
        <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="relative">
            <${Search} size=${16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
            <input
              value=${search}
              onChange=${(e) => setSearch(e.target.value)}
              placeholder="Search order, customer, product, phone, status..."
              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary))]"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 lg:justify-end">
            ${[
              ['all', 'All', orders.length],
              ['pending', 'Pending', pendingOrders.length],
              ['confirmed', 'Confirmed', confirmedOrders.length],
              ['cancelled', 'Cancelled', cancelledOrders.length],
              ['failed', 'Failed', failedOrders.length]
            ].map(([key, label, count]) => html`
              <button
                key=${key}
                onClick=${() => setFilter(key)}
                className=${`shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  filter === key
                    ? 'bg-[hsl(var(--primary))] text-white shadow-soft'
                    : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground)/0.72)]'
                }`}
              >
                ${label} · ${count}
              </button>
            `)}
          </div>
        </div>

        ${loading ? html`
          <div className="flex items-center justify-center py-14 text-[hsl(var(--foreground)/0.6)]">
            <${Loader2} className="mr-2 animate-spin" size=${18} />
            Loading real orders...
          </div>
        ` : filteredOrders.length === 0 ? html`
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] py-14 text-center">
            <div className="text-base font-semibold">No orders found</div>
            <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.55)]">
              Try changing filters or refresh the dashboard.
            </div>
          </div>
        ` : html`
          <div className="hidden overflow-auto rounded-3xl border border-[hsl(var(--border))] xl:block">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--muted)/0.55)] text-left text-xs uppercase tracking-[0.12em] text-[hsl(var(--foreground)/0.55)]">
                <tr>
                  <th className="px-5 py-4">Order</th>
                  <th className="px-5 py-4">Customer</th>
                  <th className="px-5 py-4">Product</th>
                  <th className="px-5 py-4">Phone</th>
                  <th className="px-5 py-4">Total</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Call</th>
                  <th className="px-5 py-4">Retry</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                ${filteredOrders.map((order) => html`
                  <tr key=${order.id} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                    <td className="px-5 py-4 font-semibold">
                      ${order.id}
                      <div className="mt-1 text-xs font-normal text-[hsl(var(--foreground)/0.5)]">
                        ${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'No date'}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      ${order.customerName || 'Unknown customer'}
                    </td>

                    <td className="max-w-[240px] truncate px-5 py-4">
                      ${order.productName || 'Unknown product'}
                    </td>

                    <td className="px-5 py-4">
                      ${order.phone || 'No phone'}
                    </td>

                    <td className="px-5 py-4 font-semibold">
                      ${formatCurrency(order.totalAmount || order.total || 0)}
                    </td>

                    <td className="px-5 py-4">
                      <span className=${`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadge(order.status)}`}>
                        ${order.status || 'Pending'}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <span className=${`rounded-full px-3 py-1 text-xs font-semibold ${getCallBadge(order.callStatus)}`}>
                        ${order.callStatus || 'pending'}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      ${order.retryCount || 0}
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          disabled=${loadingOrderId === order.id}
                          onClick=${() => handleCallNow(order.id)}
                          className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-0.5 disabled:opacity-50"
                        >
                          ${loadingOrderId === order.id
                            ? html`<${Loader2} size=${14} className="animate-spin" />`
                            : html`<${PhoneCall} size=${14} />`}
                          Call
                        </button>

                        <button
                          disabled=${loadingOrderId === order.id}
                          onClick=${() => handleCallNow(order.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-50"
                        >
                          <${RotateCcw} size=${14} />
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 xl:hidden">
            ${filteredOrders.map((order) => html`
              <div key=${order.id} className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                      <${Hash} size=${17} />
                      ${String(order.id || '').replace('#', '')}
                    </div>

                    <div className="mt-2 flex items-center gap-2 truncate text-sm text-[hsl(var(--foreground)/0.62)]">
                      <${Store} size=${15} />
                      <span className="truncate">${order.shop || 'Unknown store'}</span>
                    </div>
                  </div>

                  <span className=${`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadge(order.status)}`}>
                    ${order.status || 'Pending'}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Customer</div>
                    <div className="mt-1 text-sm font-semibold">${order.customerName || 'Unknown customer'}</div>
                  </div>

                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Phone</div>
                    <div className="mt-1 text-sm font-semibold">${order.phone || 'No phone'}</div>
                  </div>

                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Product</div>
                    <div className="mt-1 text-sm font-semibold">${order.productName || 'Unknown product'}</div>
                  </div>

                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Total</div>
                    <div className="mt-1 text-sm font-semibold">${formatCurrency(order.totalAmount || order.total || 0)}</div>
                  </div>

                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Call</div>
                    <div className="mt-1 text-sm font-semibold">${order.callStatus || 'pending'}</div>
                  </div>

                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Retry</div>
                    <div className="mt-1 text-sm font-semibold">${order.retryCount || 0}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    disabled=${loadingOrderId === order.id}
                    onClick=${() => handleCallNow(order.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    ${loadingOrderId === order.id
                      ? html`<${Loader2} size=${14} className="animate-spin" />`
                      : html`<${PhoneCall} size=${14} />`}
                    Call
                  </button>

                  <button
                    disabled=${loadingOrderId === order.id}
                    onClick=${() => handleCallNow(order.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    <${RotateCcw} size=${14} />
                    Retry
                  </button>
                </div>
              </div>
            `)}
          </div>
        `}
      </${SectionCard}>
    </div>
  `;
}