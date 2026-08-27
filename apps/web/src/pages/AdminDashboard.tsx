// ============================================================
// POS Yoga — Admin Dashboard & Business Analytics Page
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/utils';
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Clock,
  Calendar,
  Package,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  CreditCard,
  Utensils,
  ChevronRight,
  Sparkles,
  Search,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type PeriodType = 'today' | 'yesterday' | '7days' | 'this_week' | 'last_week' | '30days' | 'this_month' | 'last_month' | 'custom';

export default function AdminDashboard() {
  const [period, setPeriod] = useState<PeriodType>('today');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');

  // Fetch Dashboard Analytics
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dashboard', period, fromDate, toDate],
    queryFn: () => {
      const params: any = { period };
      if (period === 'custom' && fromDate) {
        params.from = fromDate;
        if (toDate) params.to = toDate;
      }
      return api.get<{ data: any }>('/dashboard', params);
    },
    refetchInterval: 60000,
  });

  const stats = data?.data;
  const growth = stats?.growth;

  const PERIOD_OPTIONS: { id: PeriodType; label: string }[] = [
    { id: 'today', label: 'Hari Ini' },
    { id: 'yesterday', label: 'Kemarin' },
    { id: '7days', label: '7 Hari Terakhir' },
    { id: '30days', label: '30 Hari Terakhir' },
    { id: 'this_month', label: 'Bulan Ini' },
    { id: 'last_month', label: 'Bulan Lalu' },
    { id: 'custom', label: 'Kustom Tanggal' },
  ];

  const handlePeriodChange = (newPeriod: PeriodType) => {
    if (newPeriod === 'custom') {
      const today = new Date().toISOString().split('T')[0];
      if (!fromDate) setFromDate(today);
      if (!toDate) setToDate(today);
      setShowCustomModal(true);
    } else {
      setPeriod(newPeriod);
    }
  };

  const applyCustomDate = () => {
    if (fromDate) {
      setPeriod('custom');
      setShowCustomModal(false);
    }
  };

  // Filter top products with search
  const filteredProducts = (stats?.topProducts || []).filter((p: any) => {
    if (!menuSearch) return true;
    const q = menuSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.variantName && p.variantName.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      {/* Header & Filter Bar (Shopee / Grab Food Business Analytics Style) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Analisis Bisnis & Penjualan</h1>
            <span className="badge badge-primary text-xs font-semibold px-2 py-0.5">Live</span>
          </div>
          <p className="text-[var(--color-text-muted)] text-sm mt-0.5 flex items-center gap-2">
            <span>Ringkasan performa toko dan evaluasi produk</span>
            {stats?.dateRange && (
              <span className="text-xs bg-[var(--color-surface)] px-2 py-0.5 rounded border border-[var(--color-border)]">
                {stats.dateRange.isSingleDay
                  ? formatDateTime(stats.dateRange.from).split(' ')[0]
                  : `${formatDateTime(stats.dateRange.from).split(' ')[0]} s/d ${formatDateTime(stats.dateRange.to).split(' ')[0]}`}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn btn-secondary btn-sm gap-1.5 shrink-0"
            title="Muat Ulang Data"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs / Pills */}
      <div className="bg-[var(--color-surface)] p-1.5 rounded-xl border border-[var(--color-border)] flex items-center gap-1.5 overflow-x-auto no-scrollbar shadow-sm">
        {PERIOD_OPTIONS.map((opt) => {
          const isActive = period === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handlePeriodChange(opt.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                isActive
                  ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white font-bold shadow-md shadow-emerald-500/20'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-lighter)]'
              }`}
            >
              {opt.id === 'custom' && <Calendar size={13} />}
              {opt.label}
              {opt.id === 'custom' && period === 'custom' && fromDate && (
                <span className="text-[11px] opacity-90">
                  ({fromDate === toDate ? fromDate : `${fromDate} - ${toDate}`})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-80 gap-3">
          <div className="spinner" />
          <p className="text-sm text-[var(--color-text-muted)]">Menghitung analisis penjualan...</p>
        </div>
      ) : (
        <>
          {/* Main Financial KPI Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {/* 1. Total Penjualan (Omzet) */}
            <div className="stat-card shadow-blue-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Total Penjualan</span>
                <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <DollarSign size={15} />
                </div>
              </div>
              <p className="text-lg sm:text-xl font-bold text-blue-400 truncate">
                {formatCurrency(stats?.totalRevenue || 0)}
              </p>
              <div className="mt-2 flex items-center gap-1 text-[11px]">
                {growth?.revenue >= 0 ? (
                  <span className="text-emerald-400 font-semibold flex items-center">
                    <ArrowUpRight size={13} /> +{growth.revenue}%
                  </span>
                ) : (
                  <span className="text-rose-400 font-semibold flex items-center">
                    <ArrowDownRight size={13} /> {growth.revenue}%
                  </span>
                )}
                <span className="text-[var(--color-text-dim)] truncate">vs lalu</span>
              </div>
            </div>

            {/* 2. Total Modal (HPP) */}
            <div className="stat-card shadow-amber-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Total Modal (HPP)</span>
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Package size={15} />
                </div>
              </div>
              <p className="text-lg sm:text-xl font-bold text-amber-400 truncate">
                {formatCurrency(stats?.totalCost || 0)}
              </p>
              <div className="mt-2 text-[11px] text-[var(--color-text-dim)] truncate">
                Bahan baku & varian
              </div>
            </div>

            {/* 3. Total Pengeluaran */}
            <div className="stat-card shadow-rose-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Pengeluaran Ops</span>
                <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center">
                  <Receipt size={15} />
                </div>
              </div>
              <p className="text-lg sm:text-xl font-bold text-rose-400 truncate">
                {formatCurrency(stats?.totalExpenses || 0)}
              </p>
              <div className="mt-2 text-[11px] text-[var(--color-text-dim)] truncate">
                Biaya operasional
              </div>
            </div>

            {/* 4. Laba Bersih */}
            <div className="stat-card shadow-emerald-500/20 p-4 border border-emerald-500/30 rounded-xl bg-gradient-to-br from-emerald-950/30 to-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-emerald-300">Laba Bersih</span>
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <TrendingUp size={15} />
                </div>
              </div>
              <p className={`text-lg sm:text-xl font-bold truncate ${(stats?.netProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatCurrency(stats?.netProfit || 0)}
              </p>
              <div className="mt-2 flex items-center gap-1 text-[11px]">
                <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.2 rounded">
                  Margin: {stats?.profitMargin || 0}%
                </span>
              </div>
            </div>

            {/* 5. Total Transaksi */}
            <div className="stat-card shadow-purple-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Total Transaksi</span>
                <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                  <ShoppingCart size={15} />
                </div>
              </div>
              <p className="text-lg sm:text-xl font-bold text-purple-400 truncate">
                {stats?.totalOrders || 0} <span className="text-xs font-normal text-[var(--color-text-muted)]">order</span>
              </p>
              <div className="mt-2 flex items-center gap-1 text-[11px]">
                {growth?.orders >= 0 ? (
                  <span className="text-emerald-400 font-semibold flex items-center">
                    <ArrowUpRight size={13} /> +{growth.orders}%
                  </span>
                ) : (
                  <span className="text-rose-400 font-semibold flex items-center">
                    <ArrowDownRight size={13} /> {growth.orders}%
                  </span>
                )}
                <span className="text-[var(--color-text-dim)] truncate">vs lalu</span>
              </div>
            </div>

            {/* 6. Rata-rata per Pesanan (AOV) */}
            <div className="stat-card shadow-cyan-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">Rata2 Pesanan</span>
                <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                  <CreditCard size={15} />
                </div>
              </div>
              <p className="text-lg sm:text-xl font-bold text-cyan-400 truncate">
                {formatCurrency(stats?.aov || 0)}
              </p>
              <div className="mt-2 text-[11px] text-[var(--color-text-dim)] truncate">
                Per transaksi
              </div>
            </div>
          </div>

          {/* Interactive Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Trend Chart: Penjualan vs Modal vs Laba */}
            <div className="lg:col-span-2 glass-card p-5 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <TrendingUp size={18} className="text-blue-400" />
                    Tren Penjualan, Modal & Laba Bersih
                  </h3>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {stats?.dateRange?.isSingleDay ? 'Distribusi per jam' : 'Distribusi harian'}
                  </p>
                </div>
              </div>

              <div className="w-full h-[300px] min-h-[300px] min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                  <AreaChart data={stats?.trendChart || []}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorProf" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${(v / 1000)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value: number, name: string) => [
                        formatCurrency(value),
                        name === 'revenue' ? 'Penjualan' : name === 'profit' ? 'Laba Bersih' : name === 'cost' ? 'Modal (HPP)' : 'Pengeluaran',
                      ]}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      formatter={(val) => (
                        <span className="text-xs text-[var(--color-text)]">
                          {val === 'revenue' ? 'Penjualan' : val === 'profit' ? 'Laba Bersih' : val === 'cost' ? 'Modal' : val}
                        </span>
                      )}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} fill="url(#colorRev)" />
                    <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="url(#colorProf)" />
                    <Area type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={1.5} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Order Volume Chart */}
            <div className="glass-card p-5 min-w-0">
              <div className="mb-4">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <ShoppingCart size={18} className="text-purple-400" />
                  Volume Pesanan (Order)
                </h3>
                <p className="text-xs text-[var(--color-text-muted)]">Jumlah transaksi berhasil</p>
              </div>

              <div className="w-full h-[300px] min-h-[300px] min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                  <BarChart data={stats?.trendChart || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(v: number) => [`${v} Transaksi`, 'Pesanan']}
                    />
                    <Bar dataKey="orders" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top Selling Products & Menu Ranking (Gaya Shopee / Grab Food Analisis Bisnis) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Menu Terlaris Ranking Table (Col span 2) */}
            <div className="lg:col-span-2 glass-card p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-base flex items-center gap-2">
                    <Utensils size={18} className="text-amber-400" />
                    Menu & Varian Terlaris
                  </h3>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Peringkat menu yang paling banyak dipesan pada periode terpilih
                  </p>
                </div>
                <div className="relative w-full sm:w-56">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)]" />
                  <input
                    type="text"
                    placeholder="Cari menu / varian..."
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                    className="input input-sm pl-8 text-xs w-full"
                  />
                </div>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="text-center py-12 text-[var(--color-text-dim)]">
                  Belum ada transaksi menu pada periode ini.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                  {filteredProducts.map((p: any, i: number) => {
                    const isTop1 = p.rank === 1;
                    const isTop2 = p.rank === 2;
                    const isTop3 = p.rank === 3;

                    return (
                      <div
                        key={`${p.name}-${p.variantName}-${i}`}
                        className="flex items-center justify-between p-3 rounded-xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-lighter)] border border-[var(--color-border)] transition-all"
                      >
                        {/* Rank Badge & Product Name */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                              isTop1
                                ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/20'
                                : isTop2
                                ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-md shadow-slate-500/20'
                                : isTop3
                                ? 'bg-gradient-to-br from-amber-700 to-yellow-800 text-white'
                                : 'bg-[var(--color-surface-lighter)] text-[var(--color-text-muted)]'
                            }`}
                          >
                            {p.rank}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{p.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {p.variantName && p.variantName !== 'Biasa / Regular' && (
                                <span className="badge badge-secondary text-[10px] px-1.5 py-0">
                                  {p.variantName}
                                </span>
                              )}
                              <span className="text-[11px] text-[var(--color-text-dim)]">
                                Margin: {formatCurrency(p.profit)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Qty & Revenue */}
                        <div className="text-right shrink-0 pl-3">
                          <p className="text-sm font-bold text-[var(--color-primary-400)]">
                            {formatCurrency(p.revenue)}
                          </p>
                          <p className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center justify-end gap-1">
                            <span>{p.qty} terjual</span>
                            <span className="text-[10px] opacity-70">({p.percentage}%)</span>
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Side Column: Payment Breakdown & Peak Hours */}
            <div className="space-y-6">
              {/* Payment Methods Breakdown */}
              <div className="glass-card p-5 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <CreditCard size={16} className="text-cyan-400" />
                  Metode Pembayaran
                </h3>

                <div className="space-y-2.5">
                  {[
                    { label: 'Tunai (Cash)', data: stats?.paymentBreakdown?.cash, color: 'bg-emerald-500' },
                    { label: 'QRIS (Midtrans)', data: stats?.paymentBreakdown?.qris, color: 'bg-blue-500' },
                    { label: 'Transfer Bank', data: stats?.paymentBreakdown?.transfer, color: 'bg-purple-500' },
                  ].map((m) => {
                    const total = m.data?.total || 0;
                    const count = m.data?.count || 0;
                    const pct = (stats?.totalRevenue || 0) > 0 ? Math.round((total / stats.totalRevenue) * 100) : 0;

                    return (
                      <div key={m.label} className="p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium">{m.label}</span>
                          <span className="font-bold">{formatCurrency(total)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-[var(--color-text-dim)] mb-1.5">
                          <span>{count} transaksi</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-[var(--color-surface-lighter)] rounded-full overflow-hidden">
                          <div className={`h-full ${m.color}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Peak Hours Distribution */}
              <div className="glass-card p-5 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={16} className="text-amber-400" />
                  <h3 className="font-semibold text-sm">Jam Ramai Pesanan</h3>
                </div>
                <div className="w-full h-[160px] min-h-[160px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={160}>
                    <BarChart data={stats?.peakHours || []}>
                      <XAxis dataKey="hour" stroke="#64748b" fontSize={10} tickFormatter={(h) => `${h}:00`} />
                      <YAxis stroke="#64748b" fontSize={10} />
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                        labelFormatter={(h) => `Jam ${h}:00 - ${h}:59`}
                        formatter={(count: number) => [`${count} Transaksi`, 'Pesanan']}
                      />
                      <Bar dataKey="count" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Custom Date Modal */}
      {showCustomModal && (
        <div className="modal-overlay" onClick={() => setShowCustomModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Pilih Rentang Tanggal</h3>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
              Atur tanggal mulai dan tanggal akhir untuk analisis data
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">
                  Dari Tanggal:
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="input w-full text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--color-text-muted)] block mb-1">
                  Sampai Tanggal:
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="input w-full text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="btn btn-secondary btn-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={applyCustomDate}
                className="btn btn-primary btn-sm"
              >
                Terapkan Filter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

