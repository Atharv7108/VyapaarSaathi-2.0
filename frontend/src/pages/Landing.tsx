import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";

type Lang = "en" | "hi";

// Waveform bar heights (same as prototype)
const WH = [3,6,10,16,22,28,24,18,26,30,24,20,14,10,16,22,26,20,16,12,8,14,20,24,18,14,10,6,4,8];

// Alternating user voice → bot reply messages (exactly like prototype)
const CHAT_MSGS = [
  { sender: "user",  isVoice: true,  dur: "0:07", caption: "Aam 5kg, 650 rupees mein becha",        text: "" },
  { sender: "bot",   isVoice: false, dur: "",       caption: "", text: "✅ Recorded!\nAam 5kg → +₹650\nAaj ki kamai: ₹2,340" },
  { sender: "user",  isVoice: true,  dur: "0:05", caption: "Raju bhai ne 340 udhar liya",          text: "" },
  { sender: "bot",   isVoice: false, dur: "",       caption: "", text: "📝 Udhari saved!\nRaju Bhai: ₹340\nTotal pending: ₹1,020" },
  { sender: "user",  isVoice: true,  dur: "0:09", caption: "Kela ka stock khatam ho raha hai",    text: "" },
  { sender: "bot",   isVoice: false, dur: "",       caption: "", text: "⚠️ Stock alert set!\nKela: only 8 dozen left\nRestock reminder: 7am tomorrow" },
];

function VoiceBubble({ dur, isUser, isNew }: { dur: string; isUser: boolean; isNew?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const ti = setInterval(() => {
      setProg(p => {
        if (p >= WH.length - 1) { setPlaying(false); return 0; }
        return p + 1;
      });
    }, 120);
    return () => clearInterval(ti);
  }, [playing]);

  return (
    <div
      onClick={() => setPlaying(p => !p)}
      className="flex items-center gap-2 cursor-pointer shadow-sm"
      style={{
        padding: "8px 12px",
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser ? "#DCF8C6" : "#fff",
        maxWidth: 220,
        animation: isNew ? "msgIn 0.35s ease" : undefined,
      }}
    >
      <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center text-white text-xs flex-shrink-0">
        {playing ? "⏸" : "▶"}
      </div>
      <svg width={WH.length * 4} height={28} className="flex-shrink-0">
        {WH.map((h, i) => (
          <rect key={i} x={i * 4} y={(28 - h) / 2} width={3} height={h}
            fill={i <= prog ? "#25D366" : "#B5B5B5"} rx={1.5} />
        ))}
      </svg>
      <span className="text-[11px] text-slate-400 flex-shrink-0 font-mono">{dur}</span>
    </div>
  );
}

const FEATURES = [
  { e: "🎤", en: "Voice Bookkeeping", hi: "वॉयस बुककीपिंग", desc_en: "WhatsApp pe sirf bolo — we record everything. No typing, no app to learn.", desc_hi: "WhatsApp पर सिर्फ बोलो — हम सब लिख लेते हैं।" },
  { e: "📊", en: "Smart Analytics", hi: "स्मार्ट एनालिटिक्स", desc_en: "Daily, weekly and monthly reports auto-generated. See exactly how you're earning.", desc_hi: "दैनिक, साप्ताहिक और मासिक रिपोर्ट स्वचालित रूप से बनती है।" },
  { e: "💳", en: "Udhari Tracker", hi: "उधारी ट्रैकर", desc_en: "Who owes you and how much — crystal clear. Overdue alerts included.", desc_hi: "कौन कितना बकाया है — बिल्कुल साफ। बकाया अलर्ट के साथ।" },
  { e: "📦", en: "Stock Alerts", hi: "स्टॉक अलर्ट", desc_en: "Get alerts when stock runs low. Never run out of your top-selling items.", desc_hi: "जब स्टॉक कम हो तो अलर्ट मिलता है।" },
  { e: "🤖", en: "AI Market Insights", hi: "AI बाजार जानकारी", desc_en: "Every morning, AI tells you which items sell most and when demand peaks.", desc_hi: "हर सुबह AI बताएगा — कौन सा आइटम ज्यादा बिक रहा है।" },
  { e: "📥", en: "PDF Reports", hi: "PDF रिपोर्ट", desc_en: "CA-ready reports in one click. Prepared for income tax, GST and more.", desc_hi: "एक क्लिक में CA-ready रिपोर्ट। इनकम टैक्स, GST के लिए तैयार।" },
];

