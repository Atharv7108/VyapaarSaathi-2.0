import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";
import {
  Home as HomeIcon,
  BookOpen,
  Mic,
  Sparkles,
  Package,
  User,
  LogOut,
  Globe
} from "lucide-react";

export default function Layout() {
  const { language, setLanguage, userName, logout } = useStore();
  const navigate = useNavigate();
  const isHindi = language === "hi";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs lg:text-sm font-semibold transition-all duration-200 ${
      isActive
        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
      isActive
        ? "text-orange-600 font-extrabold"
        : "text-slate-500 hover:text-slate-800"
    }`;

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  function toggleLanguage() {
    setLanguage(isHindi ? "en" : "hi");
  }

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col font-['Manrope',sans-serif]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');`}</style>

      {/* ── Desktop / Tablet Top Header ───────────────────────────────────── */}
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-xs">
        <div className="flex w-full items-center justify-between gap-4 px-4 sm:px-8 lg:px-12 py-2.5">

          {/* Brand & Logo */}
          <div 
            onClick={() => navigate("/app")} 
            className="flex items-center gap-3 shrink-0 cursor-pointer group"
          >
            <div className="relative">
              <img
                src="/logo.png"
                alt="VyapaarSathi Logo"
                className="h-10 sm:h-11 w-auto object-contain transition-transform duration-200 group-hover:scale-105"
              />
            </div>
            <div className="flex flex-col leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="text-base sm:text-lg font-black tracking-tight text-slate-900">VyapaarSathi</span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-orange-100 text-orange-600 uppercase tracking-wider">Vendor</span>
              </div>
              <p className="text-[11px] text-orange-500 font-bold">
                {isHindi ? "आपका बिज़नेस साथी" : "Digital Khata & Growth"}
              </p>
            </div>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1.5">
            <NavLink to="/app" end className={linkClass}>
              <HomeIcon className="w-4 h-4" />
              <span>{isHindi ? "होम" : "Home"}</span>
            </NavLink>
            <NavLink to="/app/ledger" className={linkClass}>
              <BookOpen className="w-4 h-4" />
              <span>{isHindi ? "खाता" : "Ledger"}</span>
            </NavLink>
            <NavLink to="/app/record" className={linkClass}>
              <Mic className="w-4 h-4 text-emerald-500" />
              <span>{isHindi ? "बोलकर लिखें" : "Voice Record"}</span>
            </NavLink>
            <NavLink to="/app/insights" className={linkClass}>
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>{isHindi ? "AI सुझाव" : "AI Insights"}</span>
            </NavLink>
            <NavLink to="/app/inventory" className={linkClass}>
              <Package className="w-4 h-4" />
              <span>{isHindi ? "स्टॉक" : "Inventory"}</span>
            </NavLink>
            <NavLink to="/app/profile" className={linkClass}>
              <User className="w-4 h-4" />
              <span>{isHindi ? "सेटिंग्स" : "Settings"}</span>
            </NavLink>
          </nav>

          {/* Right Action Area */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Language Switcher */}
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
              title="Change Language"
            >
              <Globe className="w-3.5 h-3.5 text-orange-500" />
              <span>{isHindi ? "हिंदी" : "English"}</span>
            </button>

            {/* User Profile Pill */}
            {userName && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200">
                <div className="w-5 h-5 rounded-full bg-orange-500 text-white flex items-center justify-center text-[10px] font-black uppercase">
                  {userName.charAt(0)}
                </div>
                <span className="truncate max-w-[110px]">{userName}</span>
              </div>
            )}

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isHindi ? "लॉगआउट" : "Logout"}</span>
            </button>
          </div>

        </div>
      </header>

      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <main className="flex w-full flex-col gap-6 px-4 sm:px-8 lg:px-12 py-6 flex-1 pb-24 md:pb-10 max-w-7xl mx-auto">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Navigation Bar ───────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200 px-2 py-1.5 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] flex items-center justify-around">
        <NavLink to="/app" end className={mobileLinkClass}>
          <HomeIcon className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "होम" : "Home"}</span>
        </NavLink>
        <NavLink to="/app/ledger" className={mobileLinkClass}>
          <BookOpen className="w-5 h-5 mb-0.5" />
          <span>{isHindi ? "खाता" : "Ledger"}</span>
        </NavLink>
        {/* Special Center Floating Record Button */}
        <NavLink
          to="/app/record"
          className="flex flex-col items-center -mt-5"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/30 ring-4 ring-white active:scale-95 transition-transform">
            <Mic className="w-6 h-6" />
          </div>
          <span className="text-[9px] font-black text-orange-600 mt-0.5">
            {isHindi ? "बोलें" : "Record"}
          </span>
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
          <span>{isHindi ? "प्रोफाइल" : "Profile"}</span>
        </NavLink>
      </div>
    </div>
  );
}
