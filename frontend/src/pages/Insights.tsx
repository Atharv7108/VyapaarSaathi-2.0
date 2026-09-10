import { useRef, useState, useEffect } from "react";
import { useStore, formatInr, type AIKeyFinding, type AIRecommendation, type CategoryBreakdown } from "../store/useStore";
import { Sparkles, Brain, Volume2, VolumeX, TrendingUp, CheckCircle, AlertTriangle, ArrowRight } from "lucide-react";

/* ── Animated Health Score Ring ──────────────────────────────────────────── */
function HealthRing({ score, size = 160 }: { score: number; size?: number }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedScore / 100) * circumference;

  useEffect(() => {
    let frame: number;
    const duration = 1200;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(score * eased));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const color =
    score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  const bgColor =
    score >= 70 ? "#d1fae5" : score >= 40 ? "#fef3c7" : "#fee2e2";
  const label =
    score >= 70 ? "Healthy" : score >= 40 ? "Needs Attention" : "Critical";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgColor} strokeWidth="10" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-black" style={{ color }}>{animatedScore}</span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
      </div>
    </div>
  );
}

/* ── Audio Player with Language Toggle ──────────────────────────────────── */
function DualAudioPlayer({
  audioHi, audioEn, isHindi,
}: {
  audioHi: string | null;
  audioEn: string | null;
  isHindi: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioLang, setAudioLang] = useState<"hi" | "en">(isHindi ? "hi" : "en");

  const currentBase64 = audioLang === "hi" ? audioHi : audioEn;
  const audioSrc = currentBase64 ? `data:audio/mp3;base64,${currentBase64}` : null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const switchLang = (lang: "hi" | "en") => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setProgress(0);
    setAudioLang(lang);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
    };
    const onEnded = () => { setIsPlaying(false); setProgress(0); };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioLang]);

  const bars = Array.from({ length: 24 }, (_, i) => i);

  const hasHi = !!audioHi;
  const hasEn = !!audioEn;

  if (!hasHi && !hasEn) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center h-full">
        <p className="text-xs font-semibold text-slate-400">
          {isHindi ? "ऑडियो उपलब्ध नहीं है।" : "Audio not available."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-orange-200/80 bg-gradient-to-br from-white to-orange-50/40 p-5 shadow-xs">
      {audioSrc && <audio ref={audioRef} src={audioSrc} preload="auto" key={audioLang} />}

      {/* Header with language toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
          <p className="text-xs font-black uppercase tracking-wider text-slate-900">
            🔊 {isHindi ? "AI ऑडियो समरी" : "AI Audio Summary"}
          </p>
        </div>
        {/* Language Toggle */}
        <div className="flex rounded-full bg-slate-100 border border-slate-200 p-0.5">
          <button
            onClick={() => switchLang("hi")}
            disabled={!hasHi}
            className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
              audioLang === "hi"
                ? "bg-orange-500 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 disabled:opacity-30"
            }`}
          >
            🇮🇳 हिंदी
          </button>
          <button
            onClick={() => switchLang("en")}
            disabled={!hasEn}
            className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
              audioLang === "en"
                ? "bg-orange-500 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 disabled:opacity-30"
            }`}
          >
            🇬🇧 English
          </button>
        </div>
      </div>

      {/* Waveform Visualization */}
      <div className="flex items-end justify-center gap-[3px] h-12 mb-4">
        {bars.map((i) => {
          const baseHeight = 12 + Math.sin(i * 0.7) * 8 + Math.cos(i * 1.3) * 6;
          const height = isPlaying
            ? baseHeight + Math.sin(Date.now() / 200 + i * 0.5) * 10
            : baseHeight * 0.4;
          return (
            <div
              key={i}
              className="rounded-full w-[4px] transition-all duration-150"
              style={{
                height: `${Math.max(4, height)}px`,
                backgroundColor: i / bars.length * 100 < progress
                  ? "#f97316"
                  : isPlaying ? "#fdba74" : "#fed7aa",
              }}
            />
          );
        })}
      </div>

      {/* Progress Bar */}
      <div className="h-1.5 rounded-full bg-slate-100 mb-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-orange-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Play/Pause Button */}
      <button
        onClick={togglePlay}
        disabled={!audioSrc}
        className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 py-3 text-xs font-black text-white shadow-md shadow-orange-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {isPlaying ? (
          <>⏸ {isHindi ? "रोकें" : "Pause"}</>
        ) : (
          <>▶ {audioLang === "hi" ? "हिंदी में सुनें" : "Play in English"}</>
        )}
      </button>
    </div>
  );
}