const STEPS = [
  { e: "📱", en: "Register & Get Connected", hi: "रजिस्टर करें और जुड़ें", desc_en: "Sign up and get a dedicated WhatsApp number for your business in minutes.", desc_hi: "साइन अप करें और कुछ मिनटों में WhatsApp से जुड़ें।" },
  { e: "🎤", en: "Just Speak in Your Language", hi: "अपनी भाषा में बोलें", desc_en: "Send a voice note on WhatsApp — say what you sold, spent, or who owes you.", desc_hi: "WhatsApp पर voice note भेजें — जो बेचा, जो खर्च किया, या जिसने उधार लिया।" },
  { e: "📊", en: "See Your Full Dashboard", hi: "पूरा डैशबोर्ड देखें", desc_en: "Open VyapaarSathi anytime to see complete data, reports, stock, and AI insights.", desc_hi: "कभी भी VyapaarSaathi खोलें और पूरा डेटा, रिपोर्ट और AI सुझाव देखें।" },
];

const FAQS = [
  { q_en: "How does voice recognition work?", q_hi: "Voice recognition कैसे काम करती है?", a_en: "You send a voice note on WhatsApp in Hindi, Marathi, or Hinglish. Our AI transcribes and understands the transaction and records it instantly.", a_hi: "आप WhatsApp पर हिंदी, मराठी, या हिंगलिश में voice note भेजते हैं। हमारा AI तुरंत समझता है।" },
  { q_en: "Is my business data safe?", q_hi: "क्या डेटा सुरक्षित है?", a_en: "Yes, all data is encrypted and stored securely. Only you and your admin can access your business data.", a_hi: "हाँ, डेटा एन्क्रिप्टेड है। केवल आप और एडमिन देख सकते हैं।" },
  { q_en: "Can I use it without a smartphone?", q_hi: "बिना स्मार्टफोन के?", a_en: "VyapaarSathi works on any phone with WhatsApp — even basic smartphones. Very low data usage.", a_hi: "WhatsApp वाले किसी भी फोन पर काम करता है।" },
  { q_en: "What languages are supported?", q_hi: "कौन सी भाषाएं?", a_en: "Currently Hindi, Marathi, Hinglish, and English. More regional languages coming soon.", a_hi: "हिंदी, मराठी, हिंगलिश, अंग्रेजी। जल्द और भाषाएं।" },
  { q_en: "Is VyapaarSathi really free?", q_hi: "क्या वाकई मुफ्त है?", a_en: "Yes! The basic plan is 100% free. Premium features like advanced analytics are in paid plans.", a_hi: "हाँ! बेसिक प्लान 100% मुफ्त है।" },
  { q_en: "How do I get started?", q_hi: "कैसे शुरू करें?", a_en: "Click Start Free below and sign in with your WhatsApp number. Done in under 2 minutes.", a_hi: "नीचे 'शुरू करें' पर क्लिक करें और WhatsApp नंबर से साइन इन करें।" },
];

