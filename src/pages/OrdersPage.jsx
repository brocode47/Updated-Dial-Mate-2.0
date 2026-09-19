import React from 'react';
import {
  ListFilter,
  RefreshCw,
  Loader2,
  PhoneCall,
  RotateCcw,
  Search,
  BadgeCheck,
  ShieldAlert,
  TimerReset
} from 'lucide-react?deps=react';

import { useToast } from '../toast.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';

export function OrdersPage() {
  const { pushToast } = useToast();

  const [orders, setOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [loadingOrderId, setLoadingOrderId] = React.useState(null);

  const backendUrl = 'https://leisa-celebrated-indefectibly.ngrok-free.dev';

  async function loadOrders(showToast = false) {
    try {
      setSyncing(true);

      const res = await fetch(`${backendUrl}/debug/orders?t={Date.now()}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });

      if (!res.ok) throw new Error('Failed to fetch orders');

      const data = await res.json();
      setOrders(data.orders || []);

      if (showToast) pushToast('Orders synced successfully.', 'success');
    } catch (err) {
      console.error(err);
      pushToast('Failed to load orders from backend.', 'default');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  React.useEffect(() => {
    loadOrders();

    const timer = setInterval(() => loadOrders(false), 60000);
    return () => clearInterval(timer);
  }, []);

  const confirmedOrders = orders.filter((o) => o.status === 'Confirmed');
  const cancelledOrders = orders.filter((o) => o.status === 'Cancelled');
  const pendingOrders = orders.filter(
    (o) => o.status !== 'Confirmed' && o.status !== 'Cancelled'
  );

  const failedOrders = orders.filter(
    (o) =>
      o.callStatus === 'failed' ||
      o.callStatus === 'busy' ||
      o.callStatus === 'no-answer'
  );

  const filteredOrders = orders.filter((order) => {
    const q = search.trim().toLowerCase();

    const matchesSearch =
      !q ||
      String(order.id || '').toLowerCase().includes(q) ||
      String(order.shop || '').toLowerCase().includes(q) ||
      String(order.status || '').toLowerCase().includes(q) ||
      String(order.callStatus || '').toLowerCase().includes(q) ||
      String(order.callSid || '').toLowerCase().includes(q);

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

  const statusClass = (status) => {
    if (status === 'Confirmed') return 'bg-emerald-500/12 text-emerald-600';
    if (status === 'Cancelled') return 'bg-red-500/12 text-red-600';
    return 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]';
  };

  const callClass = (status) => {
    if (status === 'completed') return 'bg-emerald-500/12 text-emerald-600';
    if (status === 'failed' || status === 'busy' || status === 'no-answer') {
      return 'bg-red-500/12 text-red-600';
    }
    if (status === 'ringing' || status === 'in-progress') {
      return 'bg-blue-500/12 text-blue-600';
    }
    return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.7)]';
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

  return (
    <div className="fade-up space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <PageHeader
          eyebrow="Order management"
          title="Real-time Shopify confirmation workflow"
          description="View live Shopify orders, confirmation status, call status, retries, and manually trigger calls."
        />

        <button
          onClick={() => loadOrders(true)}
          disabled={syncing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold shadow-soft disabled:opacity-50 sm:w-auto"
        >
          {syncing ? (<Loader2 size={16} className="animate-spin" />) : (<RefreshCw size={16} />)}
          Sync Now
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Total Orders</p>
              <h3 className="mt-2 text-3xl font-bold">{orders.length}</h3>
            </div>
            <ListFilter className="text-[hsl(var(--primary))]" />
          </div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Confirmed</p>
              <h3 className="mt-2 text-3xl font-bold">{confirmedOrders.length}</h3>
            </div>
            <BadgeCheck className="text-emerald-600" />
          </div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Pending</p>
              <h3 className="mt-2 text-3xl font-bold">{pendingOrders.length}</h3>
            </div>
            <TimerReset className="text-[hsl(var(--primary))]" />
          </div>
        </div>

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[hsl(var(--foreground)/0.58)]">Cancelled</p>
              <h3 className="mt-2 text-3xl font-bold">{cancelledOrders.length}</h3>
            </div>
            <ShieldAlert className="text-red-600" />
          </div>
        </div>
      </div>

      <SectionCard title="Order table" subtitle="Live order data from your backend database">
        <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.45)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, store, status, call SID..."
              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-3 pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 lg:justify-end">
            {[
              ['all', 'All', orders.length],
              ['pending', 'Pending', pendingOrders.length],
              ['confirmed', 'Confirmed', confirmedOrders.length],
              ['cancelled', 'Cancelled', cancelledOrders.length],
              ['failed', 'Failed', failedOrders.length]
            ].map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold ${
                  filter === key
                    ? 'bg-[hsl(var(--primary))] text-white shadow-soft'
                    : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))]'
                }`}
              >
                {label} · {count}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <Loader2 className="mr-2 animate-spin" size={18} />
            Loading orders...
          </div>
         ) : filteredOrders.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] py-14 text-center">
            <div className="font-semibold">No orders found</div>
            <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.55)]">
              Try changing filters or syncing again.
            </div>
          </div>
         ) : (
          <>
          <div className="hidden overflow-hidden rounded-3xl border border-[hsl(var(--border))] lg:block">
            <table className="w-full border-collapse text-sm">
             

<thead className="bg-[hsl(var(--muted)/0.55)] text-left text-xs uppercase tracking-[0.12em] text-[hsl(var(--foreground)/0.55)]">
  <tr>
    <th className="px-5 py-4">Sr. No.</th>
    <th className="px-5 py-4">Order</th>
    <th className="px-5 py-4">Store</th>
    <th className="px-5 py-4">Status</th>
    <th className="px-5 py-4">Call</th>
    <th className="px-5 py-4">Retry</th>
    <th className="px-5 py-4 text-right">Actions</th>
  </tr>
</thead>

<tbody>
  {filteredOrders.map((order, index) => (
    <tr key={order.id} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">

      {/* SR NO */}
      <td className="px-5 py-4 font-semibold">
        {index + 1}
      </td>

      <td className="px-5 py-4 font-semibold">
        {order.id}
        <div className="mt-1 max-w-[260px] truncate text-xs font-normal text-[hsl(var(--foreground)/0.52)]">
          {order.callSid || 'No call SID yet'}
        </div>
      </td>

      <td className="px-5 py-4">{order.shop || 'Unknown'}</td>

      <td className="px-5 py-4">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(order.status)}`}>
          {order.status || 'Pending'}
        </span>
      </td>

      <td className="px-5 py-4">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold $${callClass(order.callStatus)}`}>
          {order.callStatus || 'pending'}
        </span>
      </td>

      <td className="px-5 py-4">{order.retryCount || 0}</td>

      <td className="px-5 py-4">
        <div className="flex justify-end gap-2">
          <button
            disabled={loadingOrderId === order.id}
            onClick={() => handleCallNow(order.id)}
            className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loadingOrderId === order.id
              ? (<Loader2 size={14} className="animate-spin" />) : (<PhoneCall size={14} />)}
            Call
          </button>

          <button
            disabled={loadingOrderId === order.id}
            onClick={() => handleCallNow(order.id)}
            className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <RotateCcw size={14} />
            Retry
          </button>
        </div>
      </td>

    </tr>
  ))}
</tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:hidden">
            {filteredOrders.map((order) => (
              <div key={order.id} className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{order.id}</div>
                    <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.62)]">{order.shop || 'Unknown store'}</div>
                  </div>

                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(order.status)}`}>
                    {order.status || 'Pending'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Call</div>
                    <div className="mt-1 text-sm font-semibold">{order.callStatus || 'pending'}</div>
                  </div>

                  <div className="rounded-2xl bg-[hsl(var(--muted)/0.45)] p-3">
                    <div className="text-xs uppercase tracking-[0.1em] text-[hsl(var(--foreground)/0.45)]">Retry</div>
                    <div className="mt-1 text-sm font-semibold">{order.retryCount || 0}</div>
                  </div>
                </div>

                <div className="mt-3 break-all rounded-2xl bg-[hsl(var(--muted)/0.35)] p-3 text-xs text-[hsl(var(--foreground)/0.58)]">
                  {order.callSid || 'No call SID yet'}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    disabled={loadingOrderId === order.id}
                    onClick={() => handleCallNow(order.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <PhoneCall size={14} />
                    Call
                  </button>

                  <button
                    disabled={loadingOrderId === order.id}
                    onClick={() => handleCallNow(order.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                    Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}