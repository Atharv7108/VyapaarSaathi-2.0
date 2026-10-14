import { useEffect, useState, useCallback, useRef } from "react";
import { useStore } from "../store/useStore";
import {
  Users,
  TrendingDown,
  TrendingUp,
  Plus,
  IndianRupee,
  Search,
  ChevronRight,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  FileText,
  Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Customer {
  vendor_phone: string;
  customer_name: string;
  customer_name_display: string;
  total_due: number;
  total_given: number;
  total_paid: number;
  is_settled: boolean;
  created_at: string;
  updated_at: string;
}

interface Transaction {
  vendor_phone: string;
  customer_name: string;
  tx_type: "credit" | "payment";
  amount: number;
  note: string;
  created_at: string;
}

interface Totals {
  total_outstanding: number;
  total_customers: number;
  active_customers: number;
  total_given_all_time: number;
  total_recovered_all_time: number;
}

const API = import.meta.env.VITE_API_URL || "";

function fmt(n: number): string {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ── Modal: Add Credit / Record Payment ───────────────────────────────────────
function TransactionModal({
  mode,
  customer,
  vendorPhone,
  onClose,
  onSuccess,
}: {
  mode: "credit" | "payment" | "new_credit";
  customer: Customer | null;
  vendorPhone: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(customer?.customer_name_display || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isCredit = mode === "credit" || mode === "new_credit";
  const title = isCredit ? "Udhari Diya (Give Credit)" : "Payment Mili (Record Payment)";
  const btnLabel = isCredit ? "Udhari Add Karo" : "Payment Record Karo";
  const btnClass = isCredit
    ? "bg-red-500 hover:bg-red-600 text-white"
    : "bg-emerald-500 hover:bg-emerald-600 text-white";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amt = parseFloat(amount);
    if (!name.trim()) return setError("Customer ka naam likhein");
    if (!amt || amt <= 0) return setError("Sahi amount likhein");

    setLoading(true);
    try {
      const endpoint = isCredit ? "/udhari/add" : "/udhari/payment";
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_phone: vendorPhone,
          customer_name: name.trim(),
          amount: amt,
          note: note.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Server error");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Kuch galat hua, dobara try karein");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className={`flex items-center justify-between p-5 rounded-t-2xl ${isCredit ? "bg-red-50 border-b border-red-100" : "bg-emerald-50 border-b border-emerald-100"}`}>
          <div className="flex items-center gap-3">
            {isCredit
              ? <ArrowUpRight className="w-5 h-5 text-red-500" />
              : <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
            }
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{isCredit ? "Udhari" : "Payment"}</p>
              <h2 className="font-bold text-slate-900 text-sm">{title}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/70 text-slate-400 hover:text-slate-700 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Customer Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Customer ka Naam
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mode !== "new_credit" && !!customer}
              placeholder="e.g. Ramesh Kumar"
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Amount (₹)
            </label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="1"
                step="1"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400"
              />
            </div>
            {!isCredit && customer && customer.total_due > 0 && (
              <p className="text-xs text-slate-400 mt-1">
                Baaki due: <span className="font-semibold text-red-500">{fmt(customer.total_due)}</span>
                <button type="button" className="ml-2 text-orange-500 font-semibold hover:underline" onClick={() => setAmount(String(customer.total_due))}>
                  Full clear
                </button>
              </p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Chai 5 cup, biscuit"
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={loading} className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${btnClass} disabled:opacity-50`}>
              {loading ? "Saving..." : btnLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Customer Detail Drawer ────────────────────────────────────────────────────
function CustomerDrawer({
  customer,
  vendorPhone,
  onClose,
  onUpdate,
}: {
  customer: Customer;
  vendorPhone: string;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [modal, setModal] = useState<"credit" | "payment" | null>(null);

  const loadTxns = useCallback(async () => {
    setLoadingTxns(true);
    try {
      const res = await fetch(
        `${API}/udhari/transactions?vendor_phone=${encodeURIComponent(vendorPhone)}&customer_name=${encodeURIComponent(customer.customer_name)}&limit=30`
      );
      const data = await res.json();
      setTxns(data.transactions || []);
    } finally {
      setLoadingTxns(false);
    }
  }, [vendorPhone, customer.customer_name]);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  function handleModalSuccess() {
    loadTxns();
    onUpdate();
  }

  const recoveryRate = customer.total_given > 0
    ? Math.round((customer.total_paid / customer.total_given) * 100)
    : 100;

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center md:justify-end bg-black/30 backdrop-blur-sm p-0 md:p-4" onClick={onClose}>
        <div
          className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:w-96 max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white font-black text-base">
                {(customer.customer_name_display || "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="font-bold text-slate-900">{customer.customer_name_display}</h2>
                <p className="text-xs text-slate-400">Customer since {timeAgo(customer.created_at)}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-0 border-b border-slate-100">
            {[
              { label: "Total Diya", value: fmt(customer.total_given), color: "text-red-500" },
              { label: "Total Mila", value: fmt(customer.total_paid), color: "text-emerald-500" },
              { label: "Baaki", value: fmt(customer.total_due), color: customer.total_due > 0 ? "text-red-600 font-extrabold" : "text-emerald-600" },
            ].map((kpi, i) => (
              <div key={i} className={`p-3 text-center ${i < 2 ? "border-r border-slate-100" : ""}`}>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{kpi.label}</p>
                <p className={`text-sm font-bold tabular-nums mt-0.5 ${kpi.color}`}>{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Recovery bar */}
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-500">Recovery Rate</span>
              <span className="text-xs font-bold tabular-nums text-slate-700">{recoveryRate}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${recoveryRate}%`,
                  background: recoveryRate >= 80 ? "#10b981" : recoveryRate >= 50 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="px-5 py-3 flex gap-2 border-b border-slate-100">
            <button
              onClick={() => setModal("credit")}
              className="flex-1 flex items-center justify-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-xs font-bold rounded-xl py-2.5 transition"
            >
              <ArrowUpRight className="w-3.5 h-3.5" /> Udhari Do
            </button>
            <button
              onClick={() => setModal("payment")}
              disabled={customer.total_due <= 0}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-600 text-xs font-bold rounded-xl py-2.5 transition disabled:opacity-40"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" /> Payment Lo
            </button>
          </div>

          {/* Transaction List */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 py-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Transaction History</p>
              {loadingTxns ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : txns.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Abhi koi transaction nahi</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {txns.map((t, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.tx_type === "credit" ? "bg-red-100" : "bg-emerald-100"}`}>
                          {t.tx_type === "credit"
                            ? <ArrowUpRight className="w-3.5 h-3.5 text-red-500" />
                            : <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                          }
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-700">{t.tx_type === "credit" ? "Udhari" : "Payment"}</p>
                          {t.note && <p className="text-[10px] text-slate-400 truncate max-w-[130px]">{t.note}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold tabular-nums ${t.tx_type === "credit" ? "text-red-500" : "text-emerald-500"}`}>
                          {t.tx_type === "credit" ? "−" : "+"}{fmt(t.amount)}
                        </p>
                        <p className="text-[10px] text-slate-400">{timeAgo(t.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <TransactionModal
          mode={modal}
          customer={customer}
          vendorPhone={vendorPhone}
          onClose={() => setModal(null)}
          onSuccess={handleModalSuccess}
        />
      )}
    </>
  );
}

// ── Main Udhari Page ──────────────────────────────────────────────────────────
export default function Udhari() {
  const { vendorId, language } = useStore();
  const isHindi = language === "hi";

  const [totals, setTotals] = useState<Totals | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOutstanding, setFilterOutstanding] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [addModal, setAddModal] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vendorPhone = vendorId.startsWith("whatsapp:") ? vendorId : `whatsapp:+${vendorId}`;

  const loadData = useCallback(async (searchVal = search, outstandingOnly = filterOutstanding) => {
    if (!vendorId || vendorId === "123e4567-e89b-12d3-a456-426614174000") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [totalsRes, customersRes] = await Promise.all([
        fetch(`${API}/udhari/totals?vendor_phone=${encodeURIComponent(vendorPhone)}`),
        fetch(
          `${API}/udhari/customers?vendor_phone=${encodeURIComponent(vendorPhone)}&only_outstanding=${outstandingOnly}&search=${encodeURIComponent(searchVal)}`
        ),
      ]);
      const [t, c] = await Promise.all([totalsRes.json(), customersRes.json()]);
      setTotals(t);
      setCustomers(c.customers || []);
    } catch {
      // Silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }, [vendorPhone, vendorId]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleSearch(val: string) {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadData(val, filterOutstanding), 400);
  }

  function toggleFilter() {
    const next = !filterOutstanding;
    setFilterOutstanding(next);
    loadData(search, next);
  }

  function handleUpdate() {
    loadData();
    if (selectedCustomer) {
      // refresh selected customer from list
      setSelectedCustomer(prev => {
        if (!prev) return null;
        const updated = customers.find(c => c.customer_name === prev.customer_name);
        return updated || prev;
      });
    }
  }

  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${API}/udhari/report/pdf?vendor_phone=${encodeURIComponent(vendorPhone)}`);
      const data = await res.json();
      if (data.pdf_url) {
        window.open(data.pdf_url, "_blank");
      } else {
        alert(isHindi ? "PDF report generate karne mein dikkat aayi." : "Could not generate PDF report.");
      }
    } catch {
      alert(isHindi ? "PDF generate nahi ho payi." : "Failed to generate PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  const kpiCards = [
    {
      icon: <TrendingDown className="w-4 h-4 text-red-400" />,
      label: isHindi ? "Total Baaki" : "Total Outstanding",
      value: fmt(totals?.total_outstanding || 0),
      sub: `${totals?.active_customers || 0} customers`,
      bg: "bg-red-50",
      border: "border-red-100",
    },
    {
      icon: <Users className="w-4 h-4 text-slate-400" />,
      label: isHindi ? "Sab Customers" : "Total Customers",
      value: String(totals?.total_customers || 0),
      sub: `${totals?.active_customers || 0} active`,
      bg: "bg-slate-50",
      border: "border-slate-100",
    },
    {
      icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
      label: isHindi ? "Total Wapas Mila" : "Total Recovered",
      value: fmt(totals?.total_recovered_all_time || 0),
      sub: `of ${fmt(totals?.total_given_all_time || 0)} given`,
      bg: "bg-emerald-50",
      border: "border-emerald-100",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            {isHindi ? "उधारी खाता" : "Udhari Khata"}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isHindi ? "Customer credit track karo" : "Track customer credit & payments"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold px-3.5 py-2.5 rounded-xl transition bg-white shadow-sm disabled:opacity-50"
            title={isHindi ? "Udhari PDF Report Download Karein" : "Download Udhari PDF Report"}
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
            ) : (
              <FileText className="w-4 h-4 text-orange-500" />
            )}
            <span className="hidden sm:inline">{isHindi ? "PDF Report" : "PDF Report"}</span>
          </button>
          <button
            onClick={() => setAddModal(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition shadow-sm shadow-orange-500/20"
          >
            <Plus className="w-4 h-4" />
            {isHindi ? "Udhari Do" : "Add Udhari"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpiCards.map((k, i) => (
          <div key={i} className={`${k.bg} border ${k.border} rounded-2xl p-4`}>
            <div className="flex items-center gap-2 mb-2">
              {k.icon}
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{k.label}</span>
            </div>
            <p className="text-2xl font-black tabular-nums text-slate-900">{k.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Voice & WhatsApp Hint Banner */}
      <div className="flex items-start gap-3 bg-orange-50 border border-orange-100 rounded-2xl p-4">
        <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center shrink-0">
          <span className="text-lg">🎤</span>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-bold text-orange-950">
            {isHindi ? "WhatsApp Voice ya Text se Khata Chalao!" : "Manage Khata via Voice or Text on WhatsApp!"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-orange-900">
            <p>• <em>"Ramesh ko 500 ka udhari diya"</em> <span className="text-orange-700">(Naya credit)</span></p>
            <p>• <em>"Ramesh ne 200 diye"</em> <span className="text-orange-700">(Payment received)</span></p>
            <p>• <em>"Ramesh ke udhari batao"</em> <span className="text-orange-700">(Customer hisaab)</span></p>
            <p>• <em>"Sab ke udhari batao / Udhari report do"</em> <span className="text-orange-700 font-semibold">(PDF Report)</span></p>
          </div>
        </div>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={isHindi ? "Customer dhundho..." : "Search customers..."}
            className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400 bg-white"
          />
        </div>
        <button
          onClick={toggleFilter}
          className={`flex items-center gap-1.5 border text-xs font-bold px-3.5 py-2.5 rounded-xl transition ${
            filterOutstanding
              ? "bg-red-500 text-white border-red-500"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {isHindi ? "Baaki Only" : "Outstanding"}
        </button>
      </div>

      {/* Customer List */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
          ))
        ) : customers.length === 0 ? (
          <div className="text-center py-16 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="w-14 h-14 mx-auto mb-4 bg-slate-100 rounded-2xl flex items-center justify-center">
              <CreditCard className="w-7 h-7 text-slate-300" />
            </div>
            <h3 className="font-bold text-slate-700 mb-1">
              {search || filterOutstanding ? "Koi match nahi mila" : "Abhi koi udhari nahi"}
            </h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              {search || filterOutstanding
                ? "Search terms change karo ya filter hatao"
                : "\"Add Udhari\" button dabao ya WhatsApp voice se record karo"}
            </p>
          </div>
        ) : (
          customers.map((c) => {
            const recoveryPct = c.total_given > 0
              ? Math.round((c.total_paid / c.total_given) * 100)
              : 100;

            return (
              <button
                key={c.customer_name}
                onClick={() => setSelectedCustomer(c)}
                className="w-full flex items-center gap-4 bg-white border border-slate-100 hover:border-orange-200 hover:shadow-sm rounded-2xl p-4 transition-all text-left group"
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-base shrink-0 ${c.is_settled ? "bg-slate-400" : "bg-gradient-to-br from-orange-400 to-amber-500"}`}>
                  {(c.customer_name_display || "?").charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-slate-900 text-sm truncate">{c.customer_name_display}</span>
                    {c.is_settled && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Clear
                      </span>
                    )}
                    {!c.is_settled && c.total_due > 0 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700">
                        <AlertCircle className="w-2.5 h-2.5" /> Due
                      </span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${recoveryPct}%`,
                          background: recoveryPct >= 80 ? "#10b981" : recoveryPct >= 50 ? "#f59e0b" : "#ef4444",
                        }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-slate-400">{recoveryPct}%</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">Last: {timeAgo(c.updated_at)}</p>
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                  <p className={`text-base font-black tabular-nums ${c.is_settled ? "text-emerald-500" : "text-red-500"}`}>
                    {fmt(c.total_due)}
                  </p>
                  <p className="text-[10px] text-slate-400">baaki</p>
                </div>

                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-orange-400 transition" />
              </button>
            );
          })
        )}
      </div>

      {/* Add Udhari Modal */}
      {addModal && (
        <TransactionModal
          mode="new_credit"
          customer={null}
          vendorPhone={vendorPhone}
          onClose={() => setAddModal(false)}
          onSuccess={() => { setAddModal(false); loadData(); }}
        />
      )}

      {/* Customer Detail Drawer */}
      {selectedCustomer && (
        <CustomerDrawer
          customer={selectedCustomer}
          vendorPhone={vendorPhone}
          onClose={() => setSelectedCustomer(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