export default function Landing() {
  const navigate = useNavigate();
  const { isLoggedIn, userRole } = useStore();
  const [lang, setLang] = useState<Lang>("en");
  const [msgIdx, setMsgIdx] = useState(0);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isLoggedIn) {
      navigate(userRole === "admin" ? "/admin" : "/app", { replace: true });
    }
  }, [isLoggedIn, userRole, navigate]);

  // Animate demo chat — step through one bubble every 2.4s, then restart
  useEffect(() => {
    const t = setInterval(() => {
      setMsgIdx(i => {
        if (i >= CHAT_MSGS.length - 1) return 0;
        return i + 1;
      });
    }, 2400);
    return () => clearInterval(t);
  }, []);

  const t = (en: string, hi: string) => lang === "hi" ? hi : en;

  return (
    <div className="min-h-screen bg-white font-['Manrope',sans-serif] text-slate-900 overflow-x-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800;900&display=swap');
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes msgIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .animate-float { animation: float 3.5s ease-in-out infinite; }
        .animate-fadeUp { animation: fadeUp 0.7s ease both; }
        .animate-msgIn { animation: msgIn 0.4s ease both; }
        .nav-link { transition: color 0.2s; }
        .nav-link:hover { color: #EA580C; }
        .feat-card:hover { transform: translateY(-4px); box-shadow: 0 20px 60px rgba(15,23,42,0.10); }
        .feat-card { transition: transform 0.22s ease, box-shadow 0.22s ease; }
      `}</style>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2">
            <img src="/logo.png" alt="VyapaarSathi" className="h-9 w-auto object-contain" />
            <span className="font-extrabold text-lg text-slate-900 tracking-tight">VyapaarSathi</span>
          </a>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
            <a href="#features" className="nav-link">{t("Features", "विशेषताएं")}</a>
            <a href="#how" className="nav-link">{t("How it Works", "कैसे काम करता है")}</a>
            <a href="#demo" className="nav-link">{t("Demo", "डेमो")}</a>
            <a href="#about" className="nav-link">{t("About", "हमारे बारे में")}</a>
            <a href="#faq" className="nav-link">{t("Help", "सहायता")}</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={() => setLang(l => l === "en" ? "hi" : "en")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-slate-200 text-xs font-bold text-slate-600 hover:border-orange-300 transition"
            >
              🌐 {lang.toUpperCase()}
            </button>
            <button
              onClick={() => navigate("/login")}
              className="px-5 py-2 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold shadow-sm transition"
            >
              {t("Sign In", "साइन इन")}
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="md:hidden p-2 rounded-lg text-slate-600"
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 px-4 py-4 flex flex-col gap-4">
            {["#features","#how","#demo","#about","#faq"].map((href, i) => (
              <a key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="text-sm font-semibold text-slate-600 nav-link">
                {[t("Features","विशेषताएं"),t("How it Works","कैसे काम करता है"),"Demo",t("About","हमारे बारे में"),t("Help","सहायता")][i]}
              </a>
            ))}
            <button onClick={() => navigate("/login")} className="w-full py-2 rounded-full bg-orange-500 text-white font-bold text-sm">
              {t("Sign In", "साइन इन")}
            </button>
          </div>
        )}
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1600&q=80')" }}
        />
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/85 via-slate-900/60 to-slate-900/20" />

        <div className="relative max-w-7xl mx-auto px-6 sm:px-8 w-full py-20">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">

            {/* Left text */}
            <div className="flex-1 animate-fadeUp">
              <span className="inline-block bg-orange-500/20 border border-orange-400/40 text-orange-300 text-xs font-bold px-4 py-1.5 rounded-full mb-6">
                🇮🇳 {t("Made for India's Dukandaars", "भारत के दुकानदारों के लिए")}
              </span>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white leading-tight">
                {t("Sirf Bolo.", "सिर्फ बोलो.")}
                <br />
                <span className="text-orange-400">{t("Hum Likhenge.", "हम लिखेंगे.")} 📖</span>
              </h1>
              <p className="mt-6 text-base sm:text-lg text-slate-300 leading-relaxed max-w-lg">
                {t(
                  "WhatsApp pe ek voice note bhejo — VyapaarSathi manages all your transactions, stock, and udhari. Free. Simple.",
                  "WhatsApp पर एक voice note भेजो — VyapaarSathi आपके सभी लेन-देन, स्टॉक और उधारी संभालेगा। मुफ्त। आसान।"
                )}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={() => navigate("/login")}
                  className="px-7 py-3.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-full text-base shadow-lg shadow-orange-500/30 transition"
                >
                  🚀 {t("Start Free", "मुफ्त शुरू करें")}
                </button>
                <a
                  href="#how"
                  className="px-7 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-full text-base border border-white/20 transition"
                >
                  {t("See How it Works →", "यह कैसे काम करता है →")}
                </a>
              </div>

              {/* Trust badges */}
              <div className="mt-8 flex flex-wrap gap-3">
                {[
                  t("✅ No typing needed", "✅ कोई टाइपिंग नहीं"),
                  t("✅ Hindi, Marathi, Hinglish", "✅ हिंदी, मराठी, हिंगलिश"),
                  t("✅ Works on WhatsApp", "✅ WhatsApp पर काम करता है"),
                  "✅ 100% Free",
                ].map(badge => (
                  <span key={badge} className="text-xs font-semibold text-white/80 bg-white/10 px-3 py-1.5 rounded-full border border-white/10">
                    {badge}
                  </span>
                ))}
              </div>

              <p className="mt-6 text-xs text-slate-400 italic">
                "{t("Your language, your business — just one voice away.", "आपकी भाषा, आपका व्यापार — बस एक आवाज़ दूर।")}"
              </p>
            </div>

            {/* Demo chat */}
            <div className="w-full max-w-xs lg:max-w-sm animate-float">
              <div className="rounded-3xl overflow-hidden shadow-2xl shadow-black/40 border border-white/10">
                {/* Chat header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-[#075E54]">
                  <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm">VS</div>
                  <div>
                    <p className="text-white font-bold text-sm">VyapaarSathi Bot</p>
                    <p className="text-green-300 text-xs">● Online · WhatsApp</p>
                  </div>
                </div>
                {/* Chat body */}
                <div className="bg-[#ECE5DD] p-4 space-y-3 min-h-[260px]">
                  {CHAT_MSGS.slice(0, msgIdx + 1).map((m, i) => (
                    <div key={i} className={`animate-msgIn ${i % 2 === 0 ? "flex justify-end" : "flex justify-start"}`}>
                      {i % 2 === 0 ? (
                        <div className="bg-[#DCF8C6] rounded-2xl rounded-tr-sm px-3 py-2 max-w-[75%] shadow-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">▶</div>
                            <div className="flex-1 h-2 bg-green-400/50 rounded-full" />
                            <span className="text-[10px] text-slate-500">{m.dur}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white rounded-2xl rounded-tl-sm px-3 py-2 max-w-[80%] shadow-sm">
                          <p className="text-xs text-slate-700 whitespace-pre-line">{m.text}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Input bar */}
                <div className="flex items-center gap-2 px-3 py-2 bg-[#F0F0F0] border-t border-slate-200">
                  <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-xs text-slate-400">Tap to speak...</div>
                  <div className="w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center text-white text-xs">🎤</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it Works ────────────────────────────────────────────────────── */}
      <section id="how" className="py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6 sm:px-8">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-500">{t("Simple hai, yaar", "बिल्कुल आसान है")}</span>
            <h2 className="mt-3 text-4xl sm:text-5xl font-black text-slate-900">{t("How Does it Work? 🤔", "यह कैसे काम करता है? 🤔")}</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={i} className="relative bg-white rounded-3xl p-8 shadow-sm border border-slate-100 feat-card">
                <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-2xl mb-5">{s.e}</div>
                <span className="absolute top-6 right-6 text-5xl font-black text-slate-100 select-none">{i + 1}</span>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{lang === "hi" ? s.hi : s.en}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{lang === "hi" ? s.desc_hi : s.desc_en}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-6 sm:px-8">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-500">{t("Everything in one place", "सब एक जगह")}</span>
            <h2 className="mt-3 text-4xl sm:text-5xl font-black text-slate-900">{t("Powerful Features 🚀", "शक्तिशाली विशेषताएं 🚀")}</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div key={i} className="feat-card bg-white border border-slate-100 rounded-3xl p-7 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center text-2xl mb-4">{f.e}</div>
                <h3 className="font-bold text-slate-900 mb-2">{lang === "hi" ? f.hi : f.en}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{lang === "hi" ? f.desc_hi : f.desc_en}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Demo ─────────────────────────────────────────────────────────────── */}
      <section id="demo" className="py-24" style={{ background: "#F8F5F0" }}>
        <div className="max-w-5xl mx-auto px-6 sm:px-8">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-500">{t("See it in action", "काम में देखें")}</span>
            <h2 className="mt-3 text-4xl sm:text-5xl font-black text-slate-900">{t("WhatsApp Voice Note → Instant Data 💬", "WhatsApp Voice Note → तुरंत डेटा 💬")}</h2>
            <p className="mt-4 text-slate-500 max-w-xl mx-auto text-base leading-relaxed">
              {t("Send a voice note — the VyapaarSathi bot understands and stores it in your dashboard instantly.", "Voice note भेजें — VyapaarSathi bot तुरंत समझता है और dashboard में सेव करता है।")}
            </p>
          </div>

          {/* Two-column layout */}
          <div className="grid md:grid-cols-2 gap-8 items-center">

            {/* ── Left: WhatsApp Chat ── */}
            <div className="rounded-3xl overflow-hidden shadow-2xl shadow-slate-900/30 border border-white/60">
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3.5 bg-[#075E54]">
                <div className="w-11 h-11 rounded-full bg-[#25D366] flex items-center justify-center text-xl flex-shrink-0">🤖</div>
                <div className="flex-1">
                  <p className="text-white font-bold text-sm leading-tight">VyaparSathi Bot</p>
                  <p className="text-[rgba(255,255,255,0.7)] text-xs">● Online · WhatsApp Business</p>
                </div>
                <span className="text-white/70 text-lg">📞</span>
              </div>

              {/* Chat messages */}
              <div className="bg-[#ECE5DD] px-4 py-4 space-y-2.5 min-h-[340px]">
                {CHAT_MSGS.slice(0, msgIdx + 1).map((m, i) => (
                  <div
                    key={i}
                    className="flex flex-col"
                    style={{
                      alignItems: m.sender === "user" ? "flex-end" : "flex-start",
                      animation: i === msgIdx ? "msgIn 0.35s ease" : undefined,
                    }}
                  >
                    {m.isVoice ? (
                      <VoiceBubble dur={m.dur!} isUser={m.sender === "user"} isNew={i === msgIdx} />
                    ) : (
                      <div
                        className="text-xs leading-relaxed whitespace-pre-line shadow-sm font-['Noto_Sans',sans-serif]"
                        style={{
                          maxWidth: "78%",
                          padding: "10px 14px",
                          borderRadius: m.sender === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: m.sender === "user" ? "#DCF8C6" : "#fff",
                          color: "#111",
                        }}
                      >
                        {m.text}
                      </div>
                    )}
                    {m.isVoice && m.caption && (
                      <span className="text-[10px] text-slate-400 mt-0.5 px-1">{m.caption}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Input bar */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#F0F2F5] border-t border-slate-200">
                <div className="flex-1 bg-white rounded-full px-4 py-2 text-xs text-slate-400 shadow-sm">Tap to speak...</div>
                <div className="w-9 h-9 bg-[#25D366] rounded-full flex items-center justify-center text-white text-sm shadow-sm">🎤</div>
              </div>
            </div>

            {/* ── Right: QR + Explainer ── */}
            <div className="flex flex-col gap-6">
              {/* QR Card */}
              <div className="bg-white rounded-3xl p-6 text-center shadow-sm border border-orange-100">
                <p className="text-sm font-semibold text-slate-600 mb-4">{t("Scan to Open VyapaarSathi Bot", "VyapaarSathi Bot खोलने के लिए स्कैन करें")}</p>
                <div className="inline-block p-2.5 bg-white rounded-2xl border-2 border-orange-400 shadow-lg shadow-orange-500/20">
                  <img
                    src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=ffffff&color=000000&data=https%3A%2F%2Fwa.me%2F917000000000%3Ftext%3DHi%2520VyaparSathi"
                    alt="WhatsApp QR Code"
                    className="w-40 h-40 rounded-xl block"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-3 mb-3">{t("or tap to open on your phone", "या फोन पर क्लिक करें")}</p>
                <a
                  href="https://wa.me/917000000000?text=Hi%20VyaparSathi"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-green-500/30 transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #25D366, #1da851)" }}
                >
                  💬 Open on WhatsApp
                </a>
              </div>

              {/* Explainer Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                <p className="font-bold text-slate-900 mb-4 text-sm">⚡ {t("What happens when you send a voice note:", "Voice note भेजने पर क्या होता है:")}</p>
                <div className="space-y-0">
                  {[
                    { e: "🎤", en: "You speak in Hindi, Marathi, or Hinglish", hi: "आप हिंदी, मराठी, या हिंगलिश में बोलते हैं" },
                    { e: "🤖", en: "AI transcribes and understands the intent", hi: "AI समझता है और लेन-देन नोट करता है" },
                    { e: "💾", en: "Data stored in your dashboard in real-time", hi: "डेटा तुरंत आपके डैशबोर्ड में सेव होता है" },
                    { e: "📊", en: "Reports and insights update automatically", hi: "रिपोर्ट और AI सुझाव अपने आप अपडेट होते हैं" },
                  ].map((step, i, arr) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-3"
                      style={{ borderBottom: i < arr.length - 1 ? "1px solid #F1F5F9" : "none" }}
                    >
                      <span className="text-xl w-7 text-center flex-shrink-0">{step.e}</span>
                      <span className="text-sm text-slate-600 leading-snug">{lang === "hi" ? step.hi : step.en}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>


      {/* ── About ─────────────────────────────────────────────────────────────── */}
      <section id="about" className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-orange-500">{t("Our Story", "हमारी कहानी")}</span>
          <h2 className="mt-3 text-4xl sm:text-5xl font-black text-slate-900">{t("Built for Bharat's Vendors 🏪", "भारत के व्यापारियों के लिए बना 🏪")}</h2>
          <div className="mt-8 space-y-5 text-slate-600 leading-relaxed text-lg">
            <p>{t("VyapaarSathi was born from a simple observation: millions of small vendors across India manage their entire business in their head or in worn-out notebooks.", "VyapaarSathi एक सरल अवलोकन से पैदा हुआ: भारत भर में लाखों छोटे व्यापारी अपना पूरा व्यवसाय दिमाग में या घिसी-पिटी नोटबुक में रखते हैं।")}</p>
            <p>{t("We built a solution that works the way vendors do — just speak in your language, and we handle the rest. No apps to learn, no typing required.", "हमने एक ऐसा समाधान बनाया — बस अपनी भाषा में बोलो, बाकी हम संभालेंगे। कोई ऐप सीखने की ज़रूरत नहीं।")}</p>
            <p>{t("Today, VyapaarSathi helps vendors track sales, manage stock, monitor udhari, and get AI-powered business insights — all through WhatsApp.", "आज VyapaarSathi व्यापारियों को बिक्री, स्टॉक, उधारी और AI insights में मदद करता है — सब WhatsApp पर।")}</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 bg-slate-50">
        <div className="max-w-3xl mx-auto px-6 sm:px-8">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-500">{t("Got Questions?", "सवाल हैं?")}</span>
            <h2 className="mt-3 text-4xl sm:text-5xl font-black text-slate-900">{t("Help Centre ❓", "सहायता केंद्र ❓")}</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <button
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                  className="w-full flex justify-between items-center px-6 py-5 text-left font-semibold text-slate-900 hover:text-orange-600 transition"
                >
                  <span>{lang === "hi" ? faq.q_hi : faq.q_en}</span>
                  <span className="text-xl text-orange-500">{faqOpen === i ? "−" : "+"}</span>
                </button>
                {faqOpen === i && (
                  <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed animate-fadeUp">
                    {lang === "hi" ? faq.a_hi : faq.a_en}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="py-24 bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl sm:text-5xl font-black text-white">{t("Start Today — It's Free! 🚀", "आज ही शुरू करें — मुफ्त! 🚀")}</h2>
          <p className="mt-4 text-slate-400 text-lg">{t("Join thousands of vendors already using VyapaarSathi to grow their business.", "हजारों व्यापारियों से जुड़ें।")}</p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate("/login")}
              className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg rounded-full shadow-lg shadow-orange-500/30 transition"
            >
              🚀 {t("Sign In — Free", "साइन इन — मुफ्त")}
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="bg-slate-900 border-t border-slate-800 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="VyapaarSathi" className="h-7 w-auto opacity-80" />
            <span className="text-slate-400 text-sm font-semibold">VyapaarSathi</span>
          </div>
          <p className="text-slate-500 text-xs">{t("Made with ❤️ for India's vendors · © 2026 VyapaarSathi", "भारत के व्यापारियों के लिए ❤️ से बनाया · © 2026 VyapaarSathi")}</p>
          <div className="flex gap-4 text-xs text-slate-500">
            <a href="#" className="hover:text-slate-300 transition">{t("Privacy", "गोपनीयता")}</a>
            <a href="#" className="hover:text-slate-300 transition">{t("Terms", "शर्तें")}</a>
            <a href="#" className="hover:text-slate-300 transition">{t("Contact", "संपर्क")}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
