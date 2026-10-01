import React from 'react';
import {
  ListFilter,
  RefreshCw,
  Loader2,
  PhoneCall,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Package,
  MapPin,
  Phone,
  Calendar,
  AlertCircle,
  CreditCard,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  Send,
  Sliders,
  DollarSign,
  User,
  ShoppingBag,
  ExternalLink,
  PhoneForwarded,
  RotateCcw
} from 'lucide-react?deps=react';

import { useToast } from '../toast.jsx';
import { apiClient } from '../api/client.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Drawer } from '../components/ui/Drawer.jsx';
import { ConfirmationModal } from '../components/ui/ConfirmationModal.jsx';
import { Skeleton, TableSkeletonRows } from '../components/ui/Skeleton.jsx';
import { formatCurrency } from '../utils.jsx';

export function OrdersPage() {
  const { pushToast } = useToast();

  const [orders, setOrders] = React.useState([]);
  const [counts, setCounts] = React.useState({ total: 0, confirmed: 0, pending: 0, cancelled: 0 });
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalOrders, setTotalOrders] = React.useState(0);
  const [selectedOrder, setSelectedOrder] = React.useState(null);
  const [actionLoadingId, setActionLoadingId] = React.useState(null);

  // Cancellation modal state
  const [cancelModalOrder, setCancelModalOrder] = React.useState(null);
  const [cancelling, setCancelling] = React.useState(false);

  const loadOrders = async (silent = false) => {
    try {
      if (!silent) setSyncing(true);

      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (filter !== 'all') params.append('status', filter);
      params.append('page', String(page));
      params.append('limit', '25');

      const data = await apiClient.get(`/orders?${params.toString()}`);
      setOrders(data?.orders || []);
      setTotalOrders(data?.total || 0);
      setTotalPages(data?.totalPages || 1);
      if (data?.counts) {
        setCounts(data.counts);
      }

      if (!silent && !loading) {
        pushToast('Orders list refreshed from database.', 'success');
      }
    } catch (err) {
      console.error(err);
      if (!silent) pushToast(err.message || 'Failed to load orders from backend.', 'error');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  React.useEffect(() => {
    loadOrders(true);
  }, [page, filter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadOrders(false);
  };

  // 1. CALL CUSTOMER
  const handleCallOrder = async (orderId) => {
    setActionLoadingId(`call-${orderId}`);
    try {
      pushToast(`Initiating AI confirmation call for order ${orderId}...`, 'default');
      const data = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/call`, {});
      if (data?.ok) {
        pushToast(`Call queued for order ${orderId} (SID: ${data.providerCallSid})`, 'success');
        await loadOrders(true);
      } else {
        throw new Error(data?.error || 'Call request rejected');
      }
    } catch (err) {
      pushToast(err.message || 'Failed to place call.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // 2. CONFIRM ORDER
  const handleConfirmOrder = async (orderId) => {
    setActionLoadingId(`confirm-${orderId}`);
    try {
      pushToast(`Confirming order ${orderId}...`, 'default');
      const data = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/tag`, {
        status: 'Confirmed',
        tag: 'Merchant Confirmed'
      });
      if (data?.ok) {
        pushToast(`Order ${orderId} marked as CONFIRMED.`, 'success');
        if (selectedOrder?.id === orderId) {
          setSelectedOrder((prev) => ({ ...prev, status: 'Confirmed', tag: 'Merchant Confirmed' }));
        }
        await loadOrders(true);
      }
    } catch (err) {
      pushToast(err.message || 'Failed to confirm order.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // 3. CANCEL ORDER
  const executeCancelOrder = async () => {
    if (!cancelModalOrder) return;
    const orderId = cancelModalOrder.id;
    setCancelling(true);
    try {
      pushToast(`Cancelling order ${orderId}...`, 'default');
      const data = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/tag`, {
        status: 'Cancelled',
        tag: 'Merchant Cancelled'
      });
      if (data?.ok) {
        pushToast(`Order ${orderId} marked as CANCELLED.`, 'success');
        if (selectedOrder?.id === orderId) {
          setSelectedOrder((prev) => ({ ...prev, status: 'Cancelled', tag: 'Merchant Cancelled' }));
        }
        setCancelModalOrder(null);
        await loadOrders(true);
      }
    } catch (err) {
      pushToast(err.message || 'Failed to cancel order.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  // 4. SEND WHATSAPP
  const handleSendWhatsApp = async (orderId) => {
    setActionLoadingId(`wa-${orderId}`);
    try {
      pushToast(`Dispatching WhatsApp confirmation to customer for order ${orderId}...`, 'default');
      const data = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/whatsapp`, {});
      if (data?.ok) {
        pushToast(`WhatsApp confirmation message sent successfully!`, 'success');
      } else {
        throw new Error(data?.reason || 'WhatsApp message dispatch failed.');
      }
    } catch (err) {
      pushToast(err.message || 'Failed to send WhatsApp message.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Helper for risk badge
  const renderRiskBadge = (score = 0) => {
    if (score >= 60) {
      return (
        <Badge variant="riskHigh" size="sm">
          High Risk ({score})
        </Badge>
      );
    }
    if (score >= 30) {
      return (
        <Badge variant="riskMedium" size="sm">
          Med Risk ({score})
        </Badge>
      );
    }
    return (
      <Badge variant="riskLow" size="sm">
        Low Risk ({score})
      </Badge>
    );
  };

  return (
    <div className="py-6 px-4 sm:px-8 space-y-6 max-w-[1720px] mx-auto">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-soft">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
              Order Operations
            </span>
            <span className="text-xs font-mono font-medium text-slate-500">
              {totalOrders} Total Orders
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
            Shopify Orders & COD Confirmations
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage incoming Cash on Delivery orders, inspect customer shipping details, and trigger Roman Urdu voice confirmation.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => loadOrders(false)}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-soft flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Status Pills */}
        <div className="flex items-center flex-wrap gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
          {[
            { id: 'all', label: 'All Orders', count: counts.total || totalOrders },
            { id: 'pending', label: 'Pending COD', count: counts.pending },
            { id: 'confirmed', label: 'Confirmed', count: counts.confirmed },
            { id: 'cancelled', label: 'Cancelled', count: counts.cancelled }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFilter(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  filter === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {tab.count || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search input */}
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
          <input
            type="text"
            placeholder="Search order #, customer, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3.5 py-2 pl-9 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs text-slate-900 shadow-xs"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </form>
      </div>

      {/* Orders Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
              <tr>
                <th className="px-5 py-3.5">Order</th>
                <th className="px-5 py-3.5">Customer & Phone</th>
                <th className="px-5 py-3.5">City & Destination</th>
                <th className="px-5 py-3.5">Total Amount</th>
                <th className="px-5 py-3.5">Risk Score</th>
                <th className="px-5 py-3.5">Order Status</th>
                <th className="px-5 py-3.5">AI Call Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <TableSkeletonRows rows={8} cols={8} />
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-slate-400">
                    <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <div className="font-semibold text-slate-600">No orders matching current filter</div>
                    <div className="text-xs text-slate-400 mt-1">Try switching to "All Orders" or syncing with Shopify</div>
                  </td>
                </tr>
              ) : (
                orders.map((ord) => {
                  const isCallLoading = actionLoadingId === `call-${ord.id}`;
                  const isConfirmLoading = actionLoadingId === `confirm-${ord.id}`;
                  const isWaLoading = actionLoadingId === `wa-${ord.id}`;

                  return (
                    <tr key={ord.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. Order ID */}
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900">{ord.name || ord.id}</div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(ord.createdAt).toLocaleDateString()}
                        </div>
                      </td>

                      {/* 2. Customer */}
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">
                          {ord.customer?.firstName
                            ? `${ord.customer.firstName} ${ord.customer.lastName || ''}`
                            : ord.customerName || 'Customer'}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {ord.customer?.phone || ord.phone || 'No phone'}
                        </div>
                      </td>

                      {/* 3. City */}
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-800">
                          {ord.shippingAddress?.city || ord.city || 'Pakistan'}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                          {ord.shippingAddress?.address1 || 'Standard Shipping'}
                        </div>
                      </td>

                      {/* 4. Total Amount */}
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900">
                          Rs {parseFloat(ord.totalAmount || 0).toLocaleString()}
                        </div>
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">COD</span>
                      </td>

                      {/* 5. Risk Score */}
                      <td className="px-5 py-4">
                        {renderRiskBadge(ord.riskScore || ord.risk || 0)}
                      </td>

                      {/* 6. Order Status */}
                      <td className="px-5 py-4">
                        <Badge
                          variant={
                            ord.status?.toLowerCase().includes('confirm')
                              ? 'confirmed'
                              : ord.status?.toLowerCase().includes('cancel')
                              ? 'cancelled'
                              : 'pending'
                          }
                        >
                          {ord.status || 'Pending'}
                        </Badge>
                      </td>

                      {/* 7. Call Status */}
                      <td className="px-5 py-4">
                        <Badge
                          variant={
                            ord.callStatus === 'completed'
                              ? 'confirmed'
                              : ord.callStatus === 'calling'
                              ? 'calling'
                              : ord.callStatus === 'failed'
                              ? 'failed'
                              : 'queued'
                          }
                        >
                          {ord.callStatus || 'Queued'}
                        </Badge>
                      </td>

                      {/* 8. Action Buttons (All Real APIs) */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Drawer */}
                          <button
                            type="button"
                            onClick={() => setSelectedOrder(ord)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Inspect order & items"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Call Button */}
                          <button
                            type="button"
                            onClick={() => handleCallOrder(ord.id)}
                            disabled={isCallLoading}
                            className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                            title="Call customer via AI"
                          >
                            {isCallLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <PhoneForwarded className="w-4 h-4" />
                            )}
                          </button>

                          {/* Send WhatsApp */}
                          <button
                            type="button"
                            onClick={() => handleSendWhatsApp(ord.id)}
                            disabled={isWaLoading}
                            className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                            title="Send WhatsApp confirmation"
                          >
                            {isWaLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>

                          {/* Confirm Button */}
                          <button
                            type="button"
                            onClick={() => handleConfirmOrder(ord.id)}
                            disabled={isConfirmLoading}
                            className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                            title="Confirm Order"
                          >
                            {isConfirmLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                          </button>

                          {/* Cancel Button */}
                          <button
                            type="button"
                            onClick={() => setCancelModalOrder(ord)}
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition-colors"
                            title="Cancel Order"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-slate-50/50">
          <div>
            Showing Page <span className="font-bold text-slate-800">{page}</span> of{' '}
            <span className="font-bold text-slate-800">{totalPages}</span> ({totalOrders} orders)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Slide-over Customer & Order Information Drawer */}
      <Drawer
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder?.name || selectedOrder?.id}
        subtitle={`Placed on ${selectedOrder ? new Date(selectedOrder.createdAt).toLocaleString() : ''}`}
        badge={
          <Badge
            variant={
              selectedOrder?.status?.toLowerCase().includes('confirm')
                ? 'confirmed'
                : selectedOrder?.status?.toLowerCase().includes('cancel')
                ? 'cancelled'
                : 'pending'
            }
          >
            {selectedOrder?.status}
          </Badge>
        }
        footer={
          selectedOrder && (
            <div className="flex items-center gap-2 w-full justify-between">
              <button
                type="button"
                onClick={() => setCancelModalOrder(selectedOrder)}
                className="px-3.5 py-2 text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel Order
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSendWhatsApp(selectedOrder.id)}
                  className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCallOrder(selectedOrder.id)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <PhoneForwarded className="w-3.5 h-3.5" />
                  <span>Call Customer</span>
                </button>
              </div>
            </div>
          )
        }
      >
        {selectedOrder && (
          <div className="space-y-6 text-xs text-slate-700">
            {/* Customer Contact Box */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <User className="w-4 h-4 text-indigo-600" />
                  <span>Customer Contact</span>
                </h3>
                {renderRiskBadge(selectedOrder.riskScore || selectedOrder.risk || 0)}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-400 block text-[10px]">Customer Name</span>
                  <span className="font-bold text-slate-900">
                    {selectedOrder.customer?.firstName
                      ? `${selectedOrder.customer.firstName} ${selectedOrder.customer.lastName || ''}`
                      : selectedOrder.customerName || 'Customer'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Mobile Number</span>
                  <span className="font-mono font-bold text-slate-900">
                    {selectedOrder.customer?.phone || selectedOrder.phone}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[10px] flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    Delivery Destination
                  </span>
                  <span className="font-medium text-slate-800">
                    {selectedOrder.shippingAddress?.address1 || 'Address verified on call'}
                    {selectedOrder.shippingAddress?.city ? `, ${selectedOrder.shippingAddress.city}` : ''}
                    {selectedOrder.shippingAddress?.province ? `, ${selectedOrder.shippingAddress.province}` : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Line Items Preview */}
            <div className="space-y-2">
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <ShoppingBag className="w-4 h-4 text-indigo-600" />
                <span>Ordered Items</span>
              </h3>

              {selectedOrder.items?.length ? (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden">
                  {selectedOrder.items.map((it, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-slate-900">{it.title}</div>
                        {it.variant && <div className="text-[10px] text-slate-400">{it.variant}</div>}
                        <div className="text-[11px] text-slate-500">Qty: {it.qty}</div>
                      </div>
                      <div className="font-mono font-bold text-slate-900">
                        Rs {parseFloat(it.price || 0).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-white rounded-xl border border-slate-200 flex justify-between items-center">
                  <span className="font-semibold text-slate-800">{selectedOrder.productName || 'Order Package'}</span>
                  <span className="font-mono font-bold text-slate-900">
                    Rs {parseFloat(selectedOrder.totalAmount || 0).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Financial Summary */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
              <div>
                <span className="text-slate-400 block text-[10px]">Payment Terms</span>
                <span className="font-bold text-slate-900">Cash on Delivery (COD)</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">Net Payable</span>
                <span className="text-base font-extrabold text-indigo-700">
                  Rs {parseFloat(selectedOrder.totalAmount || 0).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Call History Timeline */}
            <div className="space-y-2">
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <PhoneCall className="w-4 h-4 text-indigo-600" />
                <span>Call Attempt Timeline</span>
              </h3>

              {selectedOrder.recentCalls?.length ? (
                <div className="space-y-2">
                  {selectedOrder.recentCalls.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-bold text-slate-900">{c.outcome || 'Attempt'}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {c.providerCallSid || 'Pending SID'} • {new Date(c.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <Badge variant="queued" size="sm">{c.durationSec || 0}s</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center text-slate-400">
                  No automated calls dispatched yet for this order.
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Confirmation Dialog for Cancel Order */}
      <ConfirmationModal
        isOpen={Boolean(cancelModalOrder)}
        onClose={() => setCancelModalOrder(null)}
        onConfirm={executeCancelOrder}
        loading={cancelling}
        title="Cancel Order Confirmation"
        message={`Are you sure you want to cancel order ${cancelModalOrder?.name || cancelModalOrder?.id}? This will flag the order as CANCELLED in Dial Mate and stop all future automated confirmation calls.`}
        confirmText="Confirm Order Cancellation"
        cancelText="Keep Order"
        tone="danger"
      />
    </div>
  );
}