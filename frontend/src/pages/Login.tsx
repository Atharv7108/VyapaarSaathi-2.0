import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useStore } from "../store/useStore";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function Login() {
  const navigate = useNavigate();
  const { loginAsVendor, setHasOnboarded, setUserName, setLanguage } = useStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function normalizePhone(raw: string): string {
    return raw.replace(/\D/g, "");
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const digits = normalizePhone(phone);
    if (digits.length < 10) {
      setError("Please enter a valid phone number (at least 10 digits).");
      return;
    }
    setLoading(true);
    try {
      const vendorPhone = digits.length === 10 ? `91${digits}` : digits;
      const res = await fetch(`${API_BASE}/auth/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `whatsapp:+${vendorPhone}` }),
      });
      if (!res.ok) throw new Error("Failed to send OTP");
      setStep(2);
    } catch (err) {
      setError("Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (otp.length !== 4) {
      setError("Please enter the 4-digit OTP.");
      return;
    }
    setLoading(true);
    try {
      const digits = normalizePhone(phone);
      const vendorPhone = digits.length === 10 ? `91${digits}` : digits;
      const fullPhone = `whatsapp:+${vendorPhone}`;
      
      const res = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone, otp: otp }),
      });
      
      if (!res.ok) throw new Error("Invalid OTP");
      
      const data = await res.json();
      
      // Successfully authenticated
      loginAsVendor(fullPhone);
      
      const vendor = data.vendor || {};
      const state = vendor.state || "new";
      
      if (state === "new" || state === "awaiting_name") {
        setHasOnboarded(false);
        navigate("/onboarding", { replace: true });
      } else {
        setHasOnboarded(true);
        setUserName(vendor.name || "");
        setLanguage(vendor.language || "hi");
        navigate("/app", { replace: true });
      }
      
    } catch (err) {
      setError("Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4 font-['Manrope',sans-serif]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');`}</style>

      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl shadow-black/40 p-8 sm:p-10">
          <div className="flex flex-col items-center mb-8">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="VyapaarSathi" className="h-16 w-auto object-contain mb-3" />
            <h1 className="text-2xl font-black text-slate-900">{step === 1 ? "Welcome Back" : "Enter OTP"}</h1>
            <p className="text-sm text-slate-500 mt-1 text-center">
              {step === 1 
                ? "Enter the WhatsApp number linked to your VyapaarSathi account"
                : `We've generated an OTP for ${phone}. (Use 1234 for testing)`}
            </p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleRequestOtp} className="space-y-5 animate-in fade-in duration-300">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
                  WhatsApp Number
                </label>
                <div className="flex items-center gap-2 border-2 border-slate-200 focus-within:border-orange-400 rounded-2xl px-4 py-3 transition">
                  <span className="text-slate-400 font-semibold text-sm">🇮🇳 +91</span>
                  <input
                    id="phone-input"
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="flex-1 outline-none text-slate-900 font-semibold text-base bg-transparent placeholder:text-slate-300"
                    autoComplete="tel"
                  />
                </div>
                {error && <p className="mt-2 text-xs text-red-500 font-medium">⚠️ {error}</p>}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-bold text-base rounded-2xl shadow-lg shadow-orange-500/20 transition"
              >
                {loading ? "Sending OTP..." : "Get OTP →"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 text-center">
                  4-Digit OTP
                </label>
                <div className="flex justify-center gap-4">
                  {[0, 1, 2, 3].map((idx) => (
                    <input
                      key={idx}
                      id={`otp-${idx}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={otp[idx] || ""}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        const newOtp = otp.split("");
                        newOtp[idx] = val;
                        setOtp(newOtp.join(""));
                        
                        if (val && idx < 3) {
                          document.getElementById(`otp-${idx + 1}`)?.focus();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && !otp[idx] && idx > 0) {
                          document.getElementById(`otp-${idx - 1}`)?.focus();
                        }
                      }}
                      className="w-14 h-14 text-center text-xl font-black text-slate-900 bg-slate-50 border-2 border-slate-200 focus:border-orange-400 focus:bg-white rounded-xl outline-none transition"
                    />
                  ))}
                </div>
                {error && <p className="mt-4 text-xs text-center text-red-500 font-medium">⚠️ {error}</p>}
              </div>
              <button
                type="submit"
                disabled={loading || otp.length < 4}
                className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:shadow-none text-white font-bold text-base rounded-2xl shadow-lg shadow-orange-500/20 transition mt-2"
              >
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>
              <button
                type="button"
                onClick={() => { setStep(1); setOtp(""); setError(""); }}
                className="w-full py-3 text-slate-500 hover:text-slate-800 font-bold text-sm transition"
              >
                ← Back to Phone Number
              </button>
            </form>
          )}

          {step === 1 && (
            <div className="mt-6 text-center">
              <Link to="/" className="text-sm text-slate-400 hover:text-slate-600 transition">
                ← Back to Home
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
