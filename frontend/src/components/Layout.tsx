import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useStore, type Language } from "../store/useStore";
import {
  Home as HomeIcon,
  BookOpen,
  Sparkles,
  Package,
  User,
  LogOut,
  Globe,
  Wallet,
} from "lucide-react";

export default function Layout() {
  const { language, setLanguage, userName, logout } = useStore();
  const navigate = useNavigate();
  const isHindi = language === "hi";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
      isActive
        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20 font-bold"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all ${
      isActive
        ? "text-orange-600 font-extrabold"
        : "text-slate-500 hover:text-slate-800"
    }`;

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  const languageOptions: { value: Language; label: string }[] = [
    { value: "en", label: "English" },
    { value: "hi", label: "हिंदी" },
    { value: "mr", label: "मराठी" },
    { value: "hinglish", label: "Hinglish" },
  ];

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col md:flex-row font-['Manrope',sans-serif]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');`}</style>

      {/* ── Left Sidebar (Desktop / Tablet) ─────────────────────────────────── */}
      <aside className="hidden md:flex md:w-64 shrink-0 bg-white border-r border-slate-200/80 h-screen sticky top-0 flex-col justify-between shadow-xs z-30">
        <div className="flex flex-col">
          {/* Brand & Logo */}
          <div 
            onClick={() => navigate("/app")} 
            className="flex items-center gap-3 px-5 py-4.5 border-b border-slate-100 cursor-pointer group select-none"
          >
            <img
              src="/logo.png"
              alt="VyapaarSathi Logo"
              className="h-10 w-auto object-contain transition-transform duration-200 group-hover:scale-105"
            />
            <div className="flex flex-col leading-tight min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-black tracking-tight text-slate-900 truncate">VyapaarSathi</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-orange-100 text-orange-600 uppercase tracking-wider shrink-0">Vendor</span>
              </div>
              <p className="text-[11px] text-orange-500 font-bold truncate">
                {isHindi ? "आपका बिज़नेस साथी" : "Digital Khata & Growth"}
              </p>
            </div>
          </div>

          {/* Navigation Links (Voice Record removed as requested) */}
          <nav className="flex flex-col gap-1.5 p-3.5 mt-2">
            <NavLink to="/app" end className={linkClass}>
              <HomeIcon className="w-4 h-4 shrink-0" />
              <span>{isHindi ? "होम" : "Home"}</span>
            </NavLink>
            <NavLink to="/app/ledger" className={linkClass}>
              <BookOpen className="w-4 h-4 shrink-0" />
              <span>{isHindi ? "खाता" : "Ledger"}</span>
            </NavLink>
            <NavLink to="/app/udhari" className={linkClass}>
              <Wallet className="w-4 h-4 shrink-0" />
              <span>{isHindi ? "उधारी" : "Udhari"}</span>
            </NavLink>
            <NavLink to="/app/inventory" className={linkClass}>
              <Package className="w-4 h-4 shrink-0" />
              <span>{isHindi ? "स्टॉक" : "Inventory"}</span>
            </NavLink>
            <NavLink to="/app/insights" className={linkClass}>
              <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
              <span>{isHindi ? "AI सुझाव" : "AI Insights"}</span>
            </NavLink>
            <NavLink to="/app/profile" className={linkClass}>
              <User className="w-4 h-4 shrink-0" />
              <span>{isHindi ? "सेटिंग्स" : "Settings"}</span>
            </NavLink>
          </nav>
        </div>

        {/* Sidebar Footer: User, Language, Logout */}
        <div className="p-3.5 border-t border-slate-100 flex flex-col gap-2.5 bg-slate-50/50">
          {userName && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white border border-slate-200/80 shadow-xs">
              <div className="w-7 h-7 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs font-black uppercase shrink-0">
                {userName.charAt(0)}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-slate-800 truncate">{userName}</span>
                <span className="text-[10px] text-slate-400 font-medium">Merchant Account</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer" title="Change Language">
              <Globe className="w-3.5 h-3.5 text-orange-500" />
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
                className="bg-transparent outline-none cursor-pointer max-w-[92px]"
                aria-label="Change language"
              >
                {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile Header (Visible only on mobile) ─────────────────────────── */}
      <header className="md:hidden border-b border-slate-200/80 bg-white sticky top-0 z-30 shadow-xs flex items-center justify-between px-4 py-2.5">
        <div onClick={() => navigate("/app")} className="flex items-center gap-2 cursor-pointer">
          <img src="/logo.png" alt="Logo" className="h-8 w-auto object-contain" />
          <span className="text-base font-black text-slate-900">VyapaarSathi</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">
            <Globe className="w-3 h-3 text-orange-500" />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
              className="bg-transparent outline-none cursor-pointer max-w-[70px]"
              aria-label="Change language"
            >
              {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600"
            title="Logout"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── Main Content Area (Fulfills entire available screen) ────────────── */}
      <main className="flex-1 min-w-0 w-full p-4 sm:p-6 lg:p-8 pb-24 md:pb-8 flex flex-col gap-6">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Navigation Bar (No Voice Mic) ─────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200 px-2 py-1 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] flex items-center justify-around">
        <NavLink to="/app" end className={mobileLinkClass}>
          <HomeIcon className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "होम" : "Home"}</span>
        </NavLink>
        <NavLink to="/app/ledger" className={mobileLinkClass}>
          <BookOpen className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "खाता" : "Ledger"}</span>
        </NavLink>
        <NavLink to="/app/udhari" className={mobileLinkClass}>
          <Wallet className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "उधारी" : "Udhari"}</span>
        </NavLink>
        <NavLink to="/app/inventory" className={mobileLinkClass}>
          <Package className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "स्टॉक" : "Stock"}</span>
        </NavLink>
        <NavLink to="/app/insights" className={mobileLinkClass}>
          <Sparkles className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "सुझाव" : "Insights"}</span>
        </NavLink>
        <NavLink to="/app/profile" className={mobileLinkClass}>
          <User className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "सेटिंग्स" : "Settings"}</span>
        </NavLink>
      </div>
    </div>
  );
}
