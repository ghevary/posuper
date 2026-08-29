// ============================================================
// POS Yoga — Admin Expenses Page (Enhanced with Period Filter)
// ============================================================

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { Plus, Trash2, X, Loader2, Download, Search, Calendar, Filter, ChevronDown, TrendingDown, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/auth.store';

interface Expense {
  id: string;
  description: string;
  amount: string;
  date: string;
  userId: string;
  createdAt: string;
}

type PeriodType = 'all' | 'today' | 'yesterday' | '7days' | 'this_month' | 'last_month' | 'custom';

export default function AdminExpenses() {
  const { user } = useAuthStore();
  const canDelete = user?.role === 'admin' || user?.role === 'developer';

  const [period, setPeriod] = useState<PeriodType>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', date: new Date().toISOString().split('T')[0] });

  const qc = useQueryClient();

  // Compute date range in WIB (UTC+7)
  const dateRange = useMemo(() => {
    const now = new Date();
    const WIB_OFFSET = 7 * 60 * 60 * 1000;
    const nowWIB = new Date(now.getTime() + WIB_OFFSET);

    const makeISO = (y: number, m: number, d: number) =>
      `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    switch (period) {
      case 'today': {
        const todayStr = makeISO(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate());
        return { from: todayStr, to: todayStr, label: 'Hari Ini' };
      }
      case 'yesterday': {
        const y = new Date(nowWIB.getTime() - 24 * 60 * 60 * 1000);
        const yStr = makeISO(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate());
        return { from: yStr, to: yStr, label: 'Kemarin' };
      }
      case '7days': {
        const sevenDaysAgo = new Date(nowWIB.getTime() - 6 * 24 * 60 * 60 * 1000);
        return {
          from: makeISO(sevenDaysAgo.getUTCFullYear(), sevenDaysAgo.getUTCMonth(), sevenDaysAgo.getUTCDate()),
          to: makeISO(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate()),
          label: '7 Hari Terakhir',
        };
      }
      case 'this_month': {
        return {
          from: makeISO(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), 1),
          to: makeISO(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate()),
          label: 'Bulan Ini',
        };
      }
      case 'last_month': {
        const lastDayOfPrevMonth = new Date(Date.UTC(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), 0)).getUTCDate();
        return {
          from: makeISO(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth() - 1, 1),
          to: makeISO(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth() - 1, lastDayOfPrevMonth),
          label: 'Bulan Lalu',
        };
      }
      case 'custom': {
        if (customFrom && customTo) {
          return { from: customFrom, to: customTo, label: `${customFrom} s/d ${customTo}` };
        }
        return { from: undefined, to: undefined, label: 'Kustom Tanggal' };
      }
      case 'all':
      default:
        return { from: undefined, to: undefined, label: 'Semua Waktu' };
    }
  }, [period, customFrom, customTo]);

  // Fetch expenses with active filter
  const { data: expRes, isLoading } = useQuery({
    queryKey: ['expenses', dateRange.from, dateRange.to],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      return api.get<{ data: Expense[] }>('/expenses', params);
    },
  });

  const rawExpenses = expRes?.data || [];

  // Filter by search keyword
  const expenses = useMemo(() => {
    if (!search.trim()) return rawExpenses;
    const q = search.toLowerCase();
    return rawExpenses.filter((e) => e.description.toLowerCase().includes(q));
  }, [rawExpenses, search]);

  const totalExpense = useMemo(() => expenses.reduce((sum, e) => sum + Number(e.amount), 0), [expenses]);
  const avgExpense = expenses.length > 0 ? Math.round(totalExpense / expenses.length) : 0;

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const qs = new URLSearchParams(params).toString();
      const url = qs ? `/export/expenses?${qs}` : '/export/expenses';
      const fileTag = dateRange.from && dateRange.to ? `${dateRange.from}_to_${dateRange.to}` : 'semua';
      await api.downloadFile(url, `pengeluaran_${fileTag}.xlsx`);
      toast.success('File Excel pengeluaran berhasil diunduh!');
    } catch (err: any) {
      toast.error(err.message || 'Gagal export data pengeluaran');
    } finally {
      setExporting(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/expenses', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Pengeluaran dicatat');
      setShowForm(false);
      setForm({ description: '', amount: '', date: new Date().toISOString().split('T')[0] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Pengeluaran dihapus');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let expenseDate = new Date(form.date);
    if (form.date === todayStr) {
      expenseDate = now;
    }
    createMutation.mutate({
      description: form.description,
      amount: Number(form.amount),
      date: expenseDate.toISOString(),
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pengeluaran</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Catat dan pantau biaya operasional toko</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            className="btn btn-secondary gap-2 font-bold text-xs"
            title="Download Excel Pengeluaran"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} className="text-emerald-400" />}
            <span>Export Excel</span>
          </button>
          <button onClick={() => setShowForm(true)} className="btn btn-primary gap-2 font-bold text-xs">
            <Plus size={16} />
            <span>Catat Pengeluaran</span>
          </button>
        </div>
      </div>

      {/* Filter Bar & Period Pills */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Period Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {[
              { id: 'all', label: 'Semua' },
              { id: 'today', label: 'Hari Ini' },
              { id: 'yesterday', label: 'Kemarin' },
              { id: '7days', label: '7 Hari' },
              { id: 'this_month', label: 'Bulan Ini' },
              { id: 'last_month', label: 'Bulan Lalu' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as PeriodType)}
                className={`btn btn-xs rounded-full px-3 py-1 font-medium transition-all ${
                  period === p.id ? 'btn-primary shadow-sm' : 'btn-secondary text-[var(--color-text-muted)]'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => {
                setPeriod('custom');
                setShowCustomModal(true);
              }}
              className={`btn btn-xs rounded-full px-3 py-1 font-medium flex items-center gap-1 transition-all ${
                period === 'custom' ? 'btn-primary shadow-sm' : 'btn-secondary text-[var(--color-text-muted)]'
              }`}
            >
              <Calendar size={12} />
              <span>{period === 'custom' && customFrom && customTo ? `${customFrom} - ${customTo}` : 'Kustom'}</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)]" />
            <input
              type="text"
              placeholder="Cari deskripsi pengeluaran..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input input-sm pl-8 text-xs w-full"
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card shadow-rose-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Total Pengeluaran</span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <TrendingDown size={15} />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-rose-400 truncate">{formatCurrency(totalExpense)}</p>
          <p className="text-[11px] text-[var(--color-text-dim)] mt-1">{dateRange.label}</p>
        </div>

        <div className="stat-card shadow-blue-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Jumlah Transaksi</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Receipt size={15} />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-blue-400 truncate">{expenses.length} <span className="text-xs font-normal text-[var(--color-text-muted)]">catatan</span></p>
          <p className="text-[11px] text-[var(--color-text-dim)] mt-1">Biaya tercatat</p>
        </div>

        <div className="stat-card shadow-amber-500/10 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Rata-rata Pengeluaran</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Filter size={15} />
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-amber-400 truncate">{formatCurrency(avgExpense)}</p>
          <p className="text-[11px] text-[var(--color-text-dim)] mt-1">Per transaksi pengeluaran</p>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="w-12 text-center">No</th>
              <th>Tanggal & Jam</th>
              <th>Deskripsi Pengeluaran</th>
              <th className="text-right">Jumlah</th>
              {canDelete && <th className="w-16 text-center">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={canDelete ? 5 : 4} className="text-center py-12">
                  <div className="spinner mx-auto" />
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={canDelete ? 5 : 4} className="text-center py-12 text-[var(--color-text-dim)]">
                  Tidak ada catatan pengeluaran pada periode ini
                </td>
              </tr>
            ) : (
              expenses.map((e, idx) => (
                <tr key={e.id}>
                  <td className="text-center text-xs text-[var(--color-text-dim)]">{idx + 1}</td>
                  <td className="text-xs font-mono">{formatDateTime(e.date)}</td>
                  <td className="font-medium text-sm">{e.description}</td>
                  <td className="text-right text-rose-400 font-semibold text-sm">{formatCurrency(Number(e.amount))}</td>
                  {canDelete && (
                    <td className="text-center">
                      <button
                        onClick={() => {
                          if (confirm(`Hapus catatan "${e.description}"?`)) deleteMutation.mutate(e.id);
                        }}
                        className="btn btn-ghost btn-icon btn-sm text-rose-400 hover:bg-rose-500/10"
                        title="Hapus Pengeluaran"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Catat Pengeluaran */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--color-border)]">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Receipt size={18} className="text-primary-400" />
                Catat Pengeluaran Baru
              </h3>
              <button onClick={() => setShowForm(false)} className="btn btn-ghost btn-icon">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-[var(--color-text-muted)] mb-1 block">Deskripsi Pengeluaran</label>
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  required
                  placeholder="Contoh: Beli minyak goreng 2L, galon air, sabun cuci"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium text-[var(--color-text-muted)] mb-1 block">Nominal (Rupiah)</label>
                <input
                  type="number"
                  className="input font-semibold text-rose-400"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-[var(--color-text-muted)] mb-1 block">Tanggal</label>
                <input
                  type="date"
                  className="input"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary flex-1">
                  Batal
                </button>
                <button type="submit" className="btn btn-primary flex-1 font-bold" disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : 'Simpan Pengeluaran'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Kustom Tanggal */}
      {showCustomModal && (
        <div className="modal-overlay" onClick={() => setShowCustomModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--color-border)]">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Calendar size={18} className="text-primary-400" />
                Pilih Rentang Tanggal
              </h3>
              <button onClick={() => setShowCustomModal(false)} className="btn btn-ghost btn-icon">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">Dari Tanggal</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="input input-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">Sampai Tanggal</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="input input-sm w-full"
                />
              </div>
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="btn btn-secondary btn-sm flex-1"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!customFrom || !customTo) {
                      toast.error('Harap pilih kedua tanggal');
                      return;
                    }
                    setShowCustomModal(false);
                  }}
                  className="btn btn-primary btn-sm flex-1 font-bold"
                >
                  Terapkan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
