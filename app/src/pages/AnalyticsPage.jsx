import React from 'react';
import {
  BarChart3,
  Bot,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Package,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  Loader2
} from 'lucide-react?deps=react';

import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { apiClient } from '../api/client.js';
import { useToast } from '../toast.jsx';

export function AnalyticsPage() {
  const { pushToast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [overview, setOverview] = React.useState(null);
  const [intents, setIntents] = React.useState([]);
  const [agents, setAgents] = React.useState([]);
  const [commerceProducts, setCommerceProducts] = React.useState(null);
  const [commerceOrders, setCommerceOrders] = React.useState(null);

  const fetchAllAnalytics = React.useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, intRes, agRes, prRes, ordRes] = await Promise.all([
        apiClient.get('/analytics/overview'),
        apiClient.get('/analytics/intents'),
        apiClient.get('/analytics/agents'),
        apiClient.get('/analytics/products'),
        apiClient.get('/analytics/orders')
      ]);

      if (ovRes) setOverview(ovRes);
      if (intRes && intRes.intents) setIntents(intRes.intents);
      if (agRes && agRes.agents) setAgents(agRes.agents);
      if (prRes) setCommerceProducts(prRes);
      if (ordRes) setCommerceOrders(ordRes);
    } catch (err) {
      pushToast({ title: 'Analytics error', body: err.message, tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  React.useEffect(() => {
    fetchAllAnalytics();
  }, [fetchAllAnalytics]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Merchant Control Center"
        title="AI & Commerce Analytics"
        description="Live operational telemetry, automated agent utilization, customer intent tracking, and catalog demand intelligence."
        actions={
          <button
            onClick={fetchAllAnalytics}
            className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold shadow-soft hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {/* Module 3: AI Analytics KPI Cards */}
      <div>
        <div className="mb-3 text-xs uppercase tracking-[0.16em] font-bold text-[hsl(var(--foreground)/0.5)]">
          Conversational AI Performance
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Total Conversations"
            value={overview?.totalConversations ?? 0}
            help="WhatsApp customer threads"
            icon={MessageSquare}
          />
          <StatCard
            label="Total Messages"
            value={overview?.totalMessages ?? 0}
            help="Customer & AI messages"
            icon={BarChart3}
          />
          <StatCard
            label="AI Resolved"
            value={overview?.aiResolvedConversations ?? 0}
            help="Closed without human intervention"
            icon={CheckCircle2}
          />
          <StatCard
            label="Human Escalations"
            value={overview?.humanEscalations ?? 0}
            help="Taken over by merchant"
            icon={AlertTriangle}
          />
          <StatCard
            label="Fallback Rate"
            value={`${overview?.fallbackRate ?? 0}%`}
            help="Deterministic safety rate"
            icon={HelpCircle}
          />
          <StatCard
            label="Avg Response Time"
            value={`${overview?.averageResponseTime ?? 0}ms`}
            help="Sub-second AI pipeline"
            icon={Clock}
          />
        </div>
      </div>

      {/* Daily Volume & Intent Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Daily Conversations Trend */}
        <div className="lg:col-span-6">
          <SectionCard>
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
              <div>
                <h3 className="font-semibold">Daily Conversations (Last 7 Days)</h3>
                <p className="text-xs text-[hsl(var(--foreground)/0.55)]">Incoming customer chat traffic</p>
              </div>
              <TrendingUp size={18} className="text-[hsl(var(--primary))]" />
            </div>

            <div className="mt-5 space-y-3">
              {overview?.dailyConversations?.length > 0 ? (
                overview.dailyConversations.map((d) => {
                  const maxCount = Math.max(...overview.dailyConversations.map((x) => x.count), 1);
                  const barWidth = Math.round((d.count / maxCount) * 100);

                  return (
                    <div key={d.date} className="flex items-center gap-3 text-xs">
                      <span className="w-20 shrink-0 font-medium text-[hsl(var(--foreground)/0.7)]">
                        {d.date.slice(5)}
                      </span>
                      <div className="h-4 flex-1 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-500"
                          style={{ width: `${Math.max(barWidth, 4)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-bold">{d.count}</span>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 text-center text-xs text-[hsl(var(--foreground)/0.4)]">
                  No activity recorded this week yet.
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Top Customer Intents */}
        <div className="lg:col-span-6">
          <SectionCard>
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
              <div>
                <h3 className="font-semibold">Top Customer Intents</h3>
                <p className="text-xs text-[hsl(var(--foreground)/0.55)]">Supervisor classification distribution</p>
              </div>
              <Bot size={18} className="text-[hsl(var(--primary))]" />
            </div>

            <div className="mt-5 space-y-3.5">
              {intents.length > 0 ? (
                intents.slice(0, 5).map((item) => (
                  <div key={item.intent} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">{item.intent}</span>
                      <span className="font-bold text-[hsl(var(--primary))]">
                        {item.count} ({item.percentage}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[hsl(var(--primary))]"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-[hsl(var(--foreground)/0.4)]">
                  No customer intent logs recorded yet.
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Most Used Agents & Order Insights */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Most Used Agents */}
        <div className="lg:col-span-5">
          <SectionCard>
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
              <div>
                <h3 className="font-semibold">Specialized AI Agents</h3>
                <p className="text-xs text-[hsl(var(--foreground)/0.55)]">Execution share by sub-agent</p>
              </div>
              <ShieldCheck size={18} className="text-emerald-500" />
            </div>

            <div className="mt-4 space-y-3">
              {agents.length > 0 ? (
                agents.map((ag) => (
                  <div
                    key={ag.agent}
                    className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-xs shadow-soft"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-bold">
                        <Bot size={15} />
                      </div>
                      <span className="font-semibold">{ag.agent}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-[hsl(var(--foreground))]">{ag.count} queries</span>
                      <span className="ml-2 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--foreground)/0.7)]">
                        {ag.percentage}%
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-[hsl(var(--foreground)/0.4)]">
                  Agent usage stats will appear here after first customer interaction.
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Commerce Orders & Cancellations */}
        <div className="lg:col-span-7">
          <SectionCard>
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
              <div>
                <h3 className="font-semibold">Order Inquiries & Status Breakdown</h3>
                <p className="text-xs text-[hsl(var(--foreground)/0.55)]">COD confirmation and cancellation demand</p>
              </div>
              <ShoppingBag size={18} className="text-emerald-500" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-center">
                <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Order Queries</div>
                <div className="mt-1 text-xl font-bold">{commerceOrders?.orderQueriesCount ?? 0}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-center">
                <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Cancellation Requests</div>
                <div className="mt-1 text-xl font-bold text-amber-500">{commerceOrders?.cancellationRequestsCount ?? 0}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-center">
                <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Delivered Orders</div>
                <div className="mt-1 text-xl font-bold text-emerald-500">{commerceOrders?.statusBreakdown?.delivered ?? 0}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-center">
                <div className="text-xs text-[hsl(var(--foreground)/0.6)]">Total Revenue</div>
                <div className="mt-1 text-xl font-bold">
                  PKR {(commerceOrders?.totalRevenue ?? 0).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <div className="text-xs font-bold text-[hsl(var(--foreground)/0.7)]">Fulfillment Statuses:</div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-2">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Pending: </span>
                  <strong className="text-[hsl(var(--foreground))]">{commerceOrders?.statusBreakdown?.pending ?? 0}</strong>
                </div>
                <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-2">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Confirmed: </span>
                  <strong className="text-emerald-500">{commerceOrders?.statusBreakdown?.confirmed ?? 0}</strong>
                </div>
                <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-2">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Shipped: </span>
                  <strong className="text-blue-500">{commerceOrders?.statusBreakdown?.shipped ?? 0}</strong>
                </div>
                <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-2">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Delivered: </span>
                  <strong className="text-emerald-600">{commerceOrders?.statusBreakdown?.delivered ?? 0}</strong>
                </div>
                <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-2">
                  <span className="text-[hsl(var(--foreground)/0.6)]">Cancelled: </span>
                  <strong className="text-red-500">{commerceOrders?.statusBreakdown?.cancelled ?? 0}</strong>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Module 4: Commerce Product Demand & Inventory Insights */}
      <div>
        <div className="mb-3 text-xs uppercase tracking-[0.16em] font-bold text-[hsl(var(--foreground)/0.5)]">
          Commerce Demand & Inventory Intelligence
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Most Searched Products */}
          <div className="lg:col-span-6">
            <SectionCard>
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
                <div>
                  <h3 className="font-semibold">Most Searched Products</h3>
                  <p className="text-xs text-[hsl(var(--foreground)/0.55)]">Customer catalog demand from AI chats</p>
                </div>
                <Package size={18} className="text-[hsl(var(--primary))]" />
              </div>

              <div className="mt-4 divide-y divide-[hsl(var(--border)/0.5)] text-xs">
                {commerceProducts?.mostSearched?.length > 0 ? (
                  commerceProducts.mostSearched.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="font-semibold text-sm">{p.name}</div>
                        <div className="text-[11px] text-[hsl(var(--foreground)/0.6)]">
                          Category: {p.category || 'General'} · PKR {p.price.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="rounded-full bg-[hsl(var(--primary)/0.12)] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--primary))]">
                          {p.searchCount} searches
                        </span>
                        <div className="mt-1 text-[10px] text-[hsl(var(--foreground)/0.6)]">
                          Stock: {p.stock}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-[hsl(var(--foreground)/0.4)]">
                    No product search trends recorded yet.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Inventory Insights: Low Stock & Unavailable Requested */}
          <div className="lg:col-span-6">
            <SectionCard>
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
                <div>
                  <h3 className="font-semibold">Inventory Alert Center</h3>
                  <p className="text-xs text-[hsl(var(--foreground)/0.55)]">Stockouts & items with customer demand</p>
                </div>
                <AlertTriangle size={18} className="text-amber-500" />
              </div>

              <div className="mt-4 space-y-4">
                {/* Low Stock Alerts */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-500">
                    <AlertCircle size={14} />
                    <span>Low Stock Products (Stock ≤ 5)</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {commerceProducts?.lowStockProducts?.length > 0 ? (
                      commerceProducts.lowStockProducts.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 p-2 text-xs"
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="font-bold text-amber-500">{p.stock} left in stock</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-[hsl(var(--foreground)/0.4)] italic">
                        All active inventory above threshold.
                      </p>
                    )}
                  </div>
                </div>

                {/* Frequently Requested Unavailable Items */}
                <div className="pt-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-500">
                    <AlertCircle size={14} />
                    <span>Unavailable Products with Customer Demand</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {commerceProducts?.unavailableProducts?.length > 0 ? (
                      commerceProducts.unavailableProducts.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/5 p-2 text-xs"
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="font-bold text-red-500">{p.queries} customer requests</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-[hsl(var(--foreground)/0.4)] italic">
                        No customer queries for unavailable inventory.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
