import React from 'react';
import {
  Users,
  Search,
  RefreshCw,
  ShoppingBag,
  MessageCircle,
  BrainCircuit,
  Sparkles,
  Tag,
  DollarSign,
  Calendar,
  Phone,
  Mail,
  ChevronRight,
  X,
  Loader2,
  Package
} from 'lucide-react?deps=react';

import { PageHeader } from '../components/PageHeader.jsx';
import { SectionCard } from '../components/SectionCard.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { apiClient } from '../api/client.js';
import { useToast } from '../toast.jsx';

export function CustomersPage() {
  const { pushToast } = useToast();

  const [customers, setCustomers] = React.useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState(null);
  const [customerDetail, setCustomerDetail] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  const fetchCustomers = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      const res = await apiClient.get(`/customers?${params.toString()}`);
      if (res && res.customers) {
        setCustomers(res.customers);
      }
    } catch (err) {
      pushToast({ title: 'Error fetching customers', body: err.message, tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }, [search, pushToast]);

  const fetchCustomerDetail = React.useCallback(async (id) => {
    if (!id) return;
    setLoadingDetail(true);
    try {
      const res = await apiClient.get(`/customers/${id}`);
      if (res && res.customer) {
        setCustomerDetail(res.customer);
      }
    } catch (err) {
      pushToast({ title: 'Error fetching customer profile', body: err.message, tone: 'danger' });
    } finally {
      setLoadingDetail(false);
    }
  }, [pushToast]);

  React.useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  React.useEffect(() => {
    if (selectedCustomerId) {
      fetchCustomerDetail(selectedCustomerId);
    } else {
      setCustomerDetail(null);
    }
  }, [selectedCustomerId, fetchCustomerDetail]);

  const totalSpendAll = customers.reduce((sum, c) => sum + (c.totalSpend || 0), 0);
  const totalOrdersAll = customers.reduce((sum, c) => sum + (c.ordersCount || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Merchant Control Center"
        title="Customer Intelligence"
        description="Comprehensive customer profile memory, extracted AI preferences, order histories, and automated summaries."
        actions={
          <button
            onClick={fetchCustomers}
            className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold shadow-soft hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Customers"
          value={customers.length}
          help="Scoped to your store"
          icon={Users}
        />
        <StatCard
          label="Total Orders Placed"
          value={totalOrdersAll}
          help="Direct & WhatsApp orders"
          icon={ShoppingBag}
        />
        <StatCard
          label="Customer Lifetime Spend"
          value={`PKR ${totalSpendAll.toLocaleString()}`}
          help="Total revenue generated"
          icon={DollarSign}
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Customer Directory Table */}
        <div className={`space-y-4 ${selectedCustomerId ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
          <SectionCard>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-3 text-[hsl(var(--foreground)/0.45)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer name, phone, or email..."
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2.5 pl-10 pr-4 text-sm placeholder:text-[hsl(var(--foreground)/0.4)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                />
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] text-xs font-semibold text-[hsl(var(--foreground)/0.6)]">
                    <th className="pb-3 pl-2">Customer</th>
                    <th className="pb-3">Phone</th>
                    <th className="pb-3 text-center">Orders</th>
                    <th className="pb-3 text-right">Total Spent</th>
                    <th className="pb-3">AI Intelligence</th>
                    <th className="pb-3 pr-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--border)/0.5)]">
                  {loading && customers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-sm text-[hsl(var(--foreground)/0.5)]">
                        <Loader2 size={24} className="mx-auto animate-spin" />
                        <p className="mt-2">Loading customers...</p>
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-sm text-[hsl(var(--foreground)/0.5)]">
                        No customers found.
                      </td>
                    </tr>
                  ) : (
                    customers.map((c) => {
                      const isSelected = c.id === selectedCustomerId;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCustomerId(c.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[hsl(var(--primary)/0.08)]'
                              : 'hover:bg-[hsl(var(--muted)/0.5)]'
                          }`}
                        >
                          <td className="py-3.5 pl-2 font-medium">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[hsl(var(--primary)/0.12)] text-xs font-bold text-[hsl(var(--primary))]">
                                {c.name.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="truncate max-w-[140px] sm:max-w-none">{c.name}</span>
                            </div>
                          </td>
                          <td className="py-3.5 text-xs text-[hsl(var(--foreground)/0.7)]">{c.phone || '—'}</td>
                          <td className="py-3.5 text-center text-xs font-semibold">{c.ordersCount}</td>
                          <td className="py-3.5 text-right text-xs font-semibold">
                            PKR {(c.totalSpend || 0).toLocaleString()}
                          </td>
                          <td className="py-3.5">
                            {c.profileMemory ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] font-semibold text-violet-500">
                                <Sparkles size={11} /> Memory Active
                              </span>
                            ) : (
                              <span className="text-[11px] text-[hsl(var(--foreground)/0.4)]">Learning...</span>
                            )}
                          </td>
                          <td className="py-3.5 pr-2 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCustomerId(c.id);
                              }}
                              className="rounded-lg p-1.5 text-[hsl(var(--foreground)/0.6)] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                            >
                              <ChevronRight size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        {/* Customer Intelligence Dossier (Right Panel) */}
        {selectedCustomerId && (
          <div className="space-y-4 lg:col-span-5">
            <SectionCard>
              <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold sm:text-lg">
                      {customerDetail?.name || 'Customer Dossier'}
                    </h2>
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-500">
                      AI Profile Memory
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--foreground)/0.6)]">
                    <span className="inline-flex items-center gap-1">
                      <Phone size={12} /> {customerDetail?.phone || 'No phone'}
                    </span>
                    {customerDetail?.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={12} /> {customerDetail.email}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedCustomerId(null)}
                  className="rounded-xl border border-[hsl(var(--border))] p-1.5 text-[hsl(var(--foreground)/0.6)] hover:bg-[hsl(var(--muted))]"
                >
                  <X size={16} />
                </button>
              </div>

              {loadingDetail ? (
                <div className="py-16 text-center text-sm text-[hsl(var(--foreground)/0.5)]">
                  <Loader2 size={24} className="mx-auto animate-spin" />
                  <p className="mt-2">Retrieving memory context...</p>
                </div>
              ) : customerDetail ? (
                <div className="mt-4 space-y-5 text-sm">
                  {/* AI Memory Snapshot */}
                  <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-violet-600 dark:text-violet-400">
                      <BrainCircuit size={15} />
                      AI Intelligence Profile
                    </div>

                    <div className="mt-3 space-y-2.5 text-xs">
                      <div>
                        <span className="font-semibold text-[hsl(var(--foreground)/0.6)]">Preferred Categories:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {customerDetail.profileMemory?.preferredCategories?.length > 0 ? (
                            customerDetail.profileMemory.preferredCategories.map((cat, i) => (
                              <span key={i} className="rounded-lg bg-[hsl(var(--card))] px-2 py-0.5 font-medium border border-[hsl(var(--border))]">
                                {cat}
                              </span>
                            ))
                          ) : (
                            <span className="text-[hsl(var(--foreground)/0.4)] italic">No categories tracked yet</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="font-semibold text-[hsl(var(--foreground)/0.6)]">Preferred Products:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {customerDetail.profileMemory?.preferredProducts?.length > 0 ? (
                            customerDetail.profileMemory.preferredProducts.map((prod, i) => (
                              <span key={i} className="rounded-lg bg-[hsl(var(--card))] px-2 py-0.5 font-medium border border-[hsl(var(--border))]">
                                {prod}
                              </span>
                            ))
                          ) : (
                            <span className="text-[hsl(var(--foreground)/0.4)] italic">No product preferences recorded</span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <span className="font-semibold text-[hsl(var(--foreground)/0.6)]">Average Budget:</span>
                          <p className="font-medium text-[hsl(var(--foreground))]">
                            {customerDetail.profileMemory?.averageBudget
                              ? `PKR ${customerDetail.profileMemory.averageBudget.toLocaleString()}`
                              : 'Not specified'}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-[hsl(var(--foreground)/0.6)]">Preferences:</span>
                          <p className="font-medium text-[hsl(var(--foreground))]">
                            {customerDetail.profileMemory?.customerPreferences || 'Standard'}
                          </p>
                        </div>
                      </div>

                      {customerDetail.profileMemory?.interactionSummary && (
                        <div className="pt-1">
                          <span className="font-semibold text-[hsl(var(--foreground)/0.6)]">Interaction Summary:</span>
                          <p className="mt-0.5 leading-relaxed text-[hsl(var(--foreground)/0.8)]">
                            {customerDetail.profileMemory.interactionSummary}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Purchase History */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-bold text-[hsl(var(--foreground)/0.8)]">
                      <span>Order History ({customerDetail.orders?.length || 0})</span>
                      <span>Total: PKR {(customerDetail.totalSpending || 0).toLocaleString()}</span>
                    </div>

                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                      {customerDetail.orders?.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-center text-xs text-[hsl(var(--foreground)/0.5)]">
                          No orders placed yet.
                        </div>
                      ) : (
                        customerDetail.orders.map((ord) => (
                          <div
                            key={ord.id}
                            className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 text-xs shadow-soft"
                          >
                            <div>
                              <div className="font-semibold">Order #{ord.orderNumber || ord.id.slice(0, 8)}</div>
                              <div className="text-[10px] text-[hsl(var(--foreground)/0.5)]">
                                {new Date(ord.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold">PKR {(ord.totalAmount || 0).toLocaleString()}</div>
                              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                                {ord.status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Conversation History */}
                  <div>
                    <div className="text-xs font-bold text-[hsl(var(--foreground)/0.8)]">
                      Recent Conversations ({customerDetail.conversations?.length || 0})
                    </div>
                    <div className="mt-2 space-y-2">
                      {customerDetail.conversations?.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-center text-xs text-[hsl(var(--foreground)/0.5)]">
                          No conversations logged.
                        </div>
                      ) : (
                        customerDetail.conversations.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => {
                              window.location.hash = '/inbox';
                            }}
                            className="cursor-pointer rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-2.5 text-xs transition-colors hover:bg-[hsl(var(--muted)/0.7)]"
                          >
                            <div className="flex items-center justify-between font-semibold">
                              <span>Status: {c.status}</span>
                              <span className="text-[10px] text-[hsl(var(--foreground)/0.5)]">
                                {new Date(c.updatedAt).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-[hsl(var(--foreground)/0.65)]">
                              {c.lastMessage || 'Open chat in inbox'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
