import { useRef, useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import {
  Mic,
  MicOff,
  Square,
  Volume2,
  VolumeX,
  Sparkles,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  X
} from "lucide-react";

/* ── Counter Question Audio Player ──────────────────────────────────────── */
function CounterAudioPlayer({ base64, label }: { base64: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [base64]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  return (
    <div className="flex items-center gap-3 mt-3 bg-white/80 border border-orange-200 px-4 py-2 rounded-2xl">
      <audio ref={audioRef} src={`data:audio/mp3;base64,${base64}`} preload="auto" />
      <button
        onClick={() => {
          if (isPlaying) { audioRef.current?.pause(); setIsPlaying(false); }
          else { audioRef.current?.play(); setIsPlaying(true); }
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white hover:bg-orange-600 transition shadow-sm"
      >
        {isPlaying ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
      <span className="text-xs font-black uppercase text-orange-600 tracking-wider">{label}</span>
    </div>
  );
}

/* ── Main Record Page ────────────────────────────────────────────────────── */
export default function Record() {
  const {
    startRecording, stopRecording, isRecording, recordStatus, language,
    pendingEntry, counterQuestion, counterAudioHi, counterAudioEn,
    conversationMode, cancelPending,
  } = useStore();
  const isHindi = language === "hi";
  const isAnswering = conversationMode === "answering";

  const reasonLabels: Record<string, { hi: string; en: string }> = {
    NEEDS_QUANTITY: { hi: "📊 मात्रा बताइए", en: "📊 Tell the quantity" },
    NEEDS_AMOUNT:   { hi: "💰 रकम बताइए",   en: "💰 Tell the amount" },
    NEEDS_BOTH:     { hi: "📊💰 मात्रा और रकम", en: "📊💰 Quantity & amount" },
    NEW_ITEM:       { hi: "📦 नया आइटम — कीमत", en: "📦 New item — tell price" },
    NEW_ITEM_SALE:  { hi: "🛒 कितने बेचे?", en: "🛒 How many sold?" },
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <style>{`
        @keyframes ripple {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 0.3; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        .animate-ripple {
          animation: ripple 2s infinite ease-in-out;
        }
      `}</style>

      {/* ── AI Follow-up Counter Question Card ─────────────────────────────── */}
      {isAnswering && counterQuestion && (
        <div className="rounded-3xl border-2 border-orange-300 bg-orange-50/90 p-6 shadow-md animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-orange-500 text-white font-black text-xs shadow-xs">
                AI
              </span>
              <span className="text-xs font-black uppercase text-orange-800 tracking-wider">
                {pendingEntry
                  ? (isHindi ? reasonLabels[pendingEntry.reason]?.hi : reasonLabels[pendingEntry.reason]?.en) || "Follow-up"
                  : "Follow-up"}
              </span>
            </div>
            {pendingEntry && (
              <span className="rounded-full bg-white border border-orange-200 px-2.5 py-0.5 text-[10px] font-bold text-orange-700 uppercase">
                {pendingEntry.category}
              </span>
            )}
          </div>

          <p className="text-base font-bold text-slate-900 leading-relaxed">
            {isHindi ? counterQuestion.hi : counterQuestion.en}
          </p>

          <div className="flex flex-wrap gap-2">
            {counterAudioHi && isHindi && <CounterAudioPlayer base64={counterAudioHi} label="🔊 हिंदी में सुनें" />}
            {counterAudioEn && !isHindi && <CounterAudioPlayer base64={counterAudioEn} label="🔊 Listen in English" />}
            {counterAudioEn && isHindi && <CounterAudioPlayer base64={counterAudioEn} label="🔊 English" />}
            {counterAudioHi && !isHindi && <CounterAudioPlayer base64={counterAudioHi} label="🔊 Hindi" />}
          </div>

          <button
            onClick={cancelPending}
            className="mt-4 flex items-center justify-center gap-1.5 w-full rounded-xl border border-orange-200 bg-white py-2 text-xs font-bold text-slate-600 hover:bg-orange-100/50 transition"
          >
            <X className="w-3.5 h-3.5" />
            <span>{isHindi ? "रद्द करें" : "Cancel"}</span>
          </button>
        </div>
      )}

      {/* ── Main Voice Recording Studio ────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-8 sm:p-12 shadow-sm flex flex-col items-center justify-center gap-8 text-center relative overflow-hidden">
        {/* Subtle decorative background gradient */}
        <div className="absolute top-0 inset-x-0 h-40 bg-gradient-to-b from-orange-50/50 to-transparent pointer-events-none" />

        {/* Title Header */}
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-bold uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5 text-orange-500" />
            {isAnswering
              ? (isHindi ? "जवाब मोड" : "Answer Mode")
              : (isHindi ? "सिर्फ बोलो तकनीक" : "Sirf Bolo AI Voice")}
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">
            {isAnswering
              ? (isHindi ? "सवाल का जवाब दें" : "Record Your Answer")
              : (isHindi ? "ध्वनि से हिसाब दर्ज करें" : "Speak to Record Sale")}
          </h2>
          <p className="text-sm text-slate-500 max-w-sm mt-1">
            {isAnswering
              ? (isHindi ? "ऊपर पूछे गए सवाल का जवाब रिकॉर्ड करें" : "Reply to the follow-up question above")
              : (isHindi ? "अपनी भाषा में बोलिए — हिंदी, मराठी, हिंगलिश" : "Speak naturally in Hindi, Hinglish, or English")}
          </p>
        </div>

        {/* Big Mic Button with Pulsing Wave */}
        <div className="relative z-10 flex items-center justify-center my-4">
          {isRecording && (
            <>
              <div className="absolute w-44 h-44 rounded-full bg-rose-500/20 animate-ripple pointer-events-none" />
              <div className="absolute w-56 h-56 rounded-full bg-rose-500/10 animate-ripple delay-300 pointer-events-none" />
            </>
          )}

          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={`relative w-28 h-28 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 active:scale-95 ${
              isRecording
                ? "bg-gradient-to-tr from-rose-600 to-red-500 text-white shadow-rose-500/40 ring-4 ring-rose-200"
                : "bg-gradient-to-tr from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-orange-500/30 ring-4 ring-orange-100 hover:scale-105"
            }`}
          >
            {isRecording ? (
              <Square className="w-10 h-10 fill-white" />
            ) : (
              <Mic className="w-12 h-12" />
            )}
          </button>
        </div>

        {/* Instructions / Action Buttons */}
        <div className="relative z-10 w-full max-w-xs flex flex-col gap-3">
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-full py-4 rounded-2xl text-sm font-black transition-all shadow-md ${
              isRecording
                ? "bg-rose-600 text-white hover:bg-rose-700 shadow-rose-600/25"
                : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-orange-500/25"
            }`}
          >
            {isRecording
              ? (isHindi ? "⏹ रिकॉर्डिंग रोकें" : "⏹ Stop Recording")
              : isAnswering
                ? (isHindi ? "🎤 जवाब रिकॉर्ड करें" : "🎤 Record Answer")
                : (isHindi ? "🎤 बोलना शुरू करें" : "🎤 Tap to Speak")}
          </button>

          {/* Status Message */}
          <div className={`p-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 ${
            recordStatus.includes("✅")
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : isRecording
                ? "bg-rose-50 border-rose-200 text-rose-700 animate-pulse"
                : "bg-slate-50 border-slate-200 text-slate-600"
          }`}>
            {recordStatus.includes("✅") ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : isRecording ? (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            ) : (
              <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
            )}
            <span>{recordStatus}</span>
          </div>
        </div>

        {/* Examples of what to say */}
        <div className="relative z-10 w-full max-w-md pt-6 border-t border-slate-100 text-left">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
            💡 {isHindi ? "ऐसे बोल सकते हैं:" : "Examples you can say:"}
          </p>
          <div className="grid gap-2 text-xs font-semibold text-slate-600">
            <div className="rounded-xl bg-slate-50 px-3 py-2 border border-slate-100 flex items-center justify-between">
              <span>"5 किलो आलू 150 में बेचा"</span>
              <span className="text-[10px] text-emerald-600 font-bold">{isHindi ? "नकद बिक्री" : "Cash Sale"}</span>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 border border-slate-100 flex items-center justify-between">
              <span>"रमेश ने 300 रुपये का सामान उधार लिया"</span>
              <span className="text-[10px] text-amber-600 font-bold">{isHindi ? "उधारी खाता" : "Credit"}</span>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 border border-slate-100 flex items-center justify-between">
              <span>"मंडी से 12 दर्जन केले 400 में खरीदे"</span>
              <span className="text-[10px] text-rose-600 font-bold">{isHindi ? "स्टॉक खर्च" : "Stock Expense"}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