/* ── Category Bar Chart ─────────────────────────────────────────────────── */
function CategoryChart({ data, isHindi }: { data: CategoryBreakdown[]; isHindi: boolean }) {
  if (!data || data.length === 0) return null;
  const maxPct = Math.max(...data.map(d => d.percentage), 1);

  const colors = [
    "bg-emerald-500", "bg-orange-500", "bg-amber-500", "bg-violet-500",
    "bg-rose-500", "bg-sky-500", "bg-indigo-500", "bg-teal-500",
  ];

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
        <p className="text-xs font-black uppercase tracking-wider text-slate-800">
          {isHindi ? "📊 श्रेणी विश्लेषण (Category Breakdown)" : "📊 Category Breakdown"}
        </p>
      </div>
      <div className="space-y-3">
        {data.map((cat, idx) => (
          <div key={cat.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-bold text-slate-800 capitalize">{cat.name}</span>
              <span className="text-slate-500 font-semibold">₹{cat.amount} · {cat.percentage}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${colors[idx % colors.length]}`}
                style={{ width: `${(cat.percentage / maxPct) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Finding Card ───────────────────────────────────────────────────────── */
function FindingCard({ finding, isHindi, delay }: { finding: AIKeyFinding; isHindi: boolean; delay: number }) {
  const typeStyles = {
    positive: "border-emerald-200 bg-emerald-50/70",
    warning: "border-amber-200 bg-amber-50/70",
    critical: "border-rose-200 bg-rose-50/70",
    neutral: "border-slate-200 bg-slate-50/70",
  };
  const dotColors = {
    positive: "bg-emerald-500",
    warning: "bg-amber-500",
    critical: "bg-rose-500",
    neutral: "bg-slate-400",
  };

  return (
    <div
      className={`rounded-2xl border p-4 shadow-xs transition hover:shadow-md ${typeStyles[finding.type]}`}
      style={{ animation: `fadeInUp 0.5s ease-out ${delay}ms both` }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{finding.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full ${dotColors[finding.type]}`} />
            <p className="text-xs font-black text-slate-900">
              {isHindi ? finding.title_hi : finding.title_en}
            </p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed font-medium">
            {isHindi ? finding.description_hi : finding.description_en}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Recommendation Item ────────────────────────────────────────────────── */
function RecommendationItem({ rec, index, isHindi }: { rec: AIRecommendation; index: number; isHindi: boolean }) {
  const priorityBadge = {
    high: "bg-rose-100 text-rose-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-slate-100 text-slate-600",
  };

  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs hover:border-orange-200 hover:shadow-md transition"
      style={{ animation: `fadeInUp 0.5s ease-out ${index * 100 + 300}ms both` }}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-slate-800 leading-relaxed">
          {isHindi ? rec.text_hi : rec.text_en}
        </p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${priorityBadge[rec.priority]}`}>
        {rec.priority}
      </span>
    </div>
  );
}

/* ── Loading Skeleton ───────────────────────────────────────────────────── */
function LoadingSkeleton({ phase }: { phase: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-200/80 shadow-xs">
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-4 border-orange-100 animate-ping absolute inset-0 opacity-30" />
        <div className="w-20 h-20 rounded-full border-4 border-t-orange-500 border-r-amber-400 border-b-orange-200 border-l-transparent animate-spin" />
      </div>
      <p className="mt-6 text-sm font-black text-slate-700 animate-pulse">{phase}</p>
      <div className="mt-3 flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-orange-400"
            style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Main Insights Page ──────────────────────────────────────────────────── */
export default function Insights() {
  const { aiInsights, aiInsightsPhase, runAIInsights, loading, language } = useStore();
  const isHindi = language === "hi";
  const isLoading = loading.aiInsights;

  return (
    <div className="flex flex-col gap-6 flex-1">
      {/* CSS Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-8px); }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-orange-50 text-orange-600">
              <Sparkles className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              {isHindi ? "AI बिज़नेस सलाहकार" : "AI Business Advisor"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {isHindi
              ? "आपके डेटा का गहरा विश्लेषण — हिंदी और अंग्रेज़ी, दोनों में टेक्स्ट और ऑडियो।"
              : "Deep analysis of your sales & margins — text & audio in Hindi and English."}
          </p>
        </div>

        <button
          type="button"
          onClick={runAIInsights}
          disabled={isLoading}
          className="rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 px-6 py-2.5 text-xs font-black text-white shadow-md shadow-orange-500/20 transition hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {isHindi ? "विश्लेषण हो रहा है..." : "Analyzing..."}
            </>
          ) : (
            <>
              <Brain className="w-4 h-4" />
              {isHindi ? "विश्लेषण शुरू करें" : "Generate Analysis"}
            </>
          )}
        </button>
      </div>

      {/* ── Loading State ───────────────────────────────────────────────── */}
      {isLoading && <LoadingSkeleton phase={aiInsightsPhase} />}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {!isLoading && aiInsights && (
        <>
          {/* Row 1: Health Score + Audio Player */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Health Score */}
            <div
              className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col items-center justify-center"
              style={{ animation: "fadeInUp 0.5s ease-out 0ms both" }}
            >
              <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">
                {isHindi ? "🏥 बिज़नेस स्वास्थ्य स्कोर" : "🏥 Business Health Score"}
              </p>
              <HealthRing score={aiInsights.health_score} />
              <div className="mt-4 grid grid-cols-3 gap-3 w-full border-t border-slate-100 pt-4">
                {[
                  {
                    label: isHindi ? "कुल आय" : "Income",
                    value: `₹${aiInsights.metrics.total_income ?? 0}`,
                    color: "text-emerald-600",
                  },
                  {
                    label: isHindi ? "कुल खर्च" : "Expense",
                    value: `₹${aiInsights.metrics.total_expense ?? 0}`,
                    color: "text-rose-600",
                  },
                  {
                    label: isHindi ? "शुद्ध लाभ" : "Net Profit",
                    value: `₹${aiInsights.metrics.net_profit ?? 0}`,
                    color: "text-slate-900",
                  },
                ].map((m) => (
                  <div key={m.label} className="text-center">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{m.label}</p>
                    <p className={`text-base font-black ${m.color}`}>{m.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Audio Player + Narrative */}
            <div style={{ animation: "fadeInUp 0.5s ease-out 100ms both" }} className="flex flex-col gap-4">
              <DualAudioPlayer
                audioHi={aiInsights.audio_hi_base64}
                audioEn={aiInsights.audio_en_base64}
                isHindi={isHindi}
              />

              {/* Narrative Text */}
              <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-orange-500 text-[10px] text-white font-black">AI</span>
                  <p className="text-xs font-black uppercase tracking-wider text-slate-900">
                    {isHindi ? "सारांश (Summary)" : "Summary"}
                  </p>
                </div>
                <p className="text-xs font-bold text-slate-700 leading-relaxed">
                  {isHindi ? aiInsights.narrative_hi : aiInsights.narrative_en}
                </p>
              </div>
            </div>
          </div>

          {/* Row 2: Key Findings */}
          {aiInsights.key_findings.length > 0 && (
            <div>
              <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                <span>🔍</span>
                {isHindi ? "मुख्य निष्कर्ष" : "Key Findings"}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {aiInsights.key_findings.map((finding, idx) => (
                  <FindingCard key={idx} finding={finding} isHindi={isHindi} delay={idx * 80} />
                ))}
              </div>
            </div>
          )}

          {/* Row 3: Category Breakdown + Recommendations */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div style={{ animation: "fadeInUp 0.5s ease-out 200ms both" }}>
              <CategoryChart data={aiInsights.category_breakdown} isHindi={isHindi} />
            </div>

            {aiInsights.recommendations.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                  <span>💡</span>
                  {isHindi ? "सुझाव और सलाह" : "Recommendations"}
                </h3>
                <div className="space-y-2.5">
                  {aiInsights.recommendations.map((rec, idx) => (
                    <RecommendationItem key={idx} rec={rec} index={idx} isHindi={isHindi} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Empty State ─────────────────────────────────────────────────── */}
      {!isLoading && !aiInsights && (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-12 shadow-xs text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center mb-4">
            <Brain className="w-8 h-8" />
          </div>
          <p className="font-black text-slate-900 text-lg">
            {isHindi ? "अभी तक कोई विश्लेषण नहीं" : "No analysis yet"}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            {isHindi
              ? "ऊपर \"विश्लेषण शुरू करें\" बटन दबाएं। AI आपके बिज़नेस डेटा का गहरा विश्लेषण करेगा और हिंदी व अंग्रेज़ी दोनों में ऑडियो में सुनाएगा।"
              : "Click \"Generate Analysis\" above. AI will deeply analyze your business data and narrate it in both Hindi and English audio."}
          </p>
          <button
            onClick={runAIInsights}
            disabled={isLoading}
            className="mt-6 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 px-8 py-3 text-xs font-black text-white shadow-md shadow-orange-500/20 transition hover:shadow-lg"
          >
            🧠 {isHindi ? "AI विश्लेषण शुरू करें" : "Start AI Analysis"}
          </button>
        </div>
      )}
    </div>
  );
}
