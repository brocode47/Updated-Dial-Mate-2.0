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
  TimerReset,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  Package,
  MapPin,
  Phone,
  Calendar,
  AlertCircle,
  CreditCard,
  MessageSquare,
  ArrowDown,
  Bot
} from 'lucide-react?deps=react';

import { useToast } from '../toast.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { formatCurrency } from '../utils.jsx';
import { apiClient } from '../api/client.js';

export function OrdersPage() {
  const { pushToast } = useToast();

  const [orders, setOrders] = React.useState([]);
  const [counts, setCounts] = React.useState({ total: 0, confirmed: 0, pending: 0, cancelled: 0 });
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalOrders, setTotalOrders] = React.useState(0);
  const [selectedOrder, setSelectedOrder] = React.useState(null);
  const [actionLoadingId, setActionLoadingId] = React.useState(null);

  const loadOrders = async (showToast = false) => {
    try {
      setSyncing(true);

      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (filter !== 'all') params.append('status', filter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('page', String(page));
      params.append('limit', '25');

      const data = await apiClient.get(`/orders?${params.toString()}`);
      setOrders(data.orders || []);
      setTotalOrders(data.total || 0);
      setTotalPages(data.totalPages || 1);
      if (data.counts) {
        setCounts(data.counts);
      }

      if (showToast) pushToast('Orders updated from backend database.', 'success');
    } catch (err) {
      console.error(err);
      pushToast(err.message || 'Failed to load orders from backend.', 'error');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  React.useEffect(() => {
    loadOrders();
  }, [page, filter, startDate, endDate]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadOrders();
  };

  const handleCallOrder = async (orderId) => {
    setActionLoadingId(`call-${orderId}`);
    try {
      const data = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/call`, {});
      if (data.ok) {
        pushToast(`Call queued for order ${orderId}`, 'success');
        await loadOrders(false);
      } else {
        throw new Error(data.error || 'Call failed');
      }
    } catch (err) {
      pushToast(err.message || 'Call failed.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus, tag) => {
    setActionLoadingId(`status-${orderId}`);
    try {
      const res = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/tag`, {
        status: newStatus,
        tag: tag || `Merchant Action: ${newStatus}`
      });
      if (res && res.ok) {
        pushToast(`Order marked as ${newStatus}`, 'success');
        // Update local state immediately
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: newStatus, tag } : o))
        );
        if (selectedOrder && selectedOrder.id === orderId) {
          setSelectedOrder((prev) => ({ ...prev, status: newStatus, tag }));
        }
      }
    } catch (err) {
      pushToast(err.message || 'Failed to update order status.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const statusClass = (status) => {
    if (status === 'Confirmed') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (status === 'Cancelled') return 'bg-red-500/10 text-red-600 dark:text-red-400';
    return 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]';
  };

  const callClass = (status) => {
    if (status === 'completed') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (status === 'failed' || status === 'busy' || status === 'no-answer') {
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    }
    if (status === 'ringing' || status === 'in-progress' || status === 'queued') {
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse';
    }
    return 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.6)]';
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] md:text-3xl">
            Shopify COD Orders
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[hsl(var(--foreground)/0.65)]">
            Review incoming cash-on-delivery orders, confirmation statuses, customer details, and call outcomes.
          </p>
        </div>

        <button
          onClick={() => loadOrders(true)}
          disabled={syncing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-xs font-semibold shadow-xs hover:bg-[hsl(var(--muted))] disabled:opacity-50 transition"
        >
          {syncing ? <Loader2 size={14} className="animate-spin text-[hsl(var(--primary))]" /> : <RefreshCw size={14} />}
          <span>Refresh Orders</span>
        </button>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Total Orders</span>
            <ListFilter size={16} className="text-[hsl(var(--primary))]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[hsl(var(--foreground))]">{counts.total || totalOrders}</div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Confirmed</span>
            <BadgeCheck size={16} className="text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{counts.confirmed}</div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Pending Confirmation</span>
            <TimerReset size={16} className="text-[hsl(var(--primary))]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[hsl(var(--primary))]">{counts.pending}</div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Cancelled</span>
            <ShieldAlert size={16} className="text-red-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-red-600 dark:text-red-400">{counts.cancelled}</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
        {/* Search & Filter Toolbar */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pb-4 border-b border-[hsl(var(--border))]">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.4)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order ID, customer name, or phone..."
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] py-2 pl-9 pr-3 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
            />
          </form>

          <div className="flex flex-wrap items-center gap-2">
            {/* Date Filters */}
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-xs text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
              title="From Date"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-xs text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
              title="To Date"
            />

            {/* Filter Pills */}
            <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
              {[
                ['all', 'All'],
                ['pending', 'Pending'],
                ['confirmed', 'Confirmed'],
                ['cancelled', 'Cancelled'],
                ['failed', 'Failed Call']
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setFilter(key); setPage(1); }}
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
          <div className="py-20 text-center">
            <Loader2 size={24} className="mx-auto animate-spin text-[hsl(var(--primary))]" />
            <div className="mt-2 text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Loading orders from database...</div>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center">
            <Package size={36} className="mx-auto text-[hsl(var(--foreground)/0.3)]" />
            <div className="mt-3 text-sm font-bold text-[hsl(var(--foreground))]">No orders found</div>
            <div className="mt-1 text-xs text-[hsl(var(--foreground)/0.6)]">
              No orders match the selected filters or search parameters.
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--foreground)/0.6)]">
                <tr>
                  <th className="py-3 px-3">Order</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Items</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">Total (PKR)</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Call Outcome</th>
                  <th className="py-3 px-3">Retries</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-[hsl(var(--muted)/0.35)] transition-colors">
                    <td className="py-3 px-3 font-semibold text-[hsl(var(--foreground))]">
                      <div className="flex items-center gap-1.5">
                        <span>{o.orderNumber || o.id}</span>
                        {o.tag ? (
                          <span className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-[9px] font-medium text-[hsl(var(--foreground)/0.6)]">
                            {o.tag}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-[hsl(var(--foreground)/0.5)] font-normal">
                        {o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-medium text-[hsl(var(--foreground))]">
                      {o.customerName || 'Customer'}
                      {o.city ? <div className="text-[10px] text-[hsl(var(--foreground)/0.5)]">{o.city}</div> : null}
                    </td>

                    <td className="py-3 px-3 text-[hsl(var(--foreground)/0.8)] max-w-[180px] truncate" title={o.productName}>
                      {o.productName || 'Order Items'}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-[hsl(var(--foreground))]">
                      {o.phone || 'No phone'}
                    </td>

                    <td className="py-3 px-3 font-semibold text-[hsl(var(--foreground))]">
                      {formatCurrency(o.totalAmount || o.total)}
                    </td>

                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusClass(o.status)}`}>
                        {o.status || 'Pending'}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${callClass(o.callStatus)}`}>
                        {o.callStatus || 'pending'}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-medium text-[hsl(var(--foreground)/0.7)]">
                      {o.retryCount || 0}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedOrder(o)}
                          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] shadow-xs transition"
                          title="View order details"
                        >
                          <Eye size={13} />
                        </button>

                        <button
                          onClick={() => handleCallOrder(o.id)}
                          disabled={actionLoadingId === `call-${o.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--foreground))] shadow-xs hover:bg-[hsl(var(--muted))] disabled:opacity-50 transition"
                          title="Trigger Urdu voice call"
                        >
                          {actionLoadingId === `call-${o.id}` ? (
                            <Loader2 size={12} className="animate-spin text-[hsl(var(--primary))]" />
                          ) : (
                            <PhoneCall size={12} className="text-[hsl(var(--primary))]" />
                          )}
                          <span>Call</span>
                        </button>

                        {o.status !== 'Confirmed' ? (
                          <button
                            onClick={() => handleUpdateOrderStatus(o.id, 'Confirmed', 'Merchant Confirmed')}
                            disabled={actionLoadingId === `status-${o.id}`}
                            className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 shadow-xs transition"
                            title="Confirm Order"
                          >
                            <CheckCircle2 size={13} />
                          </button>
                        ) : null}

                        {o.status !== 'Cancelled' ? (
                          <button
                            onClick={() => handleUpdateOrderStatus(o.id, 'Cancelled', 'Merchant Cancelled')}
                            disabled={actionLoadingId === `status-${o.id}`}
                            className="rounded-lg bg-red-500/10 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/20 shadow-xs transition"
                            title="Cancel Order"
                          >
                            <XCircle size={13} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-[hsl(var(--border))] mt-4 text-xs text-[hsl(var(--foreground)/0.6)]">
            <div>
              Showing page <span className="font-semibold text-[hsl(var(--foreground))]">{page}</span> of{' '}
              <span className="font-semibold text-[hsl(var(--foreground))]">{totalPages}</span> ({totalOrders} total orders)
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-[hsl(var(--border))] p-1.5 hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-[hsl(var(--border))] p-1.5 hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Details Drawer / Modal */}
      {selectedOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-[hsl(var(--foreground))]">
                  Order {selectedOrder.orderNumber || selectedOrder.id}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass(selectedOrder.status)}`}>
                  {selectedOrder.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="rounded-lg p-1 text-[hsl(var(--foreground)/0.5)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Customer Profile & Address */}
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-3 space-y-2">
                <div className="font-bold text-[hsl(var(--foreground))] flex items-center gap-1.5">
                  <MapPin size={14} className="text-[hsl(var(--primary))]" />
                  <span>Customer & Shipping Address</span>
                </div>
                <div className="font-semibold text-[hsl(var(--foreground))]">{selectedOrder.customerName}</div>
                <div className="text-[hsl(var(--foreground)/0.7)] flex items-center gap-1.5 font-mono">
                  <Phone size={12} />
                  <span>{selectedOrder.phone}</span>
                </div>
                {selectedOrder.shippingAddress ? (
                  <div className="text-[hsl(var(--foreground)/0.7)] leading-relaxed">
                    {selectedOrder.shippingAddress.address1} {selectedOrder.shippingAddress.address2}
                    <br />
                    {selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.province}{' '}
                    {selectedOrder.shippingAddress.zip}, {selectedOrder.shippingAddress.country}
                  </div>
                ) : (
                  <div className="text-[hsl(var(--foreground)/0.5)]">No shipping address recorded.</div>
                )}
              </div>

              {/* Items Summary */}
              <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-bold text-[hsl(var(--foreground))] flex items-center gap-1.5">
                  <Package size={14} className="text-[hsl(var(--primary))]" />
                  <span>Order Items ({selectedOrder.items?.length || 1})</span>
                </div>
                {selectedOrder.items && selectedOrder.items.length > 0 ? (
                  <div className="divide-y divide-[hsl(var(--border))]">
                    {selectedOrder.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between py-1.5 text-[hsl(var(--foreground)/0.8)]">
                        <div>
                          <div className="font-semibold">{item.title}</div>
                          {item.variant ? <div className="text-[10px] text-[hsl(var(--foreground)/0.5)]">{item.variant}</div> : null}
                          <div className="text-[10px] text-[hsl(var(--foreground)/0.5)]">Qty: {item.qty}</div>
                        </div>
                        <div className="font-mono font-semibold">{formatCurrency(item.price * item.qty)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[hsl(var(--foreground)/0.8)] font-semibold">{selectedOrder.productName}</div>
                )}
                <div className="pt-2 border-t border-[hsl(var(--border))] flex justify-between font-bold text-sm text-[hsl(var(--foreground))]">
                  <span>Total ({selectedOrder.payment || 'Cash on Delivery'})</span>
                  <span className="font-mono">{formatCurrency(selectedOrder.totalAmount || selectedOrder.total)}</span>
                </div>
              </div>

              {/* Payment & Eligibility Info */}
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] p-3 space-y-2">
                <div className="font-bold text-[hsl(var(--foreground))] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <CreditCard size={14} className="text-[hsl(var(--primary))]" />
                    <span>Payment & Calling Eligibility</span>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    COD Eligible
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[hsl(var(--foreground)/0.6)]">Gateway:</span>
                    <div className="font-medium text-[hsl(var(--foreground))]">{selectedOrder.payment || 'Cash on Delivery (COD)'}</div>
                  </div>
                  <div>
                    <span className="text-[hsl(var(--foreground)/0.6)]">Calling Window:</span>
                    <div className="font-medium text-[hsl(var(--foreground))]">09:00 - 21:00 PKT</div>
                  </div>
                </div>
              </div>

              {/* Automated COD Confirmation Timeline */}
              <div className="rounded-xl border border-[hsl(var(--border))] p-3.5 space-y-3">
                <div className="font-bold text-[hsl(var(--foreground))] flex items-center gap-1.5">
                  <Clock size={14} className="text-[hsl(var(--primary))]" />
                  <span>Confirmation Workflow Timeline</span>
                </div>

                <div className="relative pl-5 space-y-3 border-l-2 border-[hsl(var(--primary)/0.3)] ml-2">
                  {/* Step 1: Order Created */}
                  <div className="relative">
                    <div className="absolute -left-[25px] top-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-[hsl(var(--card))]" />
                    <div className="font-semibold text-[hsl(var(--foreground))]">1. Order Created</div>
                    <div className="text-[10px] text-[hsl(var(--foreground)/0.6)]">
                      {selectedOrder.createdAt ? new Date(selectedOrder.createdAt).toLocaleString() : 'Recorded in Shopify'}
                    </div>
                  </div>

                  {/* Step 2: Confirmation Queued */}
                  <div className="relative">
                    <div className="absolute -left-[25px] top-0 h-3 w-3 rounded-full bg-blue-500 border-2 border-[hsl(var(--card))]" />
                    <div className="font-semibold text-[hsl(var(--foreground))]">2. Confirmation Queued</div>
                    <div className="text-[10px] text-[hsl(var(--foreground)/0.6)]">
                      Eligible COD order pushed to BullMQ priority queue
                    </div>
                  </div>

                  {/* Step 3: Call Attempt 1 */}
                  <div className="relative">
                    <div className={`absolute -left-[25px] top-0 h-3 w-3 rounded-full border-2 border-[hsl(var(--card))] ${
                      selectedOrder.callStatus === 'completed' || selectedOrder.callStatus === 'confirmed'
                        ? 'bg-emerald-500'
                        : selectedOrder.callStatus === 'failed' || selectedOrder.callStatus === 'no-answer'
                        ? 'bg-amber-500'
                        : 'bg-blue-500 animate-pulse'
                    }`} />
                    <div className="font-semibold text-[hsl(var(--foreground))]">
                      3. Call Attempt 1 ({selectedOrder.callStatus || 'pending'})
                    </div>
                    <div className="text-[10px] text-[hsl(var(--foreground)/0.6)]">
                      {selectedOrder.callSid ? `Twilio SID: ${selectedOrder.callSid.slice(0, 16)}...` : 'Automated Urdu voice agent dispatched'}
                    </div>
                  </div>

                  {/* Step 4: Retries or Follow-up */}
                  {selectedOrder.retryCount > 0 ? (
                    <div className="relative">
                      <div className="absolute -left-[25px] top-0 h-3 w-3 rounded-full bg-amber-500 border-2 border-[hsl(var(--card))]" />
                      <div className="font-semibold text-[hsl(var(--foreground))]">
                        4. Retried ({selectedOrder.retryCount} attempt{selectedOrder.retryCount > 1 ? 's' : ''})
                      </div>
                      <div className="text-[10px] text-[hsl(var(--foreground)/0.6)]">
                        Automatic retry scheduled after customer unavailable
                      </div>
                    </div>
                  ) : null}

                  {/* Step 5: Final Result */}
                  <div className="relative">
                    <div className={`absolute -left-[25px] top-0 h-3 w-3 rounded-full border-2 border-[hsl(var(--card))] ${
                      selectedOrder.status === 'Confirmed'
                        ? 'bg-emerald-500'
                        : selectedOrder.status === 'Cancelled'
                        ? 'bg-red-500'
                        : 'bg-blue-500'
                    }`} />
                    <div className="font-semibold text-[hsl(var(--foreground))]">
                      {selectedOrder.status === 'Confirmed' ? '5. Confirmed & Tagged in Shopify' : selectedOrder.status === 'Cancelled' ? '5. Cancelled & Tagged' : '5. In Progress'}
                    </div>
                    <div className="text-[10px] text-[hsl(var(--foreground)/0.6)]">
                      Status: {selectedOrder.status}
                    </div>
                  </div>
                </div>
              </div>

              {/* WhatsApp Fallback Status */}
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] p-3 space-y-1.5">
                <div className="font-bold text-[hsl(var(--foreground))] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare size={14} className="text-[hsl(var(--primary))]" />
                    <span>WhatsApp Fallback (WA-AKG)</span>
                  </div>
                  <span className="text-[10px] font-medium text-[hsl(var(--foreground)/0.6)]">
                    {selectedOrder.callStatus === 'failed' || selectedOrder.callStatus === 'no-answer' ? 'Dispatched' : 'Standby'}
                  </span>
                </div>
                <div className="text-[11px] text-[hsl(var(--foreground)/0.7)]">
                  {selectedOrder.callStatus === 'failed' || selectedOrder.callStatus === 'no-answer'
                    ? 'Fallback confirmation message dispatched in Roman Urdu with quick confirm/cancel buttons.'
                    : 'Active standby — will dispatch automatically if call attempts are unanswered.'}
                </div>
              </div>

              {/* Drawer Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[hsl(var(--border))]">
                <button
                  onClick={() => handleCallOrder(selectedOrder.id)}
                  disabled={actionLoadingId === `call-${selectedOrder.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3.5 py-2 text-xs font-semibold text-white shadow-xs"
                >
                  <PhoneCall size={13} />
                  <span>Trigger Call</span>
                </button>

                <button
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'Confirmed', 'Manual Confirmation')}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                >
                  Confirm Order
                </button>

                <button
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'Cancelled', 'Manual Cancellation')}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/20"
                >
                  Cancel Order
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}