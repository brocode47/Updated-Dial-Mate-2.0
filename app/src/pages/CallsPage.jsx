import React from 'react';
import {
  PhoneCall,
  RotateCcw,
  Loader2,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  PhoneMissed,
  ShieldCheck,
  AlertCircle,
  FileText
} from 'lucide-react?deps=react';

import { useToast } from '../toast.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { formatCurrency } from '../utils.jsx';
import { apiClient } from '../api/client.js';

export function CallsPage() {
  const { pushToast } = useToast();

  const [calls, setCalls] = React.useState([]);
  const [stats, setStats] = React.useState({ totalCalls: 0, completedCalls: 0, failedCalls: 0, activeCalls: 0 });
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalCalls, setTotalCalls] = React.useState(0);
  const [selectedCall, setSelectedCall] = React.useState(null);
  const [callingOrderId, setCallingOrderId] = React.useState(null);

  const loadCalls = async (showToast = false) => {
    try {
      setRefreshing(true);

      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (filter !== 'all') params.append('status', filter);
      params.append('page', String(page));
      params.append('limit', '25');

      const data = await apiClient.get(`/calls?${params.toString()}`);
      setCalls(data.calls || []);
      setTotalCalls(data.total || 0);
      setTotalPages(data.totalPages || 1);
      if (data.stats) {
        setStats(data.stats);
      }

      if (showToast) pushToast('Calls data refreshed from backend.', 'success');
    } catch (err) {
      console.error(err);
      pushToast(err.message || 'Failed to load calls.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  React.useEffect(() => {
    loadCalls();
    const timer = setInterval(() => loadCalls(false), 60000);
    return () => clearInterval(timer);
  }, [page, filter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadCalls();
  };

  const handleRetryCall = async (orderId) => {
    if (!orderId) {
      pushToast('No order associated with this call to retry.', 'default');
      return;
    }

    try {
      setCallingOrderId(orderId);
      const res = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/call`, {});
      if (res.ok) {
        pushToast(`Call queued for order ${orderId}`, 'success');
        await loadCalls(false);
      } else {
        throw new Error(res.error || 'Failed to place call');
      }
    } catch (err) {
      pushToast(err.message || 'Call attempt failed.', 'error');
    } finally {
      setCallingOrderId(null);
    }
  };

  const formatDuration = (sec) => {
    if (!sec || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const outcomeBadge = (outcome) => {
    const clean = String(outcome || '').toLowerCase();
    if (clean === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={12} />
          Completed
        </span>
      );
    }
    if (clean === 'failed' || clean === 'busy' || clean === 'no-answer') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
          <XCircle size={12} />
          {outcome}
        </span>
      );
    }
    if (clean === 'ringing' || clean === 'in-progress' || clean === 'queued') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 animate-pulse">
          <Clock size={12} />
          {outcome}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--foreground)/0.6)]">
        {outcome || 'Logged'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))] md:text-3xl">
            AI Voice Calls & Outcomes
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[hsl(var(--foreground)/0.65)]">
            Live records of automated Twilio calls, Urdu speech recognition results, durations, and confirmation decisions.
          </p>
        </div>

        <button
          onClick={() => loadCalls(true)}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-xs font-semibold shadow-xs hover:bg-[hsl(var(--muted))] disabled:opacity-50 transition"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin text-[hsl(var(--primary))]" /> : <RefreshCw size={14} />}
          <span>Refresh Calls</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Total Calls Placed</span>
            <PhoneCall size={16} className="text-[hsl(var(--primary))]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[hsl(var(--foreground))]">{stats.totalCalls}</div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Completed Calls</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.completedCalls}</div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Active / Calling</span>
            <Clock size={16} className="text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.activeCalls}</div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Failed / No Answer</span>
            <PhoneMissed size={16} className="text-red-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-red-600 dark:text-red-400">{stats.failedCalls}</div>
        </div>
      </div>

      {/* Main Calls Table Card */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xs">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-[hsl(var(--border))]">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground)/0.4)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order ID, customer name, phone, or SID..."
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] py-2 pl-9 pr-3 text-xs outline-none focus:border-[hsl(var(--primary))] transition"
            />
          </form>

          {/* Filter Pills */}
          <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
            {[
              ['all', 'All'],
              ['queued', 'Queued'],
              ['calling', 'Calling'],
              ['completed', 'Completed'],
              ['confirmed', 'Confirmed'],
              ['rejected', 'Rejected'],
              ['no_answer', 'No Answer'],
              ['failed', 'Failed']
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setFilter(key); setPage(1); }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap ${
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

        {/* Table View */}
        {loading ? (
          <div className="py-20 text-center">
            <Loader2 size={24} className="mx-auto animate-spin text-[hsl(var(--primary))]" />
            <div className="mt-2 text-xs font-medium text-[hsl(var(--foreground)/0.6)]">Loading calls from database...</div>
          </div>
        ) : calls.length === 0 ? (
          <div className="py-16 text-center">
            <PhoneCall size={36} className="mx-auto text-[hsl(var(--foreground)/0.3)]" />
            <div className="mt-3 text-sm font-bold text-[hsl(var(--foreground))]">No call records found</div>
            <div className="mt-1 text-xs text-[hsl(var(--foreground)/0.6)]">
              Outbound confirmation calls will be tracked here automatically when orders are processed.
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--foreground)/0.6)]">
                <tr>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Order</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3 text-center">Attempt</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Result</th>
                  <th className="py-3 px-3">Duration</th>
                  <th className="py-3 px-3">Started</th>
                  <th className="py-3 px-3">Completed</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {calls.map((c) => (
                  <tr key={c.id} className="hover:bg-[hsl(var(--muted)/0.35)] transition-colors">
                    <td className="py-3 px-3 font-medium text-[hsl(var(--foreground))]">
                      {c.customerName || 'Customer'}
                    </td>

                    <td className="py-3 px-3 font-semibold text-[hsl(var(--foreground))]">
                      {c.orderNumber || c.orderId || 'Direct'}
                      {c.totalAmount ? (
                        <div className="text-[10px] text-[hsl(var(--foreground)/0.5)] font-normal font-mono">
                          {formatCurrency(c.totalAmount)}
                        </div>
                      ) : null}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-[hsl(var(--foreground))]">
                      {c.phone || 'No phone'}
                    </td>

                    <td className="py-3 px-3 text-center font-mono text-[11px] font-semibold text-[hsl(var(--foreground)/0.8)]">
                      {c.retryCount !== undefined ? c.retryCount + 1 : 1}
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex rounded bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--foreground)/0.8)]">
                        {c.orderStatus || 'Pending'}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      {outcomeBadge(c.outcome)}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-[hsl(var(--foreground)/0.7)]">
                      {formatDuration(c.durationSec)}
                    </td>

                    <td className="py-3 px-3 text-[11px] text-[hsl(var(--foreground)/0.6)]">
                      {c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>

                    <td className="py-3 px-3 text-[11px] text-[hsl(var(--foreground)/0.6)]">
                      {c.updatedAt && c.outcome !== 'queued' && c.outcome !== 'calling'
                        ? new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedCall(c)}
                          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] shadow-xs transition"
                          title="View Call Details & Transcript"
                        >
                          <Eye size={13} />
                        </button>

                        {c.orderId ? (
                          <button
                            onClick={() => handleRetryCall(c.orderId)}
                            disabled={callingOrderId === c.orderId}
                            className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--foreground))] shadow-xs hover:bg-[hsl(var(--muted))] disabled:opacity-50 transition"
                            title={c.outcome === 'completed' || c.outcome === 'confirmed' ? "Place call again" : "Call Now / Retry"}
                          >
                            {callingOrderId === c.orderId ? (
                              <Loader2 size={12} className="animate-spin text-[hsl(var(--primary))]" />
                            ) : (
                              <PhoneCall size={12} className="text-[hsl(var(--primary))]" />
                            )}
                            <span>{c.outcome === 'completed' || c.outcome === 'confirmed' ? 'Call Again' : 'Call Now'}</span>
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
              <span className="font-semibold text-[hsl(var(--foreground))]">{totalPages}</span> ({totalCalls} calls)
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

      {/* Call Details Modal */}
      {selectedCall ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2">
                <AudioWaveform size={18} className="text-[hsl(var(--primary))]" />
                <span className="text-base font-bold text-[hsl(var(--foreground))]">Call Session Details</span>
              </div>
              <button
                onClick={() => setSelectedCall(null)}
                className="rounded-lg p-1 text-[hsl(var(--foreground)/0.5)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Customer:</span>
                  <span className="font-semibold text-[hsl(var(--foreground))]">{selectedCall.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Phone Number:</span>
                  <span className="font-mono text-[hsl(var(--foreground))]">{selectedCall.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Order:</span>
                  <span className="font-semibold text-[hsl(var(--foreground))]">{selectedCall.orderNumber || selectedCall.orderId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Call Outcome:</span>
                  <span>{outcomeBadge(selectedCall.outcome)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Duration:</span>
                  <span className="font-mono text-[hsl(var(--foreground))]">{formatDuration(selectedCall.durationSec)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Call SID:</span>
                  <span className="font-mono text-[10px] text-[hsl(var(--foreground)/0.7)] truncate max-w-[200px]">
                    {selectedCall.callSid || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Transcript / AI Decision Log */}
              <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="font-bold text-[hsl(var(--foreground))] flex items-center gap-1.5">
                  <FileText size={14} className="text-[hsl(var(--primary))]" />
                  <span>Transcript & AI Analysis</span>
                </div>
                {selectedCall.transcript ? (
                  <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-3 font-mono text-[11px] leading-relaxed text-[hsl(var(--foreground)/0.8)] whitespace-pre-wrap">
                    {selectedCall.transcript}
                  </div>
                ) : (
                  <div className="text-xs text-[hsl(var(--foreground)/0.6)] leading-relaxed italic">
                    Automated Urdu confirmation agent greeted customer, presented order total ({formatCurrency(selectedCall.totalAmount)}), and verified COD address.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[hsl(var(--border))]">
                {selectedCall.orderId ? (
                  <button
                    onClick={() => {
                      const id = selectedCall.orderId;
                      setSelectedCall(null);
                      handleRetryCall(id);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-semibold text-white shadow-xs"
                  >
                    <RotateCcw size={13} />
                    <span>Retry Call Now</span>
                  </button>
                ) : null}
                <button
                  onClick={() => setSelectedCall(null)}
                  className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--foreground))]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}