import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";

type Vendor = {
  phone: string;
  name: string | null;
  business_name: string | null;
  business_category: string | null;
  state: string;
  language: string;
  registered_at: string;
  last_active: string;
  active: boolean;
  entry_count?: number;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`rounded-2xl p-5 ${color}`}>
      <p className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:                { label: "✅ Active",           cls: "bg-green-100 text-green-700" },
    awaiting_name:         { label: "⏳ Awaiting Name",    cls: "bg-amber-100 text-amber-700" },
    awaiting_consent:      { label: "🤝 Awaiting Consent", cls: "bg-blue-100 text-blue-700" },
    awaiting_category:     { label: "🏷 Awaiting Category",cls: "bg-purple-100 text-purple-700" },
    awaiting_business_name:{ label: "🏪 Awaiting Biz Name",cls: "bg-indigo-100 text-indigo-700" },
    declined:              { label: "❌ Declined",          cls: "bg-red-100 text-red-600" },
    new:                   { label: "🆕 New",               cls: "bg-slate-100 text-slate-600" },
  };
  const { label, cls } = map[state] ?? { label: state, cls: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout } = useStore();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);
  const [confirmPhone, setConfirmPhone] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  useEffect(() => {
    fetchVendors();
  }, []);

  async function fetchVendors() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/admin/vendors?limit=500");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVendors(Array.isArray(data.vendors) ? data.vendors : []);
    } catch (e) {
      setError(`Failed to load vendors: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(phone: string) {
    setDeletingPhone(phone);
    setDeleteResult(null);
    try {
      const encoded = encodeURIComponent(phone);
      const res = await fetch(`/admin/vendors/${encoded}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const { deleted } = data;
      setDeleteResult(
        `✅ Deleted: ${deleted.ledger_entries} entries, ${deleted.inventory_items} inventory items`
      );
      setVendors(prev => prev.filter(v => v.phone !== phone));
    } catch (e) {
      setDeleteResult(`❌ Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingPhone(null);
      setConfirmPhone(null);
    }
  }

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  const filtered = vendors.filter(v => {
    const q = search.toLowerCase();
    return (
      (v.name || "").toLowerCase().includes(q) ||
      v.phone.toLowerCase().includes(q) ||
      (v.business_name || "").toLowerCase().includes(q)
    );
  });

  const active = vendors.filter(v => v.active).length;
  const onboarded = vendors.filter(v => v.state === "active").length;
  const pending = vendors.filter(v => v.state !== "active").length;

  return (
    <div className="min-h-screen bg-slate-50 font-['Manrope',sans-serif]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');`}</style>

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="VyapaarSathi" className="h-8 w-auto opacity-90" />
            <div>
              <p className="text-white font-bold text-sm">VyapaarSathi</p>
              <p className="text-orange-400 text-xs font-semibold">Admin Panel</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchVendors}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
            >
              🔄 Refresh
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-xl bg-red-900/40 hover:bg-red-900/60 text-red-300 text-sm font-semibold transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Delete result toast */}
        {deleteResult && (
          <div className={`flex items-center justify-between gap-4 px-5 py-3.5 rounded-2xl text-sm font-semibold shadow-md ${
            deleteResult.startsWith("✅") ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}>
            <span>{deleteResult}</span>
            <button onClick={() => setDeleteResult(null)} className="text-lg leading-none opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Vendors" value={vendors.length} color="bg-slate-900 text-white" />
          <StatCard label="Active" value={active} color="bg-green-50 text-green-800" />
          <StatCard label="Onboarded" value={onboarded} color="bg-orange-50 text-orange-800" />
          <StatCard label="Pending" value={pending} color="bg-amber-50 text-amber-800" />
        </div>

        {/* Vendors table */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5 border-b border-slate-100">
            <div>
              <h2 className="font-black text-slate-900 text-lg">All Vendors</h2>
              <p className="text-xs text-slate-400 mt-0.5">{filtered.length} of {vendors.length} shown</p>
            </div>
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 outline-none focus:border-orange-400 transition"
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="p-8 text-center">
              <p className="text-red-500 font-semibold">{error}</p>
              <button onClick={fetchVendors} className="mt-3 text-sm text-orange-500 hover:underline">Try again</button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="py-20 text-center text-slate-400">
              <p className="text-4xl mb-3">🏪</p>
              <p className="font-semibold">No vendors found</p>
              <p className="text-xs mt-1">Vendors appear here after their first WhatsApp message</p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-left">Vendor</th>
                    <th className="px-6 py-4 text-left">Phone</th>
                    <th className="px-6 py-4 text-left">State</th>
                    <th className="px-6 py-4 text-left">Entries</th>
                    <th className="px-6 py-4 text-left">Registered</th>
                    <th className="px-6 py-4 text-left">Last Active</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-bold text-slate-900">{v.name || <span className="text-slate-400 italic">No name yet</span>}</p>
                          {v.business_name && <p className="text-xs text-slate-500 mt-0.5">{v.business_name}</p>}
                          {v.business_category && <p className="text-xs text-orange-500 mt-0.5">{v.business_category}</p>}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-600">{v.phone.replace("whatsapp:", "")}</td>
                      <td className="px-6 py-4"><StateChip state={v.state} /></td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                          {v.entry_count ?? 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">{formatDate(v.registered_at)}</td>
                      <td className="px-6 py-4 text-xs text-slate-500">{formatDate(v.last_active)}</td>
                      <td className="px-6 py-4 text-center">
                        {confirmPhone === v.phone ? (
                          /* Confirm row */
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-xs text-red-600 font-semibold">Sure?</span>
                            <button
                              onClick={() => handleDelete(v.phone)}
                              disabled={deletingPhone === v.phone}
                              className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition disabled:opacity-50"
                            >
                              {deletingPhone === v.phone ? "..." : "Yes, Delete"}
                            </button>
                            <button
                              onClick={() => setConfirmPhone(null)}
                              className="px-3 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmPhone(v.phone)}
                            className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold border border-red-100 hover:border-red-200 transition"
                          >
                            🗑 Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Warning note */}
        <div className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-bold">Deleting a vendor is permanent and irreversible.</p>
            <p className="text-xs mt-0.5 opacity-80">All ledger entries and inventory data for that vendor will be permanently erased from the database.</p>
          </div>
        </div>

      </main>
    </div>
  );
}
