import React from 'react';
import {
  PhoneForwarded,
  CircleDollarSign,
  Users,
  ShoppingBag,
  BadgeCheck,
  TimerReset,
  ShieldAlert,
  PhoneCall,
  RotateCcw,
  Loader2,
  Search,
  RefreshCw,
  Store,
  Download,
  Activity,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react?deps=react';

import { useToast } from '../toast.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { ShopifyConnectModal } from '../components/ShopifyConnectModal.jsx';
import { formatCurrency } from '../utils.jsx';
import { apiClient } from '../api/client.js';

export function DashboardPage() {
  const { pushToast } = useToast();

  const [orders, setOrders] = React.useState([]);
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [syncingShopify, setSyncingShopify] = React.useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = React.useState(false);
  const [callingOrderId, setCallingOrderId] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [loadError, setLoadError] = React.useState(null);

  const hasToken = Boolean(typeof window !== 'undefined' && localStorage.getItem('dial-mate-token'));

  async function loadDashboardData(showToast = false) {
    if (!hasToken) {
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      setLoadError(null);

      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (filter !== 'all') params.append('status', filter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('limit', '15');

      const [ordersRes, statsRes] = await Promise.all([
        apiClient.get(`/orders?${params.toString()}`).catch((err) => {
          console.warn('Orders fetch error:', err.message);
          return { orders: [] };
        }),
        apiClient.get('/dashboard/stats').catch((err) => {
          console.warn('Stats fetch error:', err.message);
          return null;
        })
      ]);

      setOrders(ordersRes.orders || []);
      if (statsRes) {
        setStats(statsRes);
      }

      if (showToast) pushToast('Dashboard updated with real-time data.', 'success');
    } catch (err) {
      console.error('❌ Failed to load dashboard data:', err);
      setLoadError(err.message || 'Failed to load store data');
      pushToast('Unable to load orders from backend server.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Initial fetch and listener for global sync events
  React.useEffect(() => {
    loadDashboardData();

    const handleSyncEvent = () => loadDashboardData(false);
    window.addEventListener('dial-mate-sync-complete', handleSyncEvent);

    const timer = setInterval(() => loadDashboardData(false), 60000);
    return () => {
      window.removeEventListener('dial-mate-sync-complete', handleSyncEvent);
      clearInterval(timer);
    };
  }, [filter, startDate, endDate]);

  const handleSyncShopify = async () => {
    if (!hasToken) {
      setIsConnectModalOpen(true);
      return;
    }

    try {
      setSyncingShopify(true);
      pushToast('Connecting to Shopify to fetch live orders, customers, and products...', 'default');
      const res = await apiClient.post('/shopify/sync', {});
      if (res && res.ok) {
        const synced = res.result || {};
        pushToast(
          `Sync complete: ${synced.ordersSynced || 0} orders, ${synced.customersSynced || 0} customers, ${synced.productsSynced || 0} products.`,
          'success'
        );
        await loadDashboardData(false);
      }
    } catch (err) {
      console.error('Shopify sync error:', err);
      pushToast('Sync failed: ' + (err.message || 'Please connect your Shopify store first'), 'error');
      setIsConnectModalOpen(true);
    } finally {
      setSyncingShopify(false);
    }
  };

  const handleCallOrder = async (orderId) => {
    try {
      setCallingOrderId(orderId);
      const res = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/call`, {});
      if (res.ok) {
        pushToast(`Call queued for order ${orderId}`, 'success');
        await loadDashboardData(false);
      } else {
        throw new Error(res.error || 'Failed to queue call');
      }
    } catch (err) {
      pushToast(err.message || 'Failed to start call.', 'error');
    } finally {
      setCallingOrderId(null);
    }
  };

  const downloadOrdersExcel = () => {
    if (!orders.length) {
      pushToast('No orders available to export.', 'default');
      return;
    }

    const headers = [
      'Order ID',
      'Order Number',
      'Customer Name',
      'Product Items',
      'Total Amount (PKR)',
      'Customer Phone',
      'Status',
      'Call Status',
      'Retry Count',
      'Order Date',
      'Call SID'
    ];

    const rows = orders.map((order) => [
      order.id || '',
      order.orderNumber || order.id || '',
      order.customerName || '',
      order.productName || '',
      order.totalAmount || order.total || 0,
      order.phone || '',
      order.status || 'Pending Confirmation',
      order.callStatus || 'pending',
      order.retryCount || 0,
      order.createdAt ? new Date(order.createdAt).toLocaleString() : '',
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

    pushToast(`Exported ${orders.length} orders successfully.`, 'success');
  };

  const statusBadge = (status) => {
    if (status === 'Confirmed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={12} />
          Confirmed
        </span>
      );
    }
    if (status === 'Cancelled') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
          <XCircle size={12} />
          Cancelled
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary)/0.1)] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--primary))]">
        <Clock size={12} />
        {status || 'Pending'}
      </span>
    );
  };

  const callStatusBadge = (status) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          Completed
        </span>
      );
    }
    if (status === 'failed' || status === 'busy' || status === 'no-answer') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
          {status}
        </span>
      );
    }
    if (status === 'ringing' || status === 'in-progress' || status === 'queued') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 animate-pulse">
          {status}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--foreground)/0.6)]">
        {status || 'pending'}
      </span>
    );
  };

  // Metrics from real database stats or derived
  const totalOrders = stats?.totalOrders ?? orders.length;
  const confirmedOrders = stats?.confirmedOrders ?? orders.filter((o) => o.status === 'Confirmed').length;
  const pendingOrders = stats?.pendingOrders ?? orders.filter((o) => o.status !== 'Confirmed' && o.status !== 'Cancelled').length;
  const cancelledOrders = stats?.cancelledOrders ?? orders.filter((o) => o.status === 'Cancelled').length;
  const totalRevenue = stats?.totalRevenue ?? orders.filter((o) => o.status === 'Confirmed').reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const customersCount = stats?.customersCount ?? 0;
  const productsCount = stats?.productsCount ?? 0;
  const connectionRate = stats?.connectionRate ?? 0;

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] md:text-3xl">
            Store Performance Overview
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[hsl(var(--foreground)/0.65)]">
            Live metrics synced with your Shopify store and Twilio Urdu confirmation agent.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Date Filters */}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
            title="Start Date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
            title="End Date"
          />

          <button
            onClick={handleSyncShopify}
            disabled={syncingShopify}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold text-[hsl(var(--foreground))] shadow-xs transition hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            <RefreshCw size={13} className={syncingShopify ? 'animate-spin text-[hsl(var(--primary))]' : ''} />
            <span>{syncingShopify ? 'Syncing...' : 'Sync Shopify'}</span>
          </button>

          <button
            onClick={() => loadDashboardData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold text-[hsl(var(--foreground))] shadow-xs transition hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            <span>Refresh</span>
          </button>

          <button
            onClick={downloadOrdersExcel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:opacity-90"
          >
            <Download size={13} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Enterprise KPI Cards Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={PhoneForwarded}
          label="Total Orders"
          value={loading ? '...' : String(totalOrders)}
          help="All-time received from Shopify"
        />
        <StatCard
          icon={CircleDollarSign}
          label="Confirmed Revenue"
          value={loading ? '...' : formatCurrency(totalRevenue)}
          help="Value of confirmed COD orders"
        />
        <StatCard
          icon={BadgeCheck}
          label="Confirmed Orders"
          value={loading ? '...' : String(confirmedOrders)}
          help="Approved by customer call"
        />
        <StatCard
          icon={TimerReset}
          label="Pending Action"
          value={loading ? '...' : String(pendingOrders)}
          help="Awaiting confirmation call"
        />
        <StatCard
          icon={ShieldAlert}
          label="Cancelled Orders"
          value={loading ? '...' : String(cancelledOrders)}
          help="Customer cancelled / fraud"
        />
        <StatCard
          icon={Activity}
          label="Connection Rate"
          value={loading ? '...' : `${connectionRate}%`}
          help="Successful completed calls"
        />
      </div>

      {/* Sub-Metric Row (Store Catalog & Customer Count) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]">
              <Users size={17} />
            </div>
            <div>
              <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Synced Customers</div>
              <div className="text-lg font-bold text-[hsl(var(--foreground))]">{loading ? '...' : customersCount}</div>
            </div>
          </div>
          <a href="#/customers" className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline flex items-center gap-0.5">
            View <ArrowUpRight size={13} />
          </a>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--accent)/0.1)] text-[hsl(var(--accent))]">
              <ShoppingBag size={17} />
            </div>
            <div>
              <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Store Catalog Items</div>
              <div className="text-lg font-bold text-[hsl(var(--foreground))]">{loading ? '...' : productsCount}</div>
            </div>
          </div>
          <span className="text-xs text-[hsl(var(--foreground)/0.5)]">Shopify Catalog</span>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Store size={17} />
            </div>
            <div>
              <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Connected Store</div>
              <div className="truncate max-w-[140px] text-sm font-bold text-[hsl(var(--foreground))]" title={stats?.shopDomain || 'Not connected'}>
                {stats?.shopDomain || 'Not connected'}
              </div>
            </div>
          </div>
          <button onClick={() => setIsConnectModalOpen(true)} className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">
            Manage
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600">
              <Clock size={17} />
            </div>
            <div>
              <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Last Synchronized</div>
              <div className="text-xs font-semibold text-[hsl(var(--foreground))]">
                {stats?.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
              </div>
            </div>
          </div>
          <button onClick={handleSyncShopify} disabled={syncingShopify} className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">
            Sync
          </button>
        </div>
      </div>

      {/* Live Orders Section */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-base font-bold text-[hsl(var(--foreground))]">Recent Live Orders</h2>
            <p className="text-xs text-[hsl(var(--foreground)/0.6)]">
              Latest incoming Shopify COD orders with customer details and call status.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.4)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadDashboardData(false)}
                placeholder="Search orders, phone..."
                className="w-48 sm:w-56 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] py-1.5 pl-8 pr-3 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex gap-1">
              {[
                ['all', 'All'],
                ['pending', 'Pending'],
                ['confirmed', 'Confirmed'],
                ['cancelled', 'Cancelled']
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    filter === key
                      ? 'bg-[hsl(var(--primary))] text-white'
                      : 'border border-[hsl(var(--border))] text-[hsl(var(--foreground)/0.7)] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Orders Table */}
        {loading ? (
          <div className="py-16 text-center">
            <Loader2 size={24} className="mx-auto animate-spin text-[hsl(var(--primary))]" />
            <div className="mt-2 text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Loading live store orders...</div>
          </div>
        ) : loadError ? (
          <div className="py-12 text-center">
            <AlertCircle size={28} className="mx-auto text-amber-500" />
            <div className="mt-2 text-sm font-semibold text-[hsl(var(--foreground))]">Failed to load orders</div>
            <p className="mt-1 text-xs text-[hsl(var(--foreground)/0.6)]">{loadError}</p>
            <button
              onClick={() => loadDashboardData(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-white"
            >
              <RefreshCw size={12} />
              Try Again
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center">
            <Store size={36} className="mx-auto text-[hsl(var(--foreground)/0.3)]" />
            <h3 className="mt-3 text-sm font-bold text-[hsl(var(--foreground))]">
              {stats?.totalOrders > 0 ? 'No orders match current filter' : 'No Shopify orders received yet'}
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--foreground)/0.6)]">
              {stats?.totalOrders > 0
                ? 'Try clearing the search query or changing the filter criteria.'
                : 'Connect your Shopify store or trigger a manual sync to import live orders.'}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                onClick={() => setIsConnectModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-semibold text-white shadow-xs"
              >
                <Store size={14} />
                Connect Shopify Store
              </button>
              <button
                onClick={handleSyncShopify}
                disabled={syncingShopify}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold hover:bg-[hsl(var(--muted))]"
              >
                <RefreshCw size={13} className={syncingShopify ? 'animate-spin' : ''} />
                Sync Shopify
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--foreground)/0.6)]">
                <tr>
                  <th className="py-3 px-3">Order</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Product</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">Total (PKR)</th>
                  <th className="py-3 px-3">Order Status</th>
                  <th className="py-3 px-3">Call Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-[hsl(var(--muted)/0.35)] transition-colors">
                    <td className="py-3 px-3 font-semibold text-[hsl(var(--foreground))]">
                      {o.orderNumber || o.id}
                      <div className="text-[10px] text-[hsl(var(--foreground)/0.5)] font-normal">
                        {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-medium text-[hsl(var(--foreground))]">
                      {o.customerName || 'Customer'}
                      {o.city ? <div className="text-[10px] text-[hsl(var(--foreground)/0.5)]">{o.city}</div> : null}
                    </td>

                    <td className="py-3 px-3 text-[hsl(var(--foreground)/0.8)] max-w-[200px] truncate" title={o.productName}>
                      {o.productName || 'Order Items'}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-[hsl(var(--foreground))]">
                      {o.phone || 'No phone'}
                    </td>

                    <td className="py-3 px-3 font-semibold text-[hsl(var(--foreground))]">
                      {formatCurrency(o.totalAmount || o.total)}
                    </td>

                    <td className="py-3 px-3">
                      {statusBadge(o.status)}
                    </td>

                    <td className="py-3 px-3">
                      {callStatusBadge(o.callStatus)}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => handleCallOrder(o.id)}
                        disabled={callingOrderId === o.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--foreground))] shadow-xs hover:bg-[hsl(var(--muted))] disabled:opacity-50 transition"
                        title="Trigger AI call for this order"
                      >
                        {callingOrderId === o.id ? (
                          <Loader2 size={12} className="animate-spin text-[hsl(var(--primary))]" />
                        ) : (
                          <PhoneCall size={12} className="text-[hsl(var(--primary))]" />
                        )}
                        <span>{o.callStatus === 'completed' ? 'Retry' : 'Call'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ShopifyConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        defaultDomain={stats?.shopDomain || ''}
      />
    </div>
  );
}