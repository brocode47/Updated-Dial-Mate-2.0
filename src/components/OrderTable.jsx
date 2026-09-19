import React from 'react';
import { PhoneCall, RotateCcw, Loader2, Store, Hash } from 'lucide-react?deps=react';
import { useToast } from '../toast.jsx';
import { formatCurrency, getStatusTone, getCallTone } from '../utils.jsx';

export function OrderTable(props) {
  const { pushToast } = useToast();

  const [filter, setFilter] = React.useState('All');
  const [loadingOrderId, setLoadingOrderId] = React.useState(null);

  const backendUrl = 'https://leisa-celebrated-indefectibly.ngrok-free.dev';

  const orders = React.useMemo(() => {
    const list = props.orders || [];

    if (filter === 'All') return list;

    return list.filter((order) => {
      if (filter === 'Pending') {
        return order.status !== 'Confirmed' && order.status !== 'Cancelled';
      }

      if (filter === 'Failed') {
        return (
          order.callStatus === 'failed' ||
          order.callStatus === 'busy' ||
          order.callStatus === 'no-answer'
        );
      }

      return order.tag === filter || order.status === filter;
    });
  }, [props.orders, filter]);

  const handleCall = async (orderId) => {
    setLoadingOrderId(orderId);

    try {
      const res = await fetch(
        `${backendUrl}/debug/orders/${encodeURIComponent(orderId)}/call`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          }
        }
      );

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Call failed');
      }

      pushToast('Call started for order ' + orderId, 'success');

      if (typeof props.onRefresh === 'function') {
        await props.onRefresh();
      }
    } catch (err) {
      console.error('Failed to start call:', err);
      pushToast(err.message || 'Failed to start call.', 'error');
    } finally {
      setLoadingOrderId(null);
    }
  };

  return (
    <div className="space-y-4">

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['All', 'Pending', 'Confirmed', 'Cancelled', 'Failed'].map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-semibold transition-all ${
              filter === item
                ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground)/0.72)] hover:bg-[hsl(var(--primary)/0.08)]'
            }}
          >
            {item}
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] py-12 text-center">
          <div className="font-semibold">No orders found</div>
        </div>
       ) : (

        {/* DESKTOP TABLE */}
        <div className="hidden overflow-auto rounded-[var(--radius-lg)] border border-[hsl(var(--border))] xl:block">
          <table className="w-full min-w-[1180px] divide-y divide-[hsl(var(--border))]">
            
            <thead className="bg-[hsl(var(--muted)/0.65)]">
              <tr>
                {['Sr. No.', 'Order', 'Customer', 'Product', 'Phone', 'Total', 'Status', 'Call', 'Retry', 'Actions'].map((head) => (
                  <th
                    key={head}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--foreground)/0.58)]"
                  >
                    {head}
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-[hsl(var(--border))] bg-[hsl(var(--card))]">
              {orders.map((order, index) => (
                <tr key={order.id} className="transition-all hover:bg-[hsl(var(--muted)/0.35)]">

                  {/* SR NO */}
                  <td className="px-4 py-4 font-semibold">
                    {index + 1}
                  </td>

                  <td className="px-4 py-4">
                    <div className="font-semibold">{order.id}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--foreground)/0.55)]">
                      {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'No date'}
                    </div>
                  </td>

                  <td className="px-4 py-4">
                    {order.customerName || 'Unknown customer'}
                  </td>

                  <td className="max-w-[260px] truncate px-4 py-4">
                    {order.productName || 'Unknown product'}
                  </td>

                  <td className="px-4 py-4">
                    {order.phone || 'No phone'}
                  </td>

                  <td className="px-4 py-4 font-semibold">
                    {formatCurrency(order.totalAmount || order.total || order.total_price || 0)}
                  </td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(order.status)}`}>
                      {order.status || 'Pending'}
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCallTone(order.callStatus)}`}>
                      {order.callStatus || 'pending'}
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    {order.retryCount || 0}
                  </td>

                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={loadingOrderId === order.id}
                        onClick={() => handleCall(order.id)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-sm font-semibold text-white"
                      >
                        {loadingOrderId === order.id
                          ? (<Loader2 size={16} className="animate-spin" />) : (<PhoneCall size={16} />)}
                        Call
                      </button>

                      <button
                        disabled={loadingOrderId === order.id}
                        onClick={() => handleCall(order.id)}
                        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"
                      >
                        <RotateCcw size={16} />
                        Retry
                      </button>
                    </div>
                  </td>

                </tr>
              )}
            </tbody>

          </table>
        </div>

      }
    </div>
  );
}