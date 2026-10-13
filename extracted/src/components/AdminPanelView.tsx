import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  Users, 
  Coins, 
  ShoppingBag, 
  Settings as SettingsIcon, 
  FileText, 
  Activity, 
  Search, 
  Check, 
  X, 
  UserX, 
  UserCheck, 
  Trash2, 
  RefreshCw, 
  ExternalLink, 
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  MessageSquare,
  Lock,
  Sparkles,
  Bot,
  Zap,
  Tag,
  Building2,
  Crown,
  Mic
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../context/AppContext';
import { soundFX } from '../utils/sound';
import { 
  AdminCustomer, 
  PurchaseRequest, 
  AdminAuditLog, 
  AdminOverviewStats 
} from '../types';
import { VoiceAutoRepliesAdmin } from './VoiceAutoRepliesAdmin';

type AdminTab = 'overview' | 'customers' | 'wallet' | 'plans' | 'purchases' | 'voice' | 'settings' | 'audit';

export const AdminPanelView: React.FC = () => {
  const { user, isAdmin, addToast } = useApp();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Manual Coin Add / Deduct Modal State
  const [coinModalOpen, setCoinModalOpen] = useState(false);
  const [targetCustomer, setTargetCustomer] = useState<AdminCustomer | null>(null);
  const [coinAction, setCoinAction] = useState<'ADD' | 'DEDUCT'>('ADD');
  const [coinAmount, setCoinAmount] = useState<number>(50);
  const [coinReason, setCoinReason] = useState<string>('Manual Topup / Bonus');
  const [isCoinSubmitting, setIsCoinSubmitting] = useState(false);

  // Customer Note Modal State
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [customerNoteText, setCustomerNoteText] = useState('');

  // Settings form state
  const [storeName, setStoreName] = useState('YASHI HALLS Cloud Platform');
  const [adminWhatsapp, setAdminWhatsapp] = useState('0740712934');
  const [proCoinPrice, setProCoinPrice] = useState(10);
  const [businessCoinPrice, setBusinessCoinPrice] = useState(30);

  const fetchAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const headers = {
        'x-admin-email': user.email,
        'Content-Type': 'application/json',
      };

      const [resOverview, resCust, resPurch, resLogs, resSettings] = await Promise.all([
        fetch('/api/admin/overview', { headers }),
        fetch('/api/admin/customers', { headers }),
        fetch('/api/admin/purchase-requests', { headers }),
        fetch('/api/admin/audit-logs', { headers }),
        fetch('/api/admin/settings', { headers }),
      ]);

      if (resOverview.ok) {
        const d = await resOverview.json();
        if (d.success) setStats(d.data);
      }
      if (resCust.ok) {
        const d = await resCust.json();
        if (d.success) setCustomers(d.data);
      }
      if (resPurch.ok) {
        const d = await resPurch.json();
        if (d.success) setPurchases(d.data);
      }
      if (resLogs.ok) {
        const d = await resLogs.json();
        if (d.success) setAuditLogs(d.data);
      }
      if (resSettings.ok) {
        const d = await resSettings.json();
        if (d.success) {
          setSystemSettings(d.data);
          setStoreName(d.data.storeName || '');
          setAdminWhatsapp(d.data.adminWhatsapp || '');
          if (d.data.planPricesCoins) {
            setProCoinPrice(d.data.planPricesCoins.pro || 10);
            setBusinessCoinPrice(d.data.planPricesCoins.business || 30);
          }
        }
      }
    } catch (err: any) {
      addToast('Failed to load admin dataset', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, user.email, addToast]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // If Not Authorized Master Admin: Strictly Block
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border-2 border-rose-500/50 flex items-center justify-center mx-auto text-rose-400 shadow-[0_0_30px_rgba(244,63,94,0.3)]">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-white">ACCESS DENIED</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          The requested console requires verified Root Master Administrator permissions.
          Only <strong className="text-cyan-400 font-mono">sawrikasuraj759@gmail.com</strong> is authorized to view this control center.
        </p>
      </div>
    );
  }

  // --- ACTIONS ---

  const handleModifyCoins = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCustomer) return;
    setIsCoinSubmitting(true);
    soundFX.playClick();

    try {
      const res = await fetch('/api/admin/coins/adjust', {
        method: 'POST',
        headers: {
          'x-admin-email': user.email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: targetCustomer.id,
          action: coinAction,
          amount: coinAmount,
          reason: coinReason,
        }),
      });

      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast(data.message, 'success');
        setCoinModalOpen(false);
        await fetchAdminData();
      } else {
        addToast(data.message || 'Failed to adjust coins', 'error');
      }
    } catch (err: any) {
      addToast(err?.message || 'Server error', 'error');
    } finally {
      setIsCoinSubmitting(false);
    }
  };

  const handleToggleSuspend = async (cust: AdminCustomer) => {
    soundFX.playClick();
    const action = cust.isSuspended ? 'unsuspend' : 'suspend';
    if (!window.confirm(`Are you sure you want to ${action} customer "${cust.username}" (${cust.email})?`)) {
      return;
    }

    try {
      const res = await fetch('/api/admin/customers/suspend', {
        method: 'POST',
        headers: {
          'x-admin-email': user.email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: cust.id,
          isSuspended: !cust.isSuspended,
        }),
      });
      const data = await res.json();
      if (data.success) {
        addToast(`Customer ${cust.email} ${cust.isSuspended ? 'unsuspended' : 'suspended'}!`, 'info');
        await fetchAdminData();
      }
    } catch {
      addToast('Failed to update suspension status', 'error');
    }
  };

  const handleDeleteCustomer = async (cust: AdminCustomer) => {
    soundFX.playClick();
    if (!window.confirm(`⚠️ DANGER: Permanently delete customer "${cust.username}" (${cust.email}) and wipe all records?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/customers/${cust.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-email': user.email },
      });
      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast(data.message, 'success');
        await fetchAdminData();
      }
    } catch {
      addToast('Failed to delete customer', 'error');
    }
  };

  const handleFulfillPurchase = async (req: PurchaseRequest, action: 'APPROVE' | 'REJECT') => {
    soundFX.playClick();
    const promptText = action === 'APPROVE' 
      ? `Approve and fulfill ${req.itemName} for ${req.customerEmail}?` 
      : `Reject purchase request ${req.referenceId}?`;

    if (!window.confirm(promptText)) return;

    try {
      const res = await fetch('/api/admin/purchase-requests/fulfill', {
        method: 'POST',
        headers: {
          'x-admin-email': user.email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: req.id,
          action,
          adminNote: `Processed by ${user.email} at ${new Date().toLocaleTimeString()}`,
        }),
      });

      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast(data.message, 'success');
        await fetchAdminData();
      } else {
        addToast(data.message || 'Operation failed', 'error');
      }
    } catch (err: any) {
      addToast(err?.message || 'Error fulfilling request', 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'x-admin-email': user.email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeName,
          adminWhatsapp,
          planPricesCoins: {
            mini: 0,
            pro: proCoinPrice,
            business: businessCoinPrice,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast('System settings saved successfully!', 'success');
        await fetchAdminData();
      }
    } catch {
      addToast('Failed to save settings', 'error');
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.email.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  });

  const filteredPurchases = purchases.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    const q = searchQuery.toLowerCase();
    return (
      p.customerEmail.toLowerCase().includes(q) ||
      p.referenceId.toLowerCase().includes(q) ||
      p.itemName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-6 pb-28">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-gradient-to-r from-amber-950/40 via-[#101b2b] to-[#0a1422] border-2 border-amber-500/50 shadow-[0_0_35px_rgba(245,158,11,0.25)]">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center text-amber-300 shrink-0">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                MASTER ADMIN COMMAND CENTER
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400 text-amber-300 font-mono text-[10px] font-bold">
                ROOT PRIVILEGES
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              Authenticated Admin: <span className="text-white font-bold">{user.email}</span>
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            soundFX.playClick();
            fetchAdminData();
          }}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#142337] hover:bg-[#1c324e] border border-cyan-500/40 text-cyan-300 text-xs font-bold transition-all shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {[
          { id: 'overview', label: 'Overview', icon: Activity },
          { id: 'customers', label: `Customers (${customers.length})`, icon: Users },
          { id: 'wallet', label: 'Wallet & Coins', icon: Coins },
          { id: 'purchases', label: `Purchases (${purchases.filter(p => p.status === 'PENDING').length} Pending)`, icon: ShoppingBag },
          { id: 'plans', label: 'Plan Pricing', icon: Tag },
          { id: 'voice', label: 'Voice Auto-Replies', icon: Mic },
          { id: 'settings', label: 'Settings', icon: SettingsIcon },
          { id: 'audit', label: 'Audit Logs', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                soundFX.playClick();
                setActiveTab(tab.id as AdminTab);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
                  : 'bg-[#0b1422] text-slate-400 hover:text-white border border-[#162740]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">TOTAL CUSTOMERS</span>
              <div className="text-2xl font-black text-white font-mono">{stats?.totalCustomers ?? customers.length}</div>
              <span className="text-[10px] text-emerald-400">{stats?.activeCustomers ?? customers.length} Active</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">TOTAL CIRCULATION COINS</span>
              <div className="text-2xl font-black text-amber-400 font-mono">{stats?.totalCoinsInCirculation ?? 0}</div>
              <span className="text-[10px] text-slate-400">Across user wallets</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">PENDING PURCHASES</span>
              <div className="text-2xl font-black text-cyan-400 font-mono">{stats?.pendingPurchases ?? 0}</div>
              <span className="text-[10px] text-amber-400">Awaiting Admin Check</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">SYSTEM HEALTH</span>
              <div className="text-base font-black text-emerald-400 font-mono mt-1">OPERATIONAL</div>
              <span className="text-[10px] text-slate-400">Baileys Cluster 24/7</span>
            </div>
          </div>

          {/* Plan Distribution & Pending Request Callouts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Crown className="w-4 h-4 text-cyan-400" />
                <span>Tier Plan Distribution</span>
              </h3>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="p-3 rounded-xl bg-[#0d1c2e] border border-emerald-500/30 text-center">
                  <div className="text-xs font-mono text-emerald-400 font-bold">MINI (FREE)</div>
                  <div className="text-xl font-mono font-black text-white mt-1">
                    {stats?.planDistribution.mini ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#0d1c2e] border border-cyan-500/30 text-center">
                  <div className="text-xs font-mono text-cyan-400 font-bold">PRO (PAID)</div>
                  <div className="text-xl font-mono font-black text-white mt-1">
                    {stats?.planDistribution.pro ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#0d1c2e] border border-amber-500/30 text-center">
                  <div className="text-xs font-mono text-amber-400 font-bold">BUSINESS</div>
                  <div className="text-xl font-mono font-black text-white mt-1">
                    {stats?.planDistribution.business ?? 0}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-amber-400" />
                  <span>Pending Approval Queue</span>
                </h3>
                <span className="text-xs font-mono text-cyan-400 cursor-pointer" onClick={() => setActiveTab('purchases')}>
                  View all →
                </span>
              </div>

              {purchases.filter(p => p.status === 'PENDING').length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 font-mono">
                  No pending manual purchase requests. All caught up!
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {purchases.filter(p => p.status === 'PENDING').slice(0, 3).map((req) => (
                    <div key={req.id} className="p-3 rounded-xl bg-[#0e1c2d] border border-cyan-500/30 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-white">{req.itemName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{req.customerEmail} · {req.priceFormatted}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleFulfillPurchase(req, 'APPROVE')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[10px]"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOMERS */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex items-center gap-2 bg-[#09121e] border border-[#162740] rounded-2xl px-4 py-2.5 text-xs text-white">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customers by Email, Name, or Customer ID..."
              className="bg-transparent flex-1 focus:outline-none placeholder-slate-500 text-white font-mono"
            />
          </div>

          {/* Customer Table */}
          <div className="rounded-3xl bg-[#081220] border border-[#15273f] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0e1c2d] text-slate-400 font-mono border-b border-[#162740]">
                  <tr>
                    <th className="p-3.5">Customer</th>
                    <th className="p-3.5">Plan Tier</th>
                    <th className="p-3.5">Coins Balance</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Joined</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#122238] text-slate-300">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 font-mono">
                        No customers found matching "{searchQuery}"
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((c) => (
                      <tr key={c.id} className="hover:bg-[#0c1827] transition-colors">
                        <td className="p-3.5">
                          <div className="font-bold text-white">{c.username}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{c.email}</div>
                          {c.adminNote && (
                            <div className="text-[10px] text-amber-300 italic mt-0.5">Note: {c.adminNote}</div>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase ${
                            c.plan === 'business'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : c.plan === 'pro'
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          }`}>
                            {c.plan}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono font-bold text-amber-400">
                          {c.coins} coins
                        </td>
                        <td className="p-3.5">
                          {c.isSuspended ? (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 font-mono text-[10px] font-bold">
                              SUSPENDED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold">
                              ACTIVE
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-[11px] text-slate-400">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                          {/* Add / Deduct Coins */}
                          <button
                            onClick={() => {
                              soundFX.playClick();
                              setTargetCustomer(c);
                              setCoinAction('ADD');
                              setCoinModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[10px] border border-amber-500/40"
                          >
                            +/- Coins
                          </button>

                          {/* Suspend Toggle */}
                          <button
                            onClick={() => handleToggleSuspend(c)}
                            className={`p-1.5 rounded-lg border transition-colors ${
                              c.isSuspended
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            }`}
                            title={c.isSuspended ? 'Unsuspend' : 'Suspend'}
                          >
                            {c.isSuspended ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteCustomer(c)}
                            className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-500/40"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WALLET & MANUAL COINS */}
      {activeTab === 'wallet' && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-400" />
              <span>Manual Coin Grant & Deduct Hub</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Master Admin has full authority to directly credit or debit coins from customer balances. 
              All coin modifications are recorded into the immutable Audit Log.
            </p>

            <div className="pt-2">
              <button
                onClick={() => {
                  soundFX.playClick();
                  setTargetCustomer(customers[0] || null);
                  setCoinAction('ADD');
                  setCoinModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wide shadow-md"
              >
                + Open Manual Coin Adjustment Dialog
              </button>
            </div>
          </div>

          {/* Customer Balances Quick List */}
          <div className="rounded-3xl bg-[#081220] border border-[#15273f] p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">Customer Coin Directory</h4>
            <div className="divide-y divide-[#15273f]">
              {customers.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-white">{c.username}</span>
                    <span className="text-slate-400 font-mono ml-2">({c.email})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-amber-400 text-sm">{c.coins} coins</span>
                    <button
                      onClick={() => {
                        soundFX.playClick();
                        setTargetCustomer(c);
                        setCoinAction('ADD');
                        setCoinModalOpen(true);
                      }}
                      className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/40"
                    >
                      Modify
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PURCHASES APPROVAL CENTER */}
      {activeTab === 'purchases' && (
        <div className="space-y-4">
          {/* Status Filter */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {['ALL', 'PENDING', 'FULFILLED', 'REJECTED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                  statusFilter === st
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-[#09121e] text-slate-400 border border-[#17273d]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Requests Cards */}
          <div className="space-y-3">
            {filteredPurchases.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500 font-mono rounded-3xl bg-[#081220] border border-[#15273f]">
                No purchase requests in status "{statusFilter}".
              </div>
            ) : (
              filteredPurchases.map((req) => (
                <div
                  key={req.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                    req.status === 'PENDING'
                      ? 'bg-gradient-to-br from-cyan-950/30 to-[#0e1c2d] border-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.15)]'
                      : req.status === 'FULFILLED'
                      ? 'bg-[#091422] border-emerald-500/40'
                      : 'bg-[#09121e] border-[#182a40]'
                  } space-y-3`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#14263e] pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base">{req.itemName}</span>
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase ${
                          req.status === 'PENDING'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                            : req.status === 'FULFILLED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">
                        Ref: <strong className="text-cyan-300">{req.referenceId}</strong> · Submitted: {new Date(req.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-mono font-black text-amber-400">{req.priceFormatted}</div>
                      {req.coinAmount && (
                        <div className="text-[11px] text-slate-400 font-mono">+{req.coinAmount} Coins grant</div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-400 block mb-0.5">Customer Details:</span>
                      <span className="font-bold text-white">{req.customerName}</span> ({req.customerEmail})
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Direct WhatsApp Link:</span>
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`Hi ${req.customerName}, YASHI HALLS admin here regarding purchase Ref: ${req.referenceId}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        <span>Chat on WhatsApp</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* Actions if Pending */}
                  {req.status === 'PENDING' && (
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        onClick={() => handleFulfillPurchase(req, 'APPROVE')}
                        className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>APPROVE & FULFILL NOW</span>
                      </button>

                      <button
                        onClick={() => handleFulfillPurchase(req, 'REJECT')}
                        className="py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-bold text-xs uppercase"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 5: PLAN PRICING */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          <form onSubmit={handleSaveSettings} className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Tag className="w-5 h-5 text-cyan-400" />
              <span>MINI / PRO / BUSINESS Coin Pricing Configuration</span>
            </h3>
            <p className="text-xs text-slate-400">
              MINI plan remains permanently 0 coins (Free). Configure coin upgrade costs for PRO and BUSINESS tiers:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-[#0e1c2d] border border-emerald-500/40 space-y-2">
                <span className="text-xs font-mono font-bold text-emerald-400">YASHI HALLS MINI</span>
                <input
                  type="text"
                  value="0 Coins (Free)"
                  disabled
                  className="w-full bg-[#07111c] border border-[#162740] rounded-xl px-3 py-2 text-xs font-mono text-slate-400"
                />
                <span className="text-[10px] text-slate-500 block">Default tier for all new accounts</span>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1c2d] border border-cyan-500/40 space-y-2">
                <span className="text-xs font-mono font-bold text-cyan-400">YASHI HALLS PRO</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={proCoinPrice}
                    onChange={(e) => setProCoinPrice(Number(e.target.value))}
                    className="w-full bg-[#07111c] border border-cyan-500/50 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-xs font-mono text-slate-400">coins</span>
                </div>
                <span className="text-[10px] text-slate-400 block">5 Bot slots, unlimited quotas</span>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1c2d] border border-amber-500/40 space-y-2">
                <span className="text-xs font-mono font-bold text-amber-400">YASHI HALLS BUSINESS</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={businessCoinPrice}
                    onChange={(e) => setBusinessCoinPrice(Number(e.target.value))}
                    className="w-full bg-[#07111c] border border-amber-500/50 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-xs font-mono text-slate-400">coins</span>
                </div>
                <span className="text-[10px] text-slate-400 block">25 Bot slots, VIP Enterprise SLA</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider"
              >
                Save Plan Prices
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 6: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <form onSubmit={handleSaveSettings} className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-amber-400" />
              <span>General Platform & WhatsApp Configuration</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Brand / Platform Name</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full bg-[#0a1422] border border-[#17273d] rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Admin WhatsApp Contact Number</label>
                <input
                  type="text"
                  value={adminWhatsapp}
                  onChange={(e) => setAdminWhatsapp(e.target.value)}
                  placeholder="0740712934"
                  className="w-full bg-[#0a1422] border border-[#17273d] rounded-xl px-3 py-2 text-xs font-mono text-white"
                />
                <span className="text-[10px] text-slate-400">Used by customer "Contact Admin to Purchase" button</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs uppercase tracking-wider"
              >
                Update System Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB: VOICE AUTO-REPLIES */}
      {activeTab === 'voice' && (
        <VoiceAutoRepliesAdmin
          userEmail={user.email}
          addToast={addToast}
          customers={customers}
        />
      )}

      {/* TAB 7: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-[#081220] border border-[#15273f] p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span>Immutable Admin Audit Trail</span>
            </h3>
            <p className="text-xs text-slate-400">
              Every sensitive administrative action, coin grant, suspension, and purchase approval is logged below.
            </p>

            <div className="space-y-2 pt-2 max-h-96 overflow-y-auto pr-1">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 rounded-xl bg-[#0c1827] border border-[#162740] text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span className="text-amber-400 font-bold">{log.action}</span>
                    <span>{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="text-white leading-relaxed">{log.details}</div>
                  <div className="text-[10px] text-slate-500">By: {log.adminEmail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: COIN ADD / DEDUCT */}
      <AnimatePresence>
        {coinModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              className="w-full max-w-md rounded-3xl bg-[#081220] border-2 border-amber-500/50 p-5 sm:p-6 shadow-[0_0_40px_rgba(245,158,11,0.3)] space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#14263e]">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-400" />
                  <span>Manual Coin Adjustment</span>
                </h3>
                <button onClick={() => setCoinModalOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleModifyCoins} className="space-y-3.5">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Target Customer</label>
                  <select
                    value={targetCustomer?.id || ''}
                    onChange={(e) => {
                      const found = customers.find((c) => c.id === e.target.value);
                      if (found) setTargetCustomer(found);
                    }}
                    className="w-full bg-[#0a1626] border border-[#172b45] rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.username} ({c.email}) — Balance: {c.coins} coins
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCoinAction('ADD')}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      coinAction === 'ADD'
                        ? 'bg-emerald-500 text-slate-950 shadow-md'
                        : 'bg-[#0a1626] text-slate-400 border border-[#172b45]'
                    }`}
                  >
                    + ADD COINS
                  </button>

                  <button
                    type="button"
                    onClick={() => setCoinAction('DEDUCT')}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      coinAction === 'DEDUCT'
                        ? 'bg-rose-500 text-white shadow-md'
                        : 'bg-[#0a1626] text-slate-400 border border-[#172b45]'
                    }`}
                  >
                    - DEDUCT COINS
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Coin Amount</label>
                  <input
                    type="number"
                    min="1"
                    value={coinAmount}
                    onChange={(e) => setCoinAmount(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-[#0a1626] border border-[#172b45] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Audit Reason</label>
                  <input
                    type="text"
                    value={coinReason}
                    onChange={(e) => setCoinReason(e.target.value)}
                    placeholder="e.g. Manual bank deposit verified / Launch promo"
                    className="w-full bg-[#0a1626] border border-[#172b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={isCoinSubmitting}
                    className="flex-1 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wider"
                  >
                    {isCoinSubmitting ? 'Updating Balance...' : `CONFIRM ${coinAction} ${coinAmount} COINS`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCoinModalOpen(false)}
                    className="py-3 px-4 rounded-xl bg-[#0b1626] text-slate-400 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
