import { useMemo, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore, formatInr, toNumber, toItemSummary, formatDate, isSameDay } from "../store/useStore";
import {
  Mic,
  BookOpen,
  Package,
  Sparkles,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
  Calendar,
  Award,
  ChevronRight,
  CheckCircle2,
  Clock
} from "lucide-react";

export default function Home() {
  const navigate = useNavigate();
  const { entries, loadEntries, vendorId, language, userName, vendorType } = useStore();
  const isHindi = language === "hi";

  useEffect(() => {
    if (entries.length === 0) {
      loadEntries();
    }
  }, [entries.length, loadEntries, vendorId]);

  const todayStats = useMemo(() => {
    let earned = 0;
    let spent = 0;
    const today = new Date();

    entries.forEach((entry) => {
      const entryDate = entry.entry_date ? new Date(entry.entry_date) : null;
      if (!entryDate || Number.isNaN(entryDate.getTime())) return;

      if (isSameDay(entryDate, today)) {
        earned += toNumber(entry.total_earned);
        spent += toNumber(entry.total_spent);
      }
    });

    return { earned, spent, net: earned - spent };
  }, [entries]);

  // Aggregate earnings for the last 7 days & calculate metrics
  const last7DaysData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        dateObj: d,
        label: d.toLocaleDateString(isHindi ? "hi-IN" : "en-IN", { weekday: "short" }),
        fullDayName: d.toLocaleDateString(isHindi ? "hi-IN" : "en-IN", { weekday: "long" }),
        earned: 0,
        spent: 0,
        net: 0,
        hasActivity: false,
      };
    });

    entries.forEach((entry) => {
      const entryDate = entry.entry_date ? new Date(entry.entry_date) : null;
      if (!entryDate || Number.isNaN(entryDate.getTime())) return;
      const earned = toNumber(entry.total_earned);
      const spent = toNumber(entry.total_spent);

      const matchingDay = days.find(
        (d) =>
          d.dateObj.getFullYear() === entryDate.getFullYear() &&
          d.dateObj.getMonth() === entryDate.getMonth() &&
          d.dateObj.getDate() === entryDate.getDate()
      );
      if (matchingDay) {
        matchingDay.earned += earned;
        matchingDay.spent += spent;
        matchingDay.net += (earned - spent);
        matchingDay.hasActivity = true;
      }
    });

    const maxEarned = Math.max(...days.map((d) => d.earned), 100);
    const totalWeeklyNet = days.reduce((sum, d) => sum + d.net, 0);
    const weeklyAverage = Math.round(totalWeeklyNet / 7);

    let bestDay = days[6];
    let maxNet = -Infinity;
    let hasAnyData = false;
    for (const d of days) {
      if (d.hasActivity && d.net > maxNet) {
        bestDay = d;
        maxNet = d.net;
        hasAnyData = true;
      }
    }

    return {
      days,
      maxEarned,
      weeklyAverage,
      bestDayName: hasAnyData ? bestDay.fullDayName : (isHindi ? "डेटा उपलब्ध नहीं" : "N/A"),
      bestDayIndex: hasAnyData ? days.indexOf(bestDay) : -1
    };
  }, [entries, isHindi]);

  const streakDays = useMemo(() => {
    if (entries.length === 0) return 0;

    const uniqueDates = new Set<string>();
    entries.forEach(e => {
      if (e.entry_date) {
        const d = new Date(e.entry_date);
        if (!Number.isNaN(d.getTime())) {
          uniqueDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
        }
      }
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    if (!uniqueDates.has(todayStr) && !uniqueDates.has(yesterdayStr)) {
      return 0;
    }

    let streak = 0;
    const checkDate = new Date();
    if (!uniqueDates.has(todayStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const strDate = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
      if (uniqueDates.has(strDate)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [entries]);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Welcome Banner / Top Greeting ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200/80 rounded-2xl px-5 py-3.5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-black text-lg">
            {userName ? userName.charAt(0).toUpperCase() : "V"}
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-900">
              {isHindi ? `नमस्ते, ${userName || "दुकानदार साथी"} 🙏` : `Welcome, ${userName || "Partner"} 🙏`}
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {vendorType ? `${vendorType} · ` : ""}
              {new Date().toLocaleDateString(isHindi ? "hi-IN" : "en-IN", {
                weekday: "long",
                day: "numeric",
                month: "short"
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {isHindi ? "WhatsApp सिंक सक्रिय" : "WhatsApp Sync Active"}
          </span>
        </div>
      </div>

      {/* ── Main Hero Card & Quick Actions ─────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-3">

        {/* Hero Card: Today's Net Profit */}
        <div className="lg:col-span-2 relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-8 text-white shadow-xl shadow-slate-900/10 border border-slate-800">
          {/* Subtle Ambient Glow */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-orange-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-orange-400 text-xs font-bold border border-white/10 uppercase tracking-wider mb-3">
                <TrendingUp className="w-3.5 h-3.5" />
                {isHindi ? "आज का हिसाब-किताब" : "Today's Net Summary"}
              </span>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                {isHindi ? "आज का कुल शुद्ध मुनाफा" : "Today's Net Profit / Loss"}
              </p>
              <div className="mt-2 flex items-baseline gap-3">
                <h2 className="text-4xl sm:text-5xl font-black tracking-tight text-white">
                  {formatInr(todayStats.net)}
                </h2>
                {todayStats.net >= 0 ? (
                  <span className="inline-flex items-center text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                    {isHindi ? "मुनाफा" : "Profit"}
                  </span>
                ) : (
                  <span className="inline-flex items-center text-xs font-bold text-rose-400 bg-rose-950/60 px-2.5 py-1 rounded-full border border-rose-500/20">
                    <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                    {isHindi ? "नुकसान" : "Loss"}
                  </span>
                )}
              </div>
            </div>

            {/* Streak Badge */}
            <div className="flex items-center gap-2 bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30 px-3.5 py-2 rounded-2xl">
              <Flame className="w-5 h-5 text-orange-400 fill-orange-400" />
              <div>
                <p className="text-xs font-black text-white">{streakDays} {isHindi ? "दिन" : "Days"}</p>
                <p className="text-[10px] text-orange-300 font-bold uppercase tracking-wider">{isHindi ? "स्ट्रीक" : "Streak"}</p>
              </div>
            </div>
          </div>

          {/* Sub-cards: Earnings & Expenses */}
          <div className="relative z-10 mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/5 backdrop-blur-xs p-4 border border-white/10 hover:bg-white/10 transition">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-300">{isHindi ? "कुल बिक्री / कमाई" : "Total Sales / Earned"}</p>
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-emerald-400">
                +{formatInr(todayStats.earned)}
              </p>
            </div>

            <div className="rounded-2xl bg-white/5 backdrop-blur-xs p-4 border border-white/10 hover:bg-white/10 transition">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-300">{isHindi ? "कुल खर्च / उधारी" : "Total Expenses / Spent"}</p>
                <span className="w-6 h-6 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400">
                  <ArrowDownRight className="w-4 h-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-extrabold text-rose-400">
                -{formatInr(todayStats.spent)}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action Side Panel */}
        <div className="flex flex-col gap-3">
          {/* Primary Quick CTA Card */}
          <div
            onClick={() => navigate("/app/ledger")}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-orange-600 to-amber-600 p-6 text-white shadow-lg shadow-orange-500/25 cursor-pointer hover:shadow-xl hover:shadow-orange-500/35 transition-all duration-300 hover:-translate-y-0.5 flex-1 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-block bg-white/20 text-white text-[11px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">
                  📊 {isHindi ? "डिजिटल खाता" : "Digital Khata"}
                </span>
                <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <BookOpen className="w-5 h-5" />
                </div>
              </div>
              <h3 className="mt-4 text-xl font-black leading-tight">
                {isHindi ? "दैनिक खाता और बिक्री" : "Digital Ledger & Sales"}
              </h3>
              <p className="mt-1.5 text-xs text-orange-100 leading-relaxed">
                {isHindi
                  ? "अपनी सभी दैनिक बिक्री, खर्चे और मुनाफा देखें।"
                  : "View and manage all your daily sales, expenses, and profits."}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/20">
              <span className="text-xs font-bold">{isHindi ? "खाता खोलें →" : "Open Ledger →"}</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map(i => (
                  <span key={i} className={`w-1 bg-white rounded-full ${i === 1 ? "h-3" : i === 2 ? "h-5" : "h-2"}`} />
                ))}
              </div>
            </div>
          </div>

          {/* Secondary Quick Action: View Ledger */}
          <Link
            to="/app/ledger"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-orange-300 hover:shadow-md transition flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center group-hover:bg-orange-50 group-hover:text-orange-600 transition">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{isHindi ? "खाता बही देखें" : "View Ledger (Khata)"}</p>
                <p className="text-xs text-slate-500">{entries.length} {isHindi ? "कुल लेनदेन दर्ज" : "entries recorded"}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition" />
          </Link>
        </div>
      </section>

      {/* ── Key Metrics (KPIs) ─────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {isHindi ? "साप्ताहिक औसत" : "Weekly Average"}
              </p>
              <p className="text-xl font-black text-slate-900 mt-0.5">
                {formatInr(last7DaysData.weeklyAverage)}
                <span className="text-xs font-medium text-slate-500 ml-1">{isHindi ? "/ दिन" : "/ day"}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {isHindi ? "सबसे अच्छा दिन" : "Best Performing Day"}
              </p>
              <p className="text-xl font-black text-slate-900 mt-0.5">
                {last7DaysData.bestDayName}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:shadow-sm transition">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {isHindi ? "रिकॉर्डिंग स्ट्रीक" : "Active Streak"}
              </p>
              <p className="text-xl font-black text-slate-900 mt-0.5">
                {streakDays} {isHindi ? "लगातार दिन" : "Consecutive Days"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Revenue Flow Chart & Recent Transactions ───────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-3">

        {/* 7-Day Revenue Flow Chart */}
        <div className="lg:col-span-2 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-500" />
                <h3 className="text-base font-bold text-slate-900">{isHindi ? "साप्ताहिक आय का प्रवाह" : "Weekly Revenue Flow"}</h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isHindi ? "पिछले 7 दिनों में आपकी दैनिक कमाई और खर्च" : "Your daily earnings and cashflow"}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-3 h-3 rounded-sm bg-slate-800" />
                {isHindi ? "कमाई" : "Earned"}
              </span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-3 h-3 rounded-sm bg-orange-500" />
                {isHindi ? "उच्चतम दिन" : "Peak Day"}
              </span>
            </div>
          </div>

          {/* Bar Chart Container */}
          <div className="mt-6 h-56 w-full rounded-2xl bg-slate-50 border border-slate-100 p-4 pt-10 px-4 sm:px-8 flex items-end justify-between gap-2 sm:gap-4">
            {last7DaysData.days.map((day, idx) => {
              const heightPercent = Math.max((day.earned / last7DaysData.maxEarned) * 100, 4);
              const isPeak = idx === last7DaysData.bestDayIndex && day.earned > 0;
              return (
                <div key={idx} className="flex flex-col items-center gap-2 group relative w-full h-full justify-end">
                  {/* Hover Tooltip */}
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-slate-900 text-white text-xs px-2.5 py-1 rounded-lg shadow-lg pointer-events-none z-20">
                    <p className="font-bold">{day.fullDayName}</p>
                    <p className="text-emerald-300 font-semibold">{formatInr(day.earned)}</p>
                  </div>
                  {/* Bar */}
                  <div
                    className={`w-full max-w-[36px] rounded-t-lg transition-all duration-300 ${
                      isPeak
                        ? "bg-gradient-to-t from-orange-500 to-amber-400 group-hover:from-orange-600 group-hover:to-amber-500"
                        : "bg-slate-700 group-hover:bg-slate-900"
                    }`}
                    style={{ height: `${heightPercent}%` }}
                  />
                  {/* Day Label */}
                  <span className={`text-[11px] font-bold ${isPeak ? "text-orange-600 font-extrabold" : "text-slate-500"}`}>
                    {day.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity Card */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" />
                <h3 className="text-base font-bold text-slate-900">{isHindi ? "हाल की प्रविष्टियां" : "Recent Activity"}</h3>
              </div>
              <Link to="/app/ledger" className="text-xs font-bold text-orange-500 hover:text-orange-600">
                {isHindi ? "सभी देखें →" : "View All →"}
              </Link>
            </div>

            <div className="mt-4 space-y-2.5">
              {entries.length === 0 ? (
                <div className="py-8 text-center flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center mb-2">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    {isHindi ? "अभी तक कोई प्रविष्टि नहीं है।" : "No transactions recorded yet."}
                  </p>
                  <button
                    onClick={() => navigate("/app/ledger")}
                    className="mt-3 px-4 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition"
                  >
                    {isHindi ? "खाता बही देखें" : "View Ledger"}
                  </button>
                </div>
              ) : (
                entries.slice(0, 4).map((entry, idx) => {
                  const earned = toNumber(entry.total_earned);
                  const spent = toNumber(entry.total_spent);
                  const net = earned - spent;
                  return (
                    <div
                      key={idx}
                      className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 hover:bg-slate-50 transition"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-500">{formatDate(entry.entry_date)}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                          net >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                        }`}>
                          {net >= 0 ? "+" : ""}{formatInr(net)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-800 line-clamp-1">
                        {toItemSummary(entry.items_sold)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <Link
              to="/app/insights"
              className="flex items-center justify-between text-xs font-bold text-slate-600 hover:text-orange-500 transition"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                {isHindi ? "AI सुझाव व व्यापार सलाह देखें" : "View AI Insights & Tips"}
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

      </section>

    </div>
  );
}
