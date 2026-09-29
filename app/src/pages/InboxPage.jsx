import React from 'react';
import {
  MessageSquare,
  Search,
  RefreshCw,
  Send,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Bot,
  User,
  ShieldAlert,
  Loader2,
  Filter
} from 'lucide-react?deps=react';

import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { apiClient } from '../api/client.js';
import { useToast } from '../toast.jsx';

export function InboxPage() {
  const { pushToast } = useToast();

  const [conversations, setConversations] = React.useState([]);
  const [selectedConvId, setSelectedConvId] = React.useState(null);
  const [activeConversation, setActiveConversation] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const [replyText, setReplyText] = React.useState('');
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);

  const messagesEndRef = React.useRef(null);

  const fetchConversations = React.useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (search.trim()) params.append('search', search.trim());

      const res = await apiClient.get(`/conversations?${params.toString()}`);
      if (res && res.conversations) {
        setConversations(res.conversations);
        if (!selectedConvId && res.conversations.length > 0) {
          setSelectedConvId(res.conversations[0].id);
        }
      }
    } catch (err) {
      if (!silent) pushToast({ title: 'Error fetching conversations', body: err.message, tone: 'danger' });
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [statusFilter, search, selectedConvId, pushToast]);

  const fetchActiveConversation = React.useCallback(async (id, silent = false) => {
    if (!id) return;
    if (!silent) setLoadingThread(true);
    try {
      const res = await apiClient.get(`/conversations/${id}`);
      if (res) {
        setActiveConversation(res);
      }
    } catch (err) {
      if (!silent) pushToast({ title: 'Error loading conversation', body: err.message, tone: 'danger' });
    } finally {
      if (!silent) setLoadingThread(false);
    }
  }, [pushToast]);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  React.useEffect(() => {
    if (selectedConvId) {
      fetchActiveConversation(selectedConvId);
    }
  }, [selectedConvId, fetchActiveConversation]);

  // Auto-polling for live merchant updates every 6 seconds
  React.useEffect(() => {
    const timer = setInterval(() => {
      fetchConversations(true);
      if (selectedConvId) {
        fetchActiveConversation(selectedConvId, true);
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [fetchConversations, fetchActiveConversation, selectedConvId]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages]);

  const handleSendReply = async (e) => {
    e?.preventDefault();
    if (!replyText.trim() || !selectedConvId || sending) return;

    setSending(true);
    try {
      const res = await apiClient.post(`/conversations/${selectedConvId}/reply`, {
        text: replyText.trim()
      });
      if (res && res.ok) {
        setReplyText('');
        pushToast({ title: 'Reply sent', body: 'Message sent via WhatsApp AKG.', tone: 'success' });
        await fetchActiveConversation(selectedConvId, true);
        await fetchConversations(true);
      }
    } catch (err) {
      pushToast({ title: 'Send failed', body: err.message, tone: 'danger' });
    } finally {
      setSending(false);
    }
  };

  const handleToggleTakeover = async () => {
    if (!activeConversation) return;
    setActionLoading(true);
    const newTakeover = !activeConversation.isTakeover;
    const newStatus = newTakeover ? 'HUMAN_TAKEOVER' : 'ACTIVE';

    try {
      const res = await apiClient.patch(`/conversations/${activeConversation.id}`, {
        status: newStatus,
        isTakeover: newTakeover,
        assignedTo: newTakeover ? 'Merchant Agent' : null
      });

      if (res && res.ok) {
        pushToast({
          title: newTakeover ? 'Human Takeover Active' : 'AI Resumed',
          body: newTakeover ? 'AI auto-replies paused. You are in manual control.' : 'AI bot will handle customer inquiries.',
          tone: newTakeover ? 'warning' : 'success'
        });
        await fetchActiveConversation(activeConversation.id, true);
        await fetchConversations(true);
      }
    } catch (err) {
      pushToast({ title: 'Action failed', body: err.message, tone: 'danger' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkResolved = async () => {
    if (!activeConversation) return;
    setActionLoading(true);
    try {
      const res = await apiClient.patch(`/conversations/${activeConversation.id}`, {
        status: 'RESOLVED',
        isTakeover: false
      });
      if (res && res.ok) {
        pushToast({ title: 'Conversation Resolved', body: 'Conversation marked as resolved.', tone: 'success' });
        await fetchActiveConversation(activeConversation.id, true);
        await fetchConversations(true);
      }
    } catch (err) {
      pushToast({ title: 'Resolution failed', body: err.message, tone: 'danger' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Merchant Control Center"
        title="Conversation Inbox"
        description="Unified WhatsApp AKG live messaging, AI response review, and human agent takeover control."
        actions={
          <button
            onClick={() => {
              fetchConversations();
              if (selectedConvId) fetchActiveConversation(selectedConvId);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold shadow-soft hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw size={15} className={loadingList ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Conversation Directory */}
        <div className="space-y-4 lg:col-span-5">
          <SectionCard>
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-3 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer name or phone..."
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2.5 pl-10 pr-4 text-sm placeholder:text-[hsl(var(--foreground)/0.4)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                />
              </div>

              {/* Status Filter Tabs */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['ALL', 'ACTIVE', 'HUMAN_TAKEOVER', 'RESOLVED'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                      statusFilter === s
                        ? 'bg-[hsl(var(--primary))] text-white shadow-soft'
                        : 'bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--foreground)/0.7)] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    {s === 'HUMAN_TAKEOVER' ? 'Takeover' : s}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation List */}
            <div className="mt-4 max-h-[640px] space-y-2 overflow-y-auto pr-1">
              {loadingList && conversations.length === 0 ? (
                <div className="py-12 text-center text-sm text-[hsl(var(--foreground)/0.5)]">
                  <Loader2 size={24} className="mx-auto animate-spin" />
                  <p className="mt-2">Loading inbox...</p>
                </div>
              ) : conversations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-8 text-center text-sm text-[hsl(var(--foreground)/0.5)]">
                  <MessageSquare size={24} className="mx-auto opacity-40" />
                  <p className="mt-2">No conversations match your filter.</p>
                </div>
              ) : (
                conversations.map((c) => {
                  const isSelected = c.id === selectedConvId;
                  const isTakeover = c.status === 'HUMAN_TAKEOVER' || c.isTakeover;
                  const isResolved = c.status === 'RESOLVED';

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedConvId(c.id)}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-all duration-200 ${
                        isSelected
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] shadow-soft'
                          : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted)/0.5)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{c.customer.name}</div>
                          <div className="text-xs text-[hsl(var(--foreground)/0.6)]">{c.customer.phone || 'No phone'}</div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isTakeover
                              ? 'bg-amber-400/20 text-amber-500'
                              : isResolved
                              ? 'bg-zinc-400/20 text-zinc-500'
                              : 'bg-emerald-400/20 text-emerald-500'
                          }`}
                        >
                          {isTakeover ? 'TAKEOVER' : isResolved ? 'RESOLVED' : 'ACTIVE'}
                        </span>
                      </div>

                      <div className="mt-2 truncate text-xs text-[hsl(var(--foreground)/0.7)]">
                        {c.lastMessage ? (
                          <span>
                            <strong className="text-[hsl(var(--foreground)/0.85)]">
                              {c.lastMessage.sender === 'agent' ? 'Merchant: ' : c.lastMessage.sender === 'assistant' ? 'AI: ' : 'Customer: '}
                            </strong>
                            {c.lastMessage.text}
                          </span>
                        ) : (
                          <span className="italic">No messages yet</span>
                        )}
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[hsl(var(--foreground)/0.5)]">
                        <span className="rounded-lg bg-[hsl(var(--muted))] px-2 py-0.5">
                          {c.lastAgent || 'support_agent'}
                        </span>
                        <span className="rounded-lg bg-[hsl(var(--muted))] px-2 py-0.5">
                          {c.lastIntent || 'query'}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="ml-auto flex h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </SectionCard>
        </div>

        {/* Right Column: Chat History & Human Takeover Console */}
        <div className="space-y-4 lg:col-span-7">
          {activeConversation ? (
            <SectionCard>
              {/* Header */}
              <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold sm:text-lg">{activeConversation.customer.name}</h2>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        activeConversation.isTakeover
                          ? 'bg-amber-400/20 text-amber-500'
                          : activeConversation.status === 'RESOLVED'
                          ? 'bg-zinc-400/20 text-zinc-500'
                          : 'bg-emerald-400/20 text-emerald-500'
                      }`}
                    >
                      {activeConversation.isTakeover ? 'Human Takeover' : activeConversation.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-[hsl(var(--foreground)/0.6)]">
                    {activeConversation.customer.phone} · Shop: {activeConversation.customer.shop}
                  </div>
                </div>

                {/* Control Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={actionLoading}
                    onClick={handleToggleTakeover}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                      activeConversation.isTakeover
                        ? 'bg-amber-500 text-white shadow-soft hover:bg-amber-600'
                        : 'border border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
                    }`}
                  >
                    <UserCheck size={14} />
                    {activeConversation.isTakeover ? 'Release to AI' : 'Take Over'}
                  </button>

                  {activeConversation.status !== 'RESOLVED' && (
                    <button
                      disabled={actionLoading}
                      onClick={handleMarkResolved}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]"
                    >
                      <CheckCircle2 size={14} className="text-emerald-500" />
                      Resolve
                    </button>
                  )}
                </div>
              </div>

              {/* Takeover Active Banner */}
              {activeConversation.isTakeover && (
                <div className="mt-3 flex items-center gap-2 rounded-2xl bg-amber-400/10 px-4 py-2.5 text-xs text-amber-500">
                  <ShieldAlert size={16} className="shrink-0" />
                  <span>
                    <strong>Human takeover active.</strong> AI bot responses are currently paused. Messages sent below will be delivered directly to customer WhatsApp.
                  </span>
                </div>
              )}

              {/* Message Thread */}
              <div className="my-4 h-[420px] space-y-3 overflow-y-auto rounded-2xl bg-[hsl(var(--muted)/0.25)] p-4">
                {loadingThread ? (
                  <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--foreground)/0.5)]">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : activeConversation.messages?.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[hsl(var(--foreground)/0.4)]">
                    No messages in this conversation yet.
                  </div>
                ) : (
                  activeConversation.messages.map((m) => {
                    const isCustomer = m.sender === 'customer';
                    const isAgent = m.sender === 'agent';
                    const isAssistant = m.sender === 'assistant';

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm shadow-soft ${
                            isCustomer
                              ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                              : isAgent
                              ? 'bg-emerald-600 text-white'
                              : 'bg-[hsl(var(--primary))] text-white'
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-80">
                            {isCustomer ? (
                              <>
                                <User size={11} />
                                <span>Customer</span>
                              </>
                            ) : isAgent ? (
                              <>
                                <UserCheck size={11} />
                                <span>Merchant Agent</span>
                              </>
                            ) : (
                              <>
                                <Bot size={11} />
                                <span>DialMate AI</span>
                              </>
                            )}
                          </div>

                          <div className="leading-relaxed whitespace-pre-wrap">{m.text}</div>
                        </div>

                        <div className="mt-1 text-[10px] text-[hsl(var(--foreground)/0.45)]">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Form */}
              <form onSubmit={handleSendReply} className="flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={
                    activeConversation.isTakeover
                      ? "Type manual reply to customer's WhatsApp..."
                      : "Type manual message (take over recommended for direct chat)..."
                  }
                  className="flex-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm placeholder:text-[hsl(var(--foreground)/0.4)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Send
                </button>
              </form>
            </SectionCard>
          ) : (
            <SectionCard>
              <div className="py-24 text-center text-sm text-[hsl(var(--foreground)/0.5)]">
                <MessageSquare size={32} className="mx-auto opacity-30" />
                <p className="mt-3">Select a conversation from the left to view customer thread & AI details.</p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
