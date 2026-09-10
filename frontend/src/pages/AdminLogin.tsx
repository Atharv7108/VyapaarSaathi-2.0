import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useStore } from "../store/useStore";

// Simple hardcoded admin password — change this or move to env for production
const ADMIN_PASSWORD = "admin@vyapaar2026";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { loginAsAdmin } = useStore();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Simulate brief auth check
    setTimeout(() => {
      if (password === ADMIN_PASSWORD) {
        loginAsAdmin();
        navigate("/admin", { replace: true });
      } else {
        setError("Incorrect password. Please try again.");
        setLoading(false);
      }
    }, 600);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center px-4 font-['Manrope',sans-serif]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');`}</style>

      <div className="w-full max-w-sm">
        <div className="bg-white rounded-3xl shadow-2xl shadow-black/60 p-8 sm:p-10">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center text-2xl mb-3 shadow-lg">
              🔐
            </div>
            <h1 className="text-2xl font-black text-slate-900">Admin Access</h1>
            <p className="text-sm text-slate-400 mt-1 text-center">Restricted area — authorized personnel only</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                Admin Password
              </label>
              <div className="flex items-center gap-2 border-2 border-slate-200 focus-within:border-slate-700 rounded-2xl px-4 py-3 transition">
                <input
                  id="admin-password-input"
                  type={showPass ? "text" : "password"}
                  placeholder="Enter admin password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="flex-1 outline-none text-slate-900 font-semibold text-base bg-transparent placeholder:text-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="text-slate-400 hover:text-slate-700 text-sm transition"
                >
                  {showPass ? "🙈" : "👁️"}
                </button>
              </div>
              {error && (
                <p className="mt-2 text-xs text-red-500 font-medium">⚠️ {error}</p>
              )}
            </div>

            <button
              id="admin-login-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-bold text-base rounded-2xl shadow-md transition"
            >
              {loading ? "Verifying..." : "Access Admin Panel →"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/" className="text-sm text-slate-400 hover:text-slate-600 transition">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
