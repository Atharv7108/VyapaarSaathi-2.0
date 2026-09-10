import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";

type Vendor = {
  phone: string;
  name: string | null;
  business_name: string | null;
  state: string;
  language: string;
  registered_at: string;
  last_active: string;
  active: boolean;
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

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout } = useStore();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Vendors" value={vendors.length} color="bg-slate-900 text-white" />
          <StatCard label="Active" value={active} color="bg-green-50 text-green-800" />
          <StatCard label="Onboarded" value={onboarded} color="bg-orange-50 text-orange-800" />
          <StatCard label="Awaiting Name" value={pending} color="bg-amber-50 text-amber-800" />
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
                    <th className="px-6 py-4 text-left">Language</th>
                    <th className="px-6 py-4 text-left">Registered</th>
                    <th className="px-6 py-4 text-left">Last Active</th>
                    <th className="px-6 py-4 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-bold text-slate-900">{v.name || <span className="text-slate-400 italic">No name yet</span>}</p>
                          {v.business_name && <p className="text-xs text-slate-500 mt-0.5">{v.business_name}</p>}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-600">{v.phone.replace("whatsapp:", "")}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
                          v.state === "active" ? "bg-green-100 text-green-700" :
                          v.state === "awaiting_name" ? "bg-amber-100 text-amber-700" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {v.state === "active" ? "✅ Active" : v.state === "awaiting_name" ? "⏳ Awaiting Name" : v.state}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 uppercase text-xs font-bold">{v.language}</td>
                      <td className="px-6 py-4 text-xs text-slate-500">{formatDate(v.registered_at)}</td>
                      <td className="px-6 py-4 text-xs text-slate-500">{formatDate(v.last_active)}</td>
                      <td className="px-6 py-4">
                        <span className={`w-2 h-2 rounded-full inline-block ${v.active ? "bg-green-500" : "bg-slate-300"}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
