import { useStore } from "../store/useStore";
import { User, Globe, Download, Activity, CheckCircle2, Shield, Phone, Store } from "lucide-react";

export default function Profile() {
  const {
    vendorId, setVendorId, checkHealth, healthStatus, loading,
    language, setLanguage, entries, userName, vendorType, downloadReport
  } = useStore();
  const isHindi = language === "hi";

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 text-white flex items-center justify-center font-black text-2xl shadow-md shadow-orange-500/20">
            {userName ? userName.charAt(0).toUpperCase() : "V"}
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              {userName || (isHindi ? "दुकानदार प्रोफाइल" : "Vendor Profile")}
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-2">
              <span className="font-bold text-orange-600">{vendorType || "Retail / Dukandaar"}</span>
              <span>·</span>
              <span>{vendorId}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Main Settings Grid ──────────────────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* Card 1: Identity & WhatsApp Setup */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-black text-slate-900">
                {isHindi ? "वेंडर पहचान व WhatsApp" : "Vendor ID & WhatsApp"}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {isHindi ? "डेटाबेस और WhatsApp बॉट के लिए आपका मोबाइल नंबर।" : "Your unique WhatsApp registered number for transaction sync."}
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  {isHindi ? "पंजीकृत फ़ोन नंबर" : "Registered Phone"}
                </label>
                <input
                  type="text"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  {isHindi ? "व्यापार का प्रकार" : "Business Type"}
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700">
                  {vendorType || "Chai seller / Kirana / General"}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={checkHealth}
              disabled={loading.health}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-900 hover:bg-slate-800 py-3 text-xs font-black text-white shadow-xs transition disabled:opacity-60"
            >
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>{loading.health ? (isHindi ? "जाँच कर रहा है..." : "Checking System...") : (isHindi ? "सिस्टम और डेटाबेस जांचें" : "Run Health Check")}</span>
            </button>
            {healthStatus && (
              <p className="mt-2 text-center text-xs font-bold text-emerald-600">{healthStatus}</p>
            )}
          </div>
        </div>

        {/* Card 2: Preferences & Exports */}
        <div className="flex flex-col gap-4">

          {/* Language Preference */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{isHindi ? "पसंदीदा भाषा" : "Display Language"}</p>
                <p className="text-xs text-slate-500">{isHindi ? "वर्तमान: हिंदी (Hindi)" : "Current: English"}</p>
              </div>
            </div>
            <button
              onClick={() => setLanguage(isHindi ? "en" : "hi")}
              className="px-4 py-2 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-black text-slate-800 transition"
            >
              {isHindi ? "Switch to English" : "हिंदी में बदलें"}
            </button>
          </div>

          {/* Data Export */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{isHindi ? "खाता रिपोर्ट डाउनलोड" : "Export Full Report"}</p>
                <p className="text-xs text-slate-500">{entries.length} {isHindi ? "लेन-देन का PDF प्राप्त करें" : "records ready for CA / Tax"}</p>
              </div>
            </div>
            <button
              onClick={() => {
                if (!entries || entries.length === 0) {
                  alert(isHindi ? "कोई लेन‑देन नहीं मिला" : "No entries to export");
                  return;
                }
                downloadReport();
              }}
              className="px-4 py-2 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-xs font-black text-white shadow-md shadow-orange-500/20 transition"
            >
              {isHindi ? "डाउनलोड करें" : "Export PDF"}
            </button>
          </div>

          {/* Security & WhatsApp Tip */}
          <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white shadow-md">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-orange-400" />
              <p className="text-xs font-black uppercase tracking-wider text-orange-400">
                {isHindi ? "सुरक्षित व एन्क्रिप्टेड" : "Secure & Verified"}
              </p>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              {isHindi
                ? "आपका सभी खाता डेटा सुरक्षित है। जब भी आप WhatsApp पर वॉइस नोट भेजेंगे, वह यहां तुरंत अपडेट हो जाएगा।"
                : "All your ledger transactions are securely synced. WhatsApp voice notes automatically show up in real-time."}
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
