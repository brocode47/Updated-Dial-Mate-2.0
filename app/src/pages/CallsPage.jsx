import React from 'react';
import {
  PhoneCall,
  PhoneMissed,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOutgoing,
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
  ShieldCheck,
  AlertCircle,
  FileText,
  Sparkles,
  Play,
  Volume2,
  Bot,
  User,
  Copy,
  ExternalLink,
  MessageSquare,
  Calendar,
  Radio,
  Filter
} from 'lucide-react?deps=react';

import { useToast } from '../toast.jsx';
import { formatCurrency } from '../utils.jsx';
import { apiClient } from '../api/client.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Drawer } from '../components/ui/Drawer.jsx';
import { AudioPlayer } from '../components/ui/AudioPlayer.jsx';
import { TableSkeleton } from '../components/ui/Skeleton.jsx';

export function CallsPage() {
  const { pushToast } = useToast();

  const [calls, setCalls] = React.useState([]);
  const [stats, setStats] = React.useState({ totalCalls: 0, completedCalls: 0, failedCalls: 0, activeCalls: 0 });
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalCalls, setTotalCalls] = React.useState(0);
  const [selectedCall, setSelectedCall] = React.useState(null);
  const [callingOrderId, setCallingOrderId] = React.useState(null);
  const [autoRefresh, setAutoRefresh] = React.useState(false);

  const loadCalls = async (showToast = false) => {
    try {
      setRefreshing(true);

      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (activeTab !== 'all') params.append('status', activeTab);
      params.append('page', String(page));
      params.append('limit', '25');

      const data = await apiClient.get(`/calls?${params.toString()}`);
      setCalls(data.calls || []);
      setTotalCalls(data.total || 0);
      setTotalPages(data.totalPages || 1);
      if (data.stats) {
        setStats(data.stats);
      }

      if (showToast) pushToast('Live call center metrics updated.', 'success');
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
  }, [page, activeTab]);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadCalls(false);
    }, 12000);
    return () => clearInterval(interval);
  }, [autoRefresh, page, activeTab, search]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    loadCalls();
  };

  const handleRetryCall = async (orderId) => {
    if (!orderId) {
      pushToast('No order associated with this call record.', 'default');
      return;
    }

    try {
      setCallingOrderId(orderId);
      const res = await apiClient.post(`/orders/${encodeURIComponent(orderId)}/call`, {});
      if (res.ok) {
        pushToast(`Outbound AI call initiated for order ${orderId}`, 'success');
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

  const copyToClipboard = (text, label) => {
    navigator.clipboard?.writeText(text);
    pushToast(`${label} copied to clipboard`, 'success');
  };

  const formatDuration = (sec) => {
    if (!sec || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const getOutcomeBadge = (outcome) => {
    const clean = String(outcome || '').toLowerCase();
    if (clean === 'completed' || clean === 'confirmed') {
      return <Badge variant="success">Completed</Badge>;
    }
    if (clean === 'failed' || clean === 'busy' || clean === 'no-answer' || clean === 'no_answer' || clean === 'rejected') {
      return <Badge variant="danger">{clean === 'no-answer' || clean === 'no_answer' ? 'No Answer' : clean === 'busy' ? 'Line Busy' : 'Failed'}</Badge>;
    }
    if (clean === 'calling' || clean === 'ringing' || clean === 'in-progress' || clean === 'in_progress') {
      return <Badge variant="calling">Calling Now</Badge>;
    }
    if (clean === 'queued') {
      return <Badge variant="queued">In Queue</Badge>;
    }
    return <Badge variant="neutral">{outcome || 'Logged'}</Badge>;
  };

  const getIntentBadge = (intent) => {
    const raw = String(intent || '').toUpperCase();
    if (raw.includes('CONFIRM')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          Confirmed Delivery
        </span>
      );
    }
    if (raw.includes('CANCEL') || raw.includes('REJECT')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <XCircle className="w-3 h-3 text-rose-600" />
          Requested Cancel
        </span>
      );
    }
    if (raw.includes('CALLBACK') || raw.includes('BUSY') || raw.includes('POSTPONE')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          Callback Requested
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        <Sparkles className="w-3 h-3 text-indigo-500" />
        {intent || 'Order Verification'}
      </span>
    );
  };

  const renderAISummaryCard = (call) => {
    if (!call) return null;
    const outcome = String(call.outcome || '').toLowerCase();
    const isConfirmed = outcome === 'completed' || outcome === 'confirmed' || String(call.intent || '').toUpperCase().includes('CONFIRM');
    const isCancelled = outcome === 'rejected' || String(call.intent || '').toUpperCase().includes('CANCEL');
    const isNoAnswer = outcome === 'no-answer' || outcome === 'no_answer' || outcome === 'busy';

    if (isConfirmed) {
      return (
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50/50 p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-emerald-950">Customer Confirmed Delivery</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-emerald-200/70 text-emerald-800 px-2 py-0.5 rounded-full">
                  High Confidence
                </span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Customer explicitly accepted the Cash on Delivery total ({formatCurrency(call.totalAmount)}) and confirmed readiness for shipping dispatch.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (isCancelled) {
      return (
        <div className="rounded-xl border border-rose-200 bg-gradient-to-r from-rose-50 to-pink-50/50 p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <XCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-rose-950">Customer Requested Cancellation</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-rose-200/70 text-rose-800 px-2 py-0.5 rounded-full">
                  Order Voided
                </span>
              </div>
              <p className="text-xs text-rose-800 leading-relaxed">
                Customer stated they no longer wish to receive this order. Tagged as cancelled on Shopify to prevent return courier charges.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (isNoAnswer) {
      return (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50/50 p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <PhoneMissed className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-amber-950">Call Unanswered / Line Busy</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-amber-200/70 text-amber-800 px-2 py-0.5 rounded-full">
                  Attempt {call.retryCount ? call.retryCount + 1 : 1}
                </span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Carrier returned no answer or user busy. Automated retry scheduled in accordance with business calling rules.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50/50 p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Bot className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-indigo-950">AI Voice Conversation Logged</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-200/70 text-indigo-800 px-2 py-0.5 rounded-full">
                Active Session
              </span>
            </div>
            <p className="text-xs text-indigo-800 leading-relaxed">
              Order confirmation dialogue in Roman Urdu and English. Twilio voice pipeline active with speech recognition.
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Enterprise Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Radio className="w-3 h-3 text-indigo-600 animate-pulse" />
              AI Voice Gateway Active
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-xs font-mono text-slate-500">Urdu Telephony Engine</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            AI Call Center & Voice Supervision
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Real-time supervisor desk for outbound Twilio calls, Gemini AI conversational speech recognition, recordings, and COD delivery confirmation outcomes.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              autoRefresh
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-xs'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            title="Auto-refresh calls every 12 seconds"
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'}`} />
            <span>{autoRefresh ? 'Live Stream On' : 'Live Stream Off'}</span>
          </button>

          <button
            type="button"
            onClick={() => loadCalls(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-xs disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 4 Executive KPI Call Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Calls Placed</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <PhoneCall className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-extrabold text-slate-900">{stats.totalCalls}</div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1">
            <span className="font-medium text-slate-700">Outbound queue</span>
            <span>historical total</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active / In Queue</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Clock className="w-4 h-4 animate-spin" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-extrabold text-purple-600">{stats.activeCalls}</div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1">
            <span className="font-semibold text-purple-700">Live processing</span>
            <span>telephony queue</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Completed & Confirmed</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-extrabold text-emerald-600">{stats.completedCalls}</div>
          <div className="mt-1 text-xs text-slate-500">
            {stats.totalCalls > 0 ? (
              <span className="font-semibold text-emerald-700">
                {Math.round((stats.completedCalls / stats.totalCalls) * 100)}% successful connection rate
              </span>
            ) : (
              'Awaiting call completions'
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unanswered / Failed</span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <PhoneMissed className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-extrabold text-rose-600">{stats.failedCalls}</div>
          <div className="mt-1 text-xs text-slate-500">
            {stats.failedCalls > 0 ? 'Eligible for WhatsApp fallback' : 'Zero call drops'}
          </div>
        </div>
      </div>

      {/* Main Call Center Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        {/* Navigation Tabs Header */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-6 pt-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2 -mb-px">
            {[
              { id: 'all', label: 'All Records', count: totalCalls },
              { id: 'calling', label: 'Live / In-Progress', count: stats.activeCalls, isLive: true },
              { id: 'queued', label: 'Call Queue', count: calls.filter(c => c.outcome === 'queued').length },
              { id: 'completed', label: 'Completed', count: stats.completedCalls },
              { id: 'failed', label: 'Failed / No Answer', count: stats.failedCalls }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                }}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-700 bg-white rounded-t-lg shadow-xs'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 rounded-t-lg'
                }`}
              >
                {tab.isLive && <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />}
                <span>{tab.label}</span>
                {tab.count !== undefined ? (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === tab.id ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200/80 text-slate-600'
                  }`}>
                    {tab.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <form onSubmit={handleSearchSubmit} className="relative pb-3 sm:pb-0 w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order, customer, phone..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </form>
        </div>

        {/* Content Table */}
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={6} />
          </div>
        ) : calls.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
              <PhoneCall className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No Call Sessions Found</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Calls placed by the AI telephony worker will appear here with live speech recognition, duration tracking, and call recording files.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px] font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4">Customer & Phone</th>
                  <th className="py-3.5 px-4">Order Details</th>
                  <th className="py-3.5 px-3">Call Status</th>
                  <th className="py-3.5 px-3">Duration</th>
                  <th className="py-3.5 px-4">AI Intent & Verdict</th>
                  <th className="py-3.5 px-3 text-center">Attempt</th>
                  <th className="py-3.5 px-4">Time</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {calls.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50/80 transition-colors group">
                    {/* Customer Info */}
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{call.customerName || 'Customer'}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-slate-500 font-mono text-[11px]">
                        <span>{call.phone || 'No Phone'}</span>
                        {call.phone ? (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(call.phone, 'Phone number')}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition"
                            title="Copy phone"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        ) : null}
                      </div>
                    </td>

                    {/* Order Details */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{call.orderNumber || call.orderId || 'Direct'}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {call.totalAmount ? formatCurrency(call.totalAmount) : '—'}
                      </div>
                    </td>

                    {/* Outcome Badge */}
                    <td className="py-3.5 px-3">
                      {getOutcomeBadge(call.outcome)}
                    </td>

                    {/* Duration */}
                    <td className="py-3.5 px-3 font-mono text-[11px] text-slate-600">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{formatDuration(call.durationSec)}</span>
                      </div>
                    </td>

                    {/* AI Intent & Verdict */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1 items-start">
                        {getIntentBadge(call.intent)}
                        {call.sentiment && (
                          <span className="text-[10px] text-slate-400 capitalize">
                            Tone: {call.sentiment}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Attempt Count */}
                    <td className="py-3.5 px-3 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-mono text-[11px] font-semibold">
                        {call.retryCount !== undefined ? call.retryCount + 1 : 1}
                      </span>
                    </td>

                    {/* Time */}
                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      <div>{call.createdAt ? new Date(call.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}</div>
                      <div className="text-slate-400">{call.createdAt ? new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedCall(call)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 text-xs font-semibold shadow-xs transition"
                          title="Inspect AI Call Transcript & Audio"
                        >
                          <Eye className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Inspect</span>
                        </button>

                        {call.orderId ? (
                          <button
                            type="button"
                            onClick={() => handleRetryCall(call.orderId)}
                            disabled={callingOrderId === call.orderId}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold shadow-xs transition disabled:opacity-50"
                            title="Place outbound AI call to customer"
                          >
                            {callingOrderId === call.orderId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                            ) : (
                              <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
                            )}
                            <span>{call.outcome === 'completed' || call.outcome === 'confirmed' ? 'Call Again' : 'Call Now'}</span>
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
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50/50 text-xs text-slate-500">
            <div>
              Showing page <span className="font-semibold text-slate-900">{page}</span> of{' '}
              <span className="font-semibold text-slate-900">{totalPages}</span> ({totalCalls} calls)
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition font-medium shadow-xs"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition font-medium shadow-xs"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-over Call Inspection Drawer */}
      <Drawer
        isOpen={Boolean(selectedCall)}
        onClose={() => setSelectedCall(null)}
        title={selectedCall ? `Call Intelligence: Order ${selectedCall.orderNumber || selectedCall.orderId}` : 'Call Details'}
        subtitle="Voice recording playback, Gemini AI sentiment analysis, and verbatim transcript."
        size="lg"
        footer={
          selectedCall ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] font-mono text-slate-500 truncate max-w-[200px]" title={selectedCall.callSid}>
                SID: {selectedCall.callSid || 'N/A'}
              </span>

              <div className="flex items-center gap-2">
                {selectedCall.orderId && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = selectedCall.orderId;
                      setSelectedCall(null);
                      handleRetryCall(id);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Call Now</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCall(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold text-xs transition"
                >
                  Close
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {selectedCall && (
          <div className="space-y-6">
            {/* AI Executive Summary Card */}
            {renderAISummaryCard(selectedCall)}

            {/* Audio Recording Player */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-indigo-600" />
                  Telephony Call Recording
                </span>
                <span className="text-xs font-mono text-slate-500">
                  {formatDuration(selectedCall.durationSec)} duration
                </span>
              </div>
              <AudioPlayer
                recordingUrl={selectedCall.recordingUrl}
                durationSec={selectedCall.durationSec}
              />
            </div>

            {/* Key Metadata Grid */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/70 text-xs">
              <div>
                <span className="text-slate-500 block text-[11px]">Customer</span>
                <span className="font-semibold text-slate-900">{selectedCall.customerName}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Contact Phone</span>
                <span className="font-mono font-semibold text-slate-900">{selectedCall.phone}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Order Number</span>
                <span className="font-semibold text-slate-900">{selectedCall.orderNumber || selectedCall.orderId}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Total COD Amount</span>
                <span className="font-mono font-bold text-slate-900">{formatCurrency(selectedCall.totalAmount)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Outcome State</span>
                <div className="mt-0.5">{getOutcomeBadge(selectedCall.outcome)}</div>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">AI Detected Intent</span>
                <div className="mt-0.5">{getIntentBadge(selectedCall.intent)}</div>
              </div>
            </div>

            {/* Speech Transcript Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Verbatim Urdu Transcript</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">Gemini Live Stream</span>
              </div>

              {selectedCall.transcript ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 max-h-72 overflow-y-auto">
                  <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800">
                    {selectedCall.transcript}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center space-y-2">
                  <Bot className="w-6 h-6 text-slate-400 mx-auto" />
                  <div className="text-xs font-semibold text-slate-700">Standard Order Confirmation Dialogue Executed</div>
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-sm mx-auto">
                    AI Agent greeted customer in Roman Urdu, verified order #{selectedCall.orderNumber || selectedCall.orderId}, recited COD total of {formatCurrency(selectedCall.totalAmount)}, and recorded customer response.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}