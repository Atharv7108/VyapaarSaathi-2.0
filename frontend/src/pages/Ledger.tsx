import { useMemo, useState } from "react";
import { useStore, formatInr, toNumber, toItemSummary, formatDate, isSameDay, isSameWeek } from "../store/useStore";
import {
  FileText,
  Search,
  Download,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertTriangle,
  Mic,
  Tag
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const ledgerTabs = [
  { id: "All", en: "All", hi: "सभी" },
  { id: "Today", en: "Today", hi: "आज" },
  { id: "This Week", en: "This Week", hi: "इस सप्ताह" },
  { id: "Profit Days", en: "Profit Days", hi: "मुनाफा" },
  { id: "Loss Days", en: "Loss Days", hi: "नुकसान / खर्च" },
  { id: "Flagged", en: "Flagged", hi: "फ़्लैग किए गए" }
] as const;

export default function Ledger() {
  const navigate = useNavigate();
  const { entries, ledgerTab, setLedgerTab, language, downloadReport } = useStore();
  const isHindi = language === "hi";
  const [searchTerm, setSearchTerm] = useState("");

  // Tab & search filtering
  const filteredEntries = useMemo(() => {
    const today = new Date();
    return entries.filter((entry) => {
      const entryDate = entry.entry_date ? new Date(entry.entry_date) : null;
      const earned = toNumber(entry.total_earned);
      const spent = toNumber(entry.total_spent);

      // Search match
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const summary = toItemSummary(entry.items_sold).toLowerCase();
        const transcript = (entry.transcription || "").toLowerCase();
        const expenses = String(entry.expenses || "").toLowerCase();
        if (!summary.includes(query) && !transcript.includes(query) && !expenses.includes(query)) {
          return false;
        }
      }

      // Tab match
      if (ledgerTab === "All") return true;
      if (!entryDate || Number.isNaN(entryDate.getTime())) return false;
      if (ledgerTab === "Today") return isSameDay(entryDate, today);
      if (ledgerTab === "This Week") return isSameWeek(entryDate, today);
      if (ledgerTab === "Profit Days") return earned - spent > 0;
      if (ledgerTab === "Loss Days") return earned - spent < 0;
      if (ledgerTab === "Flagged") {
        return entry.mood_indicator === "bad" || earned - spent < 0;
      }
      return true;
    });
  }, [entries, ledgerTab, searchTerm]);

  // Total summary for current view
  const summary = useMemo(() => {
    let totalEarned = 0;
    let totalSpent = 0;
    filteredEntries.forEach(e => {
      totalEarned += toNumber(e.total_earned);
      totalSpent += toNumber(e.total_spent);
    });
    return { totalEarned, totalSpent, net: totalEarned - totalSpent };
  }, [filteredEntries]);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-orange-50 text-orange-600">
              <FileText className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              {isHindi ? "डिजिटल खाता बही" : "Digital Ledger"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {entries.length} {isHindi ? "कुल लेनदेन दर्ज हैं" : "total transactions recorded"}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={downloadReport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-xs transition hover:border-slate-300"
          >
            <Download className="w-3.5 h-3.5 text-orange-500" />
            <span>{isHindi ? "रिपोर्ट डाउनलोड (PDF)" : "Export PDF Report"}</span>
          </button>
        </div>
      </div>

      {/* ── Mini Summary Bar ────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {isHindi ? "दिखाई गई कुल बिक्री" : "Filtered Earnings"}
          </p>
          <p className="text-xl font-black text-emerald-600 mt-1">
            +{formatInr(summary.totalEarned)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {isHindi ? "दिखाया गया कुल खर्च" : "Filtered Expenses"}
          </p>
          <p className="text-xl font-black text-rose-600 mt-1">
            -{formatInr(summary.totalSpent)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {isHindi ? "कुल शुद्ध लाभ" : "Filtered Net Profit"}
          </p>
          <p className={`text-xl font-black mt-1 ${summary.net >= 0 ? "text-slate-900" : "text-rose-600"}`}>
            {summary.net >= 0 ? "+" : ""}{formatInr(summary.net)}
          </p>
        </div>
      </div>

      {/* ── Filter Tabs & Search Bar ─────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Tab Chips */}
          <div className="flex flex-wrap gap-2">
            {ledgerTabs.map((tab) => {
              const isActive = ledgerTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLedgerTab(tab.id)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20 scale-102"
                      : "border border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {isHindi ? tab.hi : tab.en}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isHindi ? "आइटम या नोट खोजें..." : "Search item or note..."}
              className="w-full rounded-full border border-slate-200 bg-slate-50/70 pl-9 pr-4 py-2 text-xs font-semibold text-slate-800 placeholder:text-slate-400 outline-none focus:border-orange-500 focus:bg-white transition"
            />
          </div>
        </div>

        {/* ── Transaction List ──────────────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          {filteredEntries.length === 0 ? (
            <div className="py-14 text-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center">
              <FileText className="w-10 h-10 text-slate-300 mb-2" />
              <p className="text-sm font-bold text-slate-600">
                {isHindi ? "कोई लेनदेन नहीं मिला" : "No transactions found"}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                {searchTerm
                  ? (isHindi ? "आपके खोज शब्द से कोई मेल नहीं खाता।" : "No matches for your search term.")
                  : (isHindi ? "इस फ़िल्टर के लिए कोई प्रविष्टि नहीं है।" : "No entries recorded under this filter.")}
              </p>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="mt-3 text-xs font-bold text-orange-600 hover:underline"
                >
                  {isHindi ? "फ़िल्टर साफ़ करें" : "Clear search"}
                </button>
              )}
            </div>
          ) : (
            filteredEntries.map((entry, idx) => {
              const earned = toNumber(entry.total_earned);
              const spent = toNumber(entry.total_spent);
              const net = earned - spent;
              const isProfit = net >= 0;

              return (
                <div
                  key={idx}
                  className="group rounded-2xl border border-slate-200/90 bg-white p-5 hover:border-orange-300 hover:shadow-md transition-all duration-200"
                >
                  {/* Top row: Date & Net Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="p-1 rounded-md bg-slate-100 text-slate-600">
                        <Calendar className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-bold text-slate-700">{formatDate(entry.entry_date)}</span>
                      {entry.mood_indicator && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 uppercase">
                          {String(entry.mood_indicator)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black ${
                        isProfit
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                      }`}>
                        {isProfit ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {isProfit ? "+" : ""}{formatInr(net)}
                      </span>
                    </div>
                  </div>

                  {/* Items Summary */}
                  <div className="mt-3 flex items-start gap-2">
                    <Tag className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                    <p className="text-sm font-bold text-slate-900 leading-snug">
                      {toItemSummary(entry.items_sold) || (isHindi ? "विवरण दर्ज नहीं" : "General transaction")}
                    </p>
                  </div>

                  {/* Audio transcription quote if available */}
                  {entry.transcription && (
                    <div className="mt-2.5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600 italic flex items-center gap-2">
                      <Mic className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                      <span className="truncate">"{entry.transcription}"</span>
                    </div>
                  )}

                  {/* Bottom details breakdown */}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {isHindi ? "बिक्री" : "Earned"}: {formatInr(earned)}
                      </span>
                      <span className="flex items-center gap-1.5 font-semibold text-rose-600">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        {isHindi ? "लागत / खर्च" : "Spent"}: {formatInr(spent)}
                      </span>
                    </div>

                    <span className="text-[11px] font-medium text-slate-400">
                      {isHindi ? "WhatsApp / वॉयस द्वारा सत्यापित" : "Verified via voice/WhatsApp"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
