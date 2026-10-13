import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";
import {
  Users,
  TrendingUp,
  Activity,
  Layers,
  Search,
  RefreshCw,
  LogOut,
  Send,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Package,
  Receipt,
  Server,
  X,
  ExternalLink,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  Save,
  Download,
  DollarSign,
  Clock,
  Zap,
  Settings,
  User as UserIcon,
  ChevronDown,
  Image as ImageIcon,
  FileText,
  Upload,
  Paperclip,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

/* ─────────────────────────────────────────────────────────────────────────────
   DESIGN SYSTEM SPEC
   - Background: #0B0D10
   - Surface:    #111418
   - Border:     #1F242B
   - Text Pri:   #E6E8EB
   - Text Sec:   #8B93A0
   - Accent:     #F97316 (One accent used sparingly: active tab, primary CTA, main chart line)
   - Font:       Inter, tabular-nums for numeric metrics
   - Radii:      8px cards, 6px buttons/inputs, small badges
   - Grid:       8px spacing, 20px card padding
───────────────────────────────────────────────────────────────────────────── */

type Vendor = {
  phone: string;
  name: string | null;
  business_name: string | null;
  business_category: string | null;
  state: string;
  language: string;
  registered_at: string;
  last_active: string;
  active: boolean;
  entry_count?: number;
  pin?: string;
};

type AdminStats = {
  total_vendors: number;
  active_vendors: number;
  onboarded_vendors: number;
  pending_vendors: number;
  total_entries: number;
  total_inventory: number;
  total_earned: number;
  total_spent: number;
  categories: { category: string; count: number }[];
  category_pie?: { name: string; value: number; percentage: number }[];
  daily_trends?: {
    date: string;
    label: string;
    income: number;
    expense: number;
    transactions: number;
    net: number;
  }[];
  hourly_velocity?: {
    hour: number;
    label: string;
    transactions: number;
  }[];
  cashflow?: {
    gmv: number;
    expenses: number;
    net_profit: number;
    margin_percent: number;
  };
  recent_activity: {
    phone: string;
    amount?: number;
    type?: string;
    category?: string;
    description?: string;
    quantity?: number;
    created_at?: string;
    vendor_label?: string;
  }[];
  selected_vendor?: {
    phone: string;
    name?: string;
    business_name?: string;
    business_category?: string;
  } | null;
};

type AuditLog = {
  timestamp: string;
  admin: string;
  action: string;
  details: Record<string, any>;
  ip?: string;
};

type VendorDetails = {
  vendor: Vendor;
  ledger: {
    amount?: number;
    type?: string;
    category?: string;
    description?: string;
    quantity?: number;
    created_at?: string;
    audio_url?: string;
  }[];
  inventory: {
    item_name: string;
    item_name_hi?: string;
    daily_stock?: number;
    current_stock?: number;
    price_per_unit?: number;
    unit?: string;
    stock_date?: string;
  }[];
};

function formatCleanDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatTimeAgo(iso?: string) {
  if (!iso) return "—";
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Subtle Status Badge ─────────────────────────────────────────────────────
function StateBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
    active:                 { label: "Active",            dot: "#22c55e", text: "#86efac", bg: "rgba(34,197,94,0.06)",  border: "rgba(34,197,94,0.2)" },
    awaiting_name:          { label: "Awaiting Name",     dot: "#f59e0b", text: "#fcd34d", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.2)" },
    awaiting_consent:       { label: "Awaiting Consent",  dot: "#60a5fa", text: "#93c5fd", bg: "rgba(96,165,250,0.06)", border: "rgba(96,165,250,0.2)" },
    awaiting_category:      { label: "Awaiting Category", dot: "#a78bfa", text: "#c4b5fd", bg: "rgba(167,139,250,0.06)",border: "rgba(167,139,250,0.2)" },
    awaiting_business_name: { label: "Awaiting Biz Name", dot: "#38bdf8", text: "#7dd3fc", bg: "rgba(56,189,248,0.06)", border: "rgba(56,189,248,0.2)" },
    declined:               { label: "Declined",          dot: "#ef4444", text: "#fca5a5", bg: "rgba(239,68,68,0.06)",  border: "rgba(239,68,68,0.2)" },
    new:                    { label: "New Lead",          dot: "#8B93A0", text: "#8B93A0", bg: "rgba(139,147,160,0.06)",border: "rgba(139,147,160,0.2)" },
  };
  const t = map[state] ?? map.new;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: 4,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.text,
        letterSpacing: "0.01em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot, flexShrink: 0 }} />
      {t.label}
    </span>
  );
}

// ─── Loading Skeleton Helper ─────────────────────────────────────────────────
function Skeleton({ width = "100%", height = 16, style }: { width?: string | number; height?: string | number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width,
        height,
        background: "#1F242B",
        borderRadius: 4,
        animation: "pulse 1.8s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

// ─── Clean Monotone KPI Card ─────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string | number;
  delta?: string;
  icon?: React.ElementType;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        background: "#111418",
        border: "1px solid #1F242B",
        borderRadius: 8,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 120,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#8B93A0",
          }}
        >
          {label}
        </span>
        {Icon && <Icon size={16} style={{ color: "#8B93A0" }} />}
      </div>
      <div>
        {loading ? (
          <Skeleton width={140} height={32} style={{ marginBottom: 6 }} />
        ) : (
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: "#E6E8EB",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            {value}
          </div>
        )}
        {loading ? (
          <Skeleton width={180} height={14} style={{ marginTop: 8 }} />
        ) : delta ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#8B93A0", fontVariantNumeric: "tabular-nums" }}>
            {delta}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main Admin Dashboard Component ──────────────────────────────────────────
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout, adminToken } = useStore();

  const [activeTab, setActiveTab] = useState<"overview" | "vendors" | "funnel" | "broadcast" | "system">("overview");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Search & Filters
  const [search, setSearch] = useState("");
  const [selectedState, setSelectedState] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Chart Filters
  const [chartVendor, setChartVendor] = useState<string>("all");
  const [chartMetric, setChartMetric] = useState<"currency" | "activity">("currency");

  // Drawer
  const [selectedVendorPhone, setSelectedVendorPhone] = useState<string | null>(null);
  const [vendorDetails, setVendorDetails] = useState<VendorDetails | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"ledger" | "inventory" | "settings">("ledger");

  // Vendor Edit Form
  const [editForm, setEditForm] = useState({
    name: "",
    business_name: "",
    business_category: "",
    state: "active",
    active: true,
    language: "hi",
    pin: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [nudgingPhone, setNudgingPhone] = useState<string | null>(null);
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);
  const [confirmDeletePhone, setConfirmDeletePhone] = useState<string | null>(null);
  const [activatingPhone, setActivatingPhone] = useState<string | null>(null);

  // Broadcast state
  const [broadcastTarget, setBroadcastTarget] = useState<string>("all");
  const [broadcastMode, setBroadcastMode] = useState<"text" | "image" | "document" | "template">("text");
  const [mediaSource, setMediaSource] = useState<"file" | "url">("file");
  const [broadcastCustomPhone, setBroadcastCustomPhone] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastMediaUrl, setBroadcastMediaUrl] = useState("");
  const [broadcastMediaId, setBroadcastMediaId] = useState("");
  const [broadcastFilename, setBroadcastFilename] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    total_targets: number;
    sent: number;
    failed: number;
    sent_recipients: Array<{ phone: string; name: string }>;
    failed_recipients: Array<{ phone: string; name: string; error: string }>;
  } | null>(null);

  function getHeaders(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
    return headers;
  }

  function handleAuthError(res: Response) {
    if (res.status === 401 || res.status === 403) {
      showToast("Session expired. Please log in again.", "error");
      logout();
      navigate("/admin/login", { replace: true });
      return true;
    }
    return false;
  }

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    fetchStats(chartVendor);
    fetchVendors();
  }

  async function fetchStats(phone: string = chartVendor) {
    setStatsLoading(true);
    try {
      const q = phone && phone !== "all" ? `?phone=${encodeURIComponent(phone)}` : "";
      const res = await fetch(`/admin/stats${q}`, { headers: getHeaders() });
      if (handleAuthError(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to load stats:", e);
    } finally {
      setStatsLoading(false);
    }
  }

  async function fetchVendors() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/admin/vendors?limit=500", { headers: getHeaders() });
      if (handleAuthError(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVendors(Array.isArray(data.vendors) ? data.vendors : []);
    } catch (e) {
      setError(`Failed to load vendors: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAuditLogs() {
    setAuditLoading(true);
    try {
      const res = await fetch("/admin/audit-logs", { headers: getHeaders() });
      if (handleAuthError(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (e) {
      console.error("Failed to load audit logs:", e);
    } finally {
      setAuditLoading(false);
    }
  }

  async function openVendorDrawer(
    phone: string,
    initialTab: "ledger" | "inventory" | "settings" = "ledger"
  ) {
    setSelectedVendorPhone(phone);
    setDrawerLoading(true);
    setDrawerTab(initialTab);
    try {
      const res = await fetch(`/admin/vendors/${encodeURIComponent(phone)}/details`, { headers: getHeaders() });
      if (handleAuthError(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VendorDetails = await res.json();
      setVendorDetails(data);
      setEditForm({
        name: data.vendor.name || "",
        business_name: data.vendor.business_name || "",
        business_category: data.vendor.business_category || "",
        state: data.vendor.state || "active",
        active: data.vendor.active ?? true,
        language: data.vendor.language || "hi",
        pin: data.vendor.pin || "",
      });
    } catch (e) {
      showToast(`Failed to load details: ${e instanceof Error ? e.message : String(e)}`, "error");
      setSelectedVendorPhone(null);
    } finally {
      setDrawerLoading(false);
    }
  }

  async function handleQuickActivateVendor(
    phone: string,
    customName?: string,
    customBiz?: string,
    customCat?: string
  ) {
    setActivatingPhone(phone);
    try {
      const res = await fetch(`/admin/vendors/${encodeURIComponent(phone)}/activate`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: customName || undefined,
          business_name: customBiz || undefined,
          business_category: customCat || undefined,
          send_whatsapp_notification: true,
        }),
      });
      if (handleAuthError(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      showToast(`Merchant ${phone.replace("whatsapp:", "")} activated`, "success");

      if (data.vendor) {
        setVendors((prev) =>
          prev.map((v) => (v.phone === phone ? { ...v, ...data.vendor } : v))
        );
        if (selectedVendorPhone === phone && vendorDetails) {
          setVendorDetails({
            ...vendorDetails,
            vendor: { ...vendorDetails.vendor, ...data.vendor },
          });
          setEditForm((prev) => ({
            ...prev,
            state: "active",
            name: data.vendor.name || prev.name,
            business_name: data.vendor.business_name || prev.business_name,
            business_category: data.vendor.business_category || prev.business_category,
          }));
        }
      }
      fetchStats();
    } catch (e) {
      showToast(`Activation failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setActivatingPhone(null);
    }
  }

  async function handleSaveVendorEdit() {
    if (!selectedVendorPhone) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/admin/vendors/${encodeURIComponent(selectedVendorPhone)}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify(editForm),
      });
      if (handleAuthError(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      showToast("Vendor profile updated", "success");
      setVendors((prev) =>
        prev.map((v) => (v.phone === selectedVendorPhone ? { ...v, ...editForm } : v))
      );
      if (vendorDetails) {
        setVendorDetails({
          ...vendorDetails,
          vendor: { ...vendorDetails.vendor, ...editForm },
        });
      }
    } catch (e) {
      showToast(`Update failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleNudgeVendor(phone: string) {
    setNudgingPhone(phone);
    try {
      const res = await fetch(`/admin/vendors/${encodeURIComponent(phone)}/nudge`, {
        method: "POST",
        headers: getHeaders(),
      });
      if (handleAuthError(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      showToast(`WhatsApp reminder sent to ${phone.replace("whatsapp:", "")}`, "success");
    } catch (e) {
      showToast(`${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setNudgingPhone(null);
    }
  }

  async function handleDelete(phone: string) {
    setDeletingPhone(phone);
    try {
      const res = await fetch(`/admin/vendors/${encodeURIComponent(phone)}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (handleAuthError(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      showToast(`Vendor deleted (${data.deleted.ledger_entries} entries removed)`, "success");
      setVendors((prev) => prev.filter((v) => v.phone !== phone));
      if (selectedVendorPhone === phone) {
        setSelectedVendorPhone(null);
      }
      fetchStats();
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setDeletingPhone(null);
      setConfirmDeletePhone(null);
    }
  }

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      showToast("File is too large. Max size is 25MB.", "error");
      return;
    }

    setUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const headers: Record<string, string> = {};
      if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;

      const res = await fetch("/admin/upload-media", {
        method: "POST",
        headers,
        body: formData,
      });
      if (handleAuthError(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Upload failed: HTTP ${res.status}`);

      setBroadcastMediaUrl(data.url);
      setBroadcastFilename(data.filename);
      if (data.media_id) {
        setBroadcastMediaId(data.media_id);
      }
      setMediaSource("file");
      if (data.media_type === "image") {
        setBroadcastMode("image");
      } else {
        setBroadcastMode("document");
      }
      showToast(`Attached ${data.filename}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to upload file", "error");
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleBroadcastSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (broadcastMode === "text" && !broadcastMessage.trim()) {
      showToast("Please enter a message body.", "error");
      return;
    }
    if ((broadcastMode === "image" || broadcastMode === "document") && !broadcastMediaUrl.trim()) {
      showToast("Please attach a file or enter a media URL.", "error");
      return;
    }
    if (broadcastTarget === "custom" && !broadcastCustomPhone.trim()) {
      showToast("Please enter a destination phone number.", "error");
      return;
    }
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const res = await fetch("/admin/broadcast", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          target: broadcastTarget,
          custom_phone: broadcastTarget === "custom" ? broadcastCustomPhone.trim() : undefined,
          mode: broadcastMode,
          template_name: "hello_world",
          message: broadcastMessage.trim(),
          media_url: (broadcastMode === "image" || broadcastMode === "document") ? broadcastMediaUrl.trim() : undefined,
          media_id: (broadcastMode === "image" || broadcastMode === "document") && broadcastMediaId ? broadcastMediaId : undefined,
          media_type: broadcastMode === "image" ? "image" : broadcastMode === "document" ? "document" : undefined,
          filename: broadcastFilename.trim() || undefined,
        }),
      });
      if (handleAuthError(res)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setBroadcastResult(data);
      if (data.sent > 0) {
        showToast(`Delivered to ${data.sent} recipient(s)`, "success");
      }
      if (data.failed > 0) {
        showToast(`${data.failed} delivery failure(s)`, "error");
      }
      if (data.total_targets === 0) {
        showToast("No recipients matched the chosen audience.", "error");
      }
    } catch (e) {
      showToast(`Broadcast failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBroadcasting(false);
    }
  }

  function exportVendorsCsv() {
    if (!vendors.length) return;
    const headers = ["Phone", "Name", "Business Name", "Category", "State", "Language", "Entries", "Registered", "Last Active"];
    const rows = vendors.map((v) => [
      `"${v.phone.replace("whatsapp:", "")}"`,
      `"${v.name || ""}"`,
      `"${v.business_name || ""}"`,
      `"${v.business_category || ""}"`,
      `"${v.state}"`,
      `"${v.language}"`,
      v.entry_count ?? 0,
      `"${v.registered_at}"`,
      `"${v.last_active}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `VyapaarSaathi_Merchants_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Merchant directory exported to CSV", "success");
  }

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  const filteredVendors = vendors.filter((v) => {
    const q = search.toLowerCase();
    const matchSearch =
      (v.name || "").toLowerCase().includes(q) ||
      v.phone.toLowerCase().includes(q) ||
      (v.business_name || "").toLowerCase().includes(q);
    const matchState = selectedState === "all" || v.state === selectedState;
    const matchCat =
      selectedCategory === "all" ||
      (v.business_category && v.business_category.includes(selectedCategory));
    return matchSearch && matchState && matchCat;
  });

  const TABS = [
    { id: "overview",  label: "Overview",                   icon: TrendingUp },
    { id: "vendors",   label: `Merchants (${vendors.length})`, icon: Users },
    { id: "funnel",    label: "Funnel",                     icon: MessageSquare },
    { id: "broadcast", label: "Broadcast",                  icon: Send },
    { id: "system",    label: "System",                     icon: Server },
  ] as const;

  // ─── Inline Style Tokens ──────────────────────────────────────────────────
  const S = {
    root: {
      minHeight: "100vh",
      background: "#0B0D10",
      color: "#E6E8EB",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontFeatureSettings: "'cv02', 'cv03', 'cv04', 'cv11'",
      display: "flex",
    } as React.CSSProperties,
    sidebar: {
      width: 240,
      minWidth: 240,
      background: "#111418",
      borderRight: "1px solid #1F242B",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "sticky" as const,
      top: 0,
      zIndex: 40,
      flexShrink: 0,
    } as React.CSSProperties,
    mainWrapper: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      background: "#0B0D10",
    } as React.CSSProperties,
    topBar: {
      height: 52,
      background: "#111418",
      borderBottom: "1px solid #1F242B",
      padding: "0 28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky" as const,
      top: 0,
      zIndex: 30,
    } as React.CSSProperties,
    main: {
      flex: 1,
      padding: "24px 28px",
      width: "100%",
    } as React.CSSProperties,
    card: {
      background: "#111418",
      border: "1px solid #1F242B",
      borderRadius: 8,
      padding: 20,
    } as React.CSSProperties,
    cardNoPadding: {
      background: "#111418",
      border: "1px solid #1F242B",
      borderRadius: 8,
      overflow: "hidden",
    } as React.CSSProperties,
    input: {
      width: "100%",
      background: "#0B0D10",
      border: "1px solid #1F242B",
      borderRadius: 6,
      padding: "8px 12px",
      fontSize: 13,
      color: "#E6E8EB",
      outline: "none",
      boxSizing: "border-box" as const,
      fontFamily: "inherit",
    },
    select: {
      background: "#0B0D10",
      border: "1px solid #1F242B",
      borderRadius: 6,
      padding: "7px 12px",
      fontSize: 12,
      color: "#E6E8EB",
      outline: "none",
      fontFamily: "inherit",
      cursor: "pointer",
    } as React.CSSProperties,
    btnPrimary: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: "8px 16px",
      borderRadius: 6,
      border: "none",
      background: "#F97316",
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "opacity 0.15s",
    } as React.CSSProperties,
    btnSecondary: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: "7px 12px",
      borderRadius: 6,
      border: "1px solid #1F242B",
      background: "#111418",
      color: "#E6E8EB",
      fontSize: 12,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "border-color 0.15s, background 0.15s",
    } as React.CSSProperties,
    btnGhost: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      borderRadius: 6,
      border: "1px solid #1F242B",
      background: "transparent",
      color: "#8B93A0",
      fontSize: 12,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: "inherit",
    } as React.CSSProperties,
    th: {
      padding: "10px 16px",
      fontSize: 11,
      fontWeight: 600,
      textTransform: "uppercase" as const,
      letterSpacing: "0.05em",
      color: "#8B93A0",
      background: "#0B0D10",
      borderBottom: "1px solid #1F242B",
      whiteSpace: "nowrap" as const,
    },
    td: {
      padding: "10px 16px",
      fontSize: 13,
      color: "#E6E8EB",
      borderBottom: "1px solid #1F242B",
    },
    mono: {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontVariantNumeric: "tabular-nums" as const,
    },
    tabular: {
      fontVariantNumeric: "tabular-nums" as const,
    },
  };

  const tooltipStyle = {
    backgroundColor: "#111418",
    border: "1px solid #1F242B",
    borderRadius: 6,
    fontSize: 12,
    color: "#E6E8EB",
    padding: "8px 12px",
    boxShadow: "none",
  };

  return (
    <div style={S.root}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1F242B; border-radius: 3px; }
        input:focus, select:focus, textarea:focus { border-color: #F97316 !important; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .row-hover:hover { background: #161A20 !important; }
        .tab-btn:hover { color: #E6E8EB !important; }
        .btn-hover:hover { opacity: 0.88; }
        button:disabled { opacity: 0.45 !important; cursor: not-allowed !important; }
      `}</style>

      {/* ── LEFT SIDEBAR (Linear / Stripe Style) ─────────────────────────── */}
      <aside style={S.sidebar}>
        {/* Brand */}
        <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #1F242B" }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "#F97316",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 700, color: "#FFFFFF", fontSize: 13, letterSpacing: "-0.02em" }}>VS</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              VyapaarSaathi
            </span>
            <span style={{ fontSize: 11, color: "#8B93A0" }}>Internal Admin</span>
          </div>
        </div>

        {/* Navigation Items */}
        <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0", padding: "0 8px 8px" }}>
            Platform
          </div>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className="tab-btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 6,
                  background: active ? "rgba(249, 115, 22, 0.08)" : "transparent",
                  border: `1px solid ${active ? "rgba(249, 115, 22, 0.3)" : "transparent"}`,
                  color: active ? "#F97316" : "#8B93A0",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                <Icon size={15} style={{ color: active ? "#F97316" : "#8B93A0", flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{tab.label}</span>
                {tab.id === "vendors" && (
                  <span
                    style={{
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: active ? "rgba(249, 115, 22, 0.15)" : "#1F242B",
                      color: active ? "#F97316" : "#8B93A0",
                      fontWeight: 600,
                    }}
                  >
                    {vendors.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom Footer: Account, Refresh, Logout */}
        <div style={{ padding: "14px 14px", borderTop: "1px solid #1F242B", display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: "#0B0D10",
              border: "1px solid #1F242B",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#1F242B",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <UserIcon size={12} style={{ color: "#8B93A0" }} />
            </div>
            <div style={{ fontSize: 11, color: "#E6E8EB", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              admin@vyapaarsaathi.internal
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={loadAllData}
              style={{
                ...S.btnGhost,
                flex: 1,
                justifyContent: "center",
                padding: "7px 10px",
                fontSize: 12,
              }}
              title="Refresh all metrics"
            >
              <RefreshCw
                size={12}
                style={{ animation: (loading || statsLoading) ? "spin 1s linear infinite" : "none" }}
              />
              <span>Refresh</span>
            </button>

            <button
              onClick={handleLogout}
              style={{
                ...S.btnGhost,
                flex: 1,
                justifyContent: "center",
                padding: "7px 10px",
                borderColor: "rgba(239, 68, 68, 0.25)",
                color: "#F87171",
                fontSize: 12,
              }}
              title="Log out"
            >
              <LogOut size={12} />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT WRAPPER ──────────────────────────────────────── */}
      <div style={S.mainWrapper}>
        <header style={S.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#E6E8EB", letterSpacing: "-0.01em" }}>
              {TABS.find((t) => t.id === activeTab)?.label || "Dashboard"}
            </span>
            <span style={{ fontSize: 12, color: "#8B93A0" }}>•</span>
            <span style={{ fontSize: 12, color: "#8B93A0" }}>VyapaarSaathi Production</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#86efac", display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", padding: "3px 8px", borderRadius: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
              Live System
            </span>
          </div>
        </header>

        {/* ── MAIN VIEWPORT ──────────────────────────────────────────── */}
        <main style={S.main}>
        {/* Toast */}
        {toast && (
          <div
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 6,
              background: "#111418",
              border: `1px solid ${toast.type === "success" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
              color: toast.type === "success" ? "#86efac" : "#fca5a5",
              fontSize: 12,
              fontWeight: 500,
              maxWidth: 380,
            }}
          >
            {toast.type === "success" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 1: OVERVIEW
        ════════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* KPI Cards Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              <KpiCard
                label="Gross Revenue"
                value={formatCurrency(stats?.total_earned ?? 0)}
                delta={`Net Profit: ${formatCurrency(stats?.cashflow?.net_profit ?? 0)} (${stats?.cashflow?.margin_percent ?? 100}%)`}
                icon={DollarSign}
                loading={statsLoading}
              />
              <KpiCard
                label="Total Merchants"
                value={stats?.total_vendors ?? 0}
                delta={`${stats?.onboarded_vendors ?? 0} active · ${stats?.pending_vendors ?? 0} in funnel`}
                icon={Users}
                loading={statsLoading}
              />
              <KpiCard
                label="Onboarding Rate"
                value={
                  stats?.total_vendors
                    ? `${Math.round(((stats.onboarded_vendors ?? 0) / stats.total_vendors) * 100)}%`
                    : "0%"
                }
                delta="Completed WhatsApp flow"
                icon={Activity}
                loading={statsLoading}
              />
              <KpiCard
                label="Catalog Items"
                value={stats?.total_inventory ?? 0}
                delta="Active daily stock records"
                icon={Package}
                loading={statsLoading}
              />
            </div>

            {/* Charts Row: 7-Day Trend + Sector Distribution */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
              {/* Main Area Chart */}
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB" }}>
                      7-Day Performance Trend
                    </div>
                    <div style={{ fontSize: 12, color: "#8B93A0", marginTop: 2 }}>
                      {chartVendor === "all"
                        ? `Platform-wide activity across all ${vendors.length} merchants`
                        : `Merchant: ${stats?.selected_vendor?.business_name || stats?.selected_vendor?.name || chartVendor.replace("whatsapp:", "")}`}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Merchant selector */}
                    <select
                      value={chartVendor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setChartVendor(val);
                        fetchStats(val);
                      }}
                      style={{ ...S.select, maxWidth: 180 }}
                    >
                      <option value="all">All Merchants</option>
                      {vendors.map((v) => (
                        <option key={v.phone} value={v.phone}>
                          {v.business_name || v.name || v.phone.replace("whatsapp:", "")}
                        </option>
                      ))}
                    </select>

                    {/* Metric toggle */}
                    <div style={{ display: "flex", border: "1px solid #1F242B", borderRadius: 6, overflow: "hidden" }}>
                      <button
                        onClick={() => setChartMetric("currency")}
                        style={{
                          padding: "6px 10px",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 500,
                          background: chartMetric === "currency" ? "#F97316" : "#0B0D10",
                          color: chartMetric === "currency" ? "#FFFFFF" : "#8B93A0",
                          fontFamily: "inherit",
                        }}
                      >
                        Sales (₹)
                      </button>
                      <button
                        onClick={() => setChartMetric("activity")}
                        style={{
                          padding: "6px 10px",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 500,
                          background: chartMetric === "activity" ? "#F97316" : "#0B0D10",
                          color: chartMetric === "activity" ? "#FFFFFF" : "#8B93A0",
                          fontFamily: "inherit",
                        }}
                      >
                        Voice Activity (count)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Sub-strip summary numbers */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 20,
                    marginBottom: 16,
                    padding: "8px 12px",
                    background: "#0B0D10",
                    border: "1px solid #1F242B",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "#8B93A0" }}>
                    Total Sales:{" "}
                    <strong style={{ color: "#E6E8EB", ...S.tabular }}>
                      {formatCurrency(stats?.total_earned ?? 0)}
                    </strong>
                  </span>
                  {stats?.total_spent ? (
                    <span style={{ color: "#8B93A0" }}>
                      Total Expenses:{" "}
                      <strong style={{ color: "#E6E8EB", ...S.tabular }}>
                        {formatCurrency(stats.total_spent)}
                      </strong>
                    </span>
                  ) : null}
                  <span style={{ color: "#8B93A0" }}>
                    Voice Notes:{" "}
                    <strong style={{ color: "#E6E8EB", ...S.tabular }}>
                      {stats?.total_entries ?? 0}
                    </strong>
                  </span>
                </div>

                {/* Chart Canvas */}
                <div style={{ height: 220 }}>
                  {statsLoading ? (
                    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "10px 0" }}>
                      <Skeleton height={20} />
                      <Skeleton height={80} />
                      <Skeleton height={20} />
                    </div>
                  ) : stats?.daily_trends && stats.daily_trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.daily_trends} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        {/* Dashed subtle horizontal gridlines only */}
                        <CartesianGrid strokeDasharray="3 3" stroke="#1F242B" vertical={false} />
                        <XAxis
                          dataKey="label"
                          stroke="#1F242B"
                          tick={{ fill: "#8B93A0", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="#1F242B"
                          tick={{ fill: "#8B93A0", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          cursor={{ stroke: "#1F242B" }}
                          formatter={(value: any, name: any) => [
                            chartMetric === "currency" ? `₹${value}` : `${value} notes`,
                            name,
                          ]}
                        />
                        {chartMetric === "currency" ? (
                          <>
                            <Area
                              type="monotone"
                              dataKey="income"
                              name="Sales"
                              stroke="#F97316"
                              strokeWidth={2}
                              fill="#F97316"
                              fillOpacity={0.08}
                              dot={false}
                            />
                            <Area
                              type="monotone"
                              dataKey="expense"
                              name="Expenses"
                              stroke="#8B93A0"
                              strokeWidth={1.5}
                              fill="#8B93A0"
                              fillOpacity={0.05}
                              dot={false}
                            />
                          </>
                        ) : (
                          <Area
                            type="monotone"
                            dataKey="transactions"
                            name="Voice Notes"
                            stroke="#F97316"
                            strokeWidth={2}
                            fill="#F97316"
                            fillOpacity={0.08}
                            dot={false}
                          />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#8B93A0", fontSize: 12 }}>
                      No trend data available
                    </div>
                  )}
                </div>
              </div>

              {/* Sector Distribution: Clean Horizontal Bar List */}
              <div style={S.card}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB", marginBottom: 2 }}>
                  Sector Distribution
                </div>
                <div style={{ fontSize: 12, color: "#8B93A0", marginBottom: 16 }}>
                  Breakdown by registered merchant trade
                </div>

                {statsLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <Skeleton height={24} />
                    <Skeleton height={24} />
                    <Skeleton height={24} />
                    <Skeleton height={24} />
                  </div>
                ) : stats?.category_pie && stats.category_pie.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {stats.category_pie.map((cat, idx) => {
                      const categoryName = cat.name && cat.name.trim() ? cat.name : "Uncategorized";
                      return (
                        <div key={idx}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                            <span style={{ color: "#E6E8EB", fontWeight: 500 }}>
                              {categoryName}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "#8B93A0", ...S.tabular }}>
                                {cat.value} {cat.value === 1 ? "vendor" : "vendors"}
                              </span>
                              <span style={{ color: "#E6E8EB", fontWeight: 600, ...S.tabular }}>
                                {cat.percentage}%
                              </span>
                            </div>
                          </div>
                          {/* 4px bar track */}
                          <div style={{ height: 4, width: "100%", background: "#1F242B", borderRadius: 2, overflow: "hidden" }}>
                            <div
                              style={{
                                height: "100%",
                                width: `${cat.percentage}%`,
                                background: idx === 0 ? "#F97316" : "#8B93A0",
                                borderRadius: 2,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: "#8B93A0", fontSize: 12, paddingTop: 10 }}>
                    No vendor categories recorded yet.
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row: Rush Hours (24h) + Recent Transactions */}
            <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }}>
              {/* Sales Rush Hours Bar Chart */}
              <div style={S.card}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB", marginBottom: 2 }}>
                  Rush Hours (24h)
                </div>
                <div style={{ fontSize: 12, color: "#8B93A0", marginBottom: 16 }}>
                  Voice notes recorded by hour
                </div>

                <div style={{ height: 180 }}>
                  {statsLoading ? (
                    <Skeleton height="100%" />
                  ) : stats?.hourly_velocity ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={stats.hourly_velocity.filter((h) => h.hour >= 6 && h.hour <= 22)}
                        margin={{ top: 0, right: 0, left: -24, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#1F242B" vertical={false} />
                        <XAxis
                          dataKey="label"
                          stroke="#1F242B"
                          tick={{ fill: "#8B93A0", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="#1F242B"
                          tick={{ fill: "#8B93A0", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v} records`, "Activity"]} />
                        <Bar dataKey="transactions" fill="#1F242B" stroke="#8B93A0" strokeWidth={1} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#8B93A0", fontSize: 12 }}>
                      No hourly activity
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Transactions Stream */}
              <div style={S.cardNoPadding}>
                <div
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid #1F242B",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB" }}>
                      Recent Transactions
                    </div>
                    <div style={{ fontSize: 12, color: "#8B93A0", marginTop: 2 }}>
                      Latest voice notes recorded in live ledgers
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab("vendors")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#F97316",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontFamily: "inherit",
                    }}
                  >
                    View all <ArrowRight size={12} />
                  </button>
                </div>

                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {statsLoading ? (
                    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                      <Skeleton height={30} />
                      <Skeleton height={30} />
                      <Skeleton height={30} />
                    </div>
                  ) : stats?.recent_activity?.length ? (
                    stats.recent_activity.map((item, idx) => (
                      <div
                        key={idx}
                        className="row-hover"
                        style={{
                          padding: "10px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderBottom: "1px solid #1F242B",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "#E6E8EB" }}>
                            {item.vendor_label || item.phone.replace("whatsapp:", "")}
                          </div>
                          <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                            <span>
                              {item.quantity ? `${item.quantity} · ` : ""}
                              {item.category || item.description || "Voice record"}
                            </span>
                            <span>•</span>
                            <span>{formatTimeAgo(item.created_at)}</span>
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: item.type === "expense" ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.06)",
                            color: item.type === "expense" ? "#fca5a5" : "#86efac",
                            border: `1px solid ${item.type === "expense" ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)"}`,
                            ...S.tabular,
                          }}
                        >
                          {item.type === "expense" ? "−" : "+"}
                          {formatCurrency(item.amount ?? 0)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: 40, textAlign: "center", color: "#8B93A0", fontSize: 12 }}>
                      No voice transactions recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 2: MERCHANTS DIRECTORY
        ════════════════════════════════════════════════════════════════ */}
        {activeTab === "vendors" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Filter Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "1 1 240px", minWidth: 220 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#8B93A0" }} />
                <input
                  type="text"
                  placeholder="Search by vendor name, shop name, or phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...S.input, paddingLeft: 32 }}
                />
              </div>

              <select
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                style={S.select}
              >
                <option value="all">All States</option>
                <option value="active">Active</option>
                <option value="awaiting_name">Awaiting Name</option>
                <option value="awaiting_consent">Awaiting Consent</option>
                <option value="awaiting_category">Awaiting Category</option>
                <option value="awaiting_business_name">Awaiting Biz Name</option>
                <option value="declined">Declined</option>
              </select>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={S.select}
              >
                <option value="all">All Categories</option>
                <option value="Food & Chai">Food & Chai</option>
                <option value="Kirana">Kirana / Grocery</option>
                <option value="Kapda">Kapda / Textile</option>
                <option value="Sabzi">Sabzi / Fruits</option>
                <option value="Services">Services</option>
              </select>

              <button onClick={exportVendorsCsv} style={S.btnSecondary}>
                <Download size={13} />
                Export CSV
              </button>
            </div>

            {/* Dense Table */}
            <div style={S.cardNoPadding}>
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid #1F242B",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB" }}>
                    Registered Merchants
                  </div>
                  <div style={{ fontSize: 12, color: "#8B93A0", marginTop: 2 }}>
                    Showing {filteredVendors.length} of {vendors.length} total merchants
                  </div>
                </div>
              </div>

              {loading ? (
                <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 12 }}>
                  <Skeleton height={28} />
                  <Skeleton height={28} />
                  <Skeleton height={28} />
                </div>
              ) : error ? (
                <div style={{ padding: 40, textAlign: "center", color: "#fca5a5", fontSize: 13 }}>
                  {error}
                </div>
              ) : filteredVendors.length === 0 ? (
                <div style={{ padding: 60, textAlign: "center", color: "#8B93A0", fontSize: 13 }}>
                  No matching merchants found
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr>
                        <th style={S.th}>Merchant</th>
                        <th style={S.th}>WhatsApp</th>
                        <th style={S.th}>Status</th>
                        <th style={{ ...S.th, textAlign: "center" }}>Entries</th>
                        <th style={S.th}>Registered</th>
                        <th style={S.th}>Last Active</th>
                        <th style={{ ...S.th, textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVendors.map((v) => (
                        <tr key={v.phone} className="row-hover">
                          <td style={S.td}>
                            <div style={{ fontWeight: 500 }}>
                              {v.name || <span style={{ color: "#8B93A0" }}>No name provided</span>}
                            </div>
                            {v.business_name && (
                              <div style={{ fontSize: 12, color: "#8B93A0", marginTop: 1 }}>
                                {v.business_name}
                              </div>
                            )}
                            {v.business_category && (
                              <span style={{ fontSize: 11, color: "#8B93A0", marginTop: 2, display: "inline-block" }}>
                                {v.business_category}
                              </span>
                            )}
                          </td>
                          <td style={S.td}>
                            <a
                              href={`https://wa.me/${v.phone.replace(/[^0-9]/g, "")}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: "#8B93A0",
                                textDecoration: "none",
                                fontSize: 12,
                                ...S.mono,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <span>{v.phone.replace("whatsapp:", "")}</span>
                              <ExternalLink size={11} style={{ opacity: 0.6 }} />
                            </a>
                          </td>
                          <td style={S.td}>
                            <StateBadge state={v.state} />
                          </td>
                          <td style={{ ...S.td, textAlign: "center", ...S.tabular }}>
                            <span style={{ fontSize: 12, color: "#8B93A0" }}>{v.entry_count ?? 0}</span>
                          </td>
                          <td style={{ ...S.td, fontSize: 12, color: "#8B93A0" }}>
                            {formatDate(v.registered_at)}
                          </td>
                          <td style={{ ...S.td, fontSize: 12, color: "#8B93A0" }}>
                            {formatDate(v.last_active)}
                          </td>
                          <td style={{ ...S.td, textAlign: "right" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <button
                                onClick={() => openVendorDrawer(v.phone)}
                                style={S.btnSecondary}
                              >
                                Manage
                              </button>

                              <button
                                onClick={() => handleNudgeVendor(v.phone)}
                                disabled={nudgingPhone === v.phone}
                                title="Send WhatsApp nudge"
                                style={{
                                  ...S.btnSecondary,
                                  padding: "6px 8px",
                                }}
                              >
                                <Send size={13} style={{ animation: nudgingPhone === v.phone ? "spin 1s linear infinite" : "none" }} />
                              </button>

                              {confirmDeletePhone === v.phone ? (
                                <div style={{ display: "inline-flex", gap: 4 }}>
                                  <button
                                    onClick={() => handleDelete(v.phone)}
                                    disabled={deletingPhone === v.phone}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: 5,
                                      background: "#EF4444",
                                      border: "none",
                                      color: "#FFFFFF",
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      fontFamily: "inherit",
                                    }}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeletePhone(null)}
                                    style={{
                                      padding: "4px 6px",
                                      borderRadius: 5,
                                      background: "#0B0D10",
                                      border: "1px solid #1F242B",
                                      color: "#8B93A0",
                                      fontSize: 11,
                                      cursor: "pointer",
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeletePhone(v.phone)}
                                  title="Delete merchant"
                                  style={{
                                    padding: "6px 8px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(239,68,68,0.25)",
                                    background: "#0B0D10",
                                    color: "#F87171",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 3: FUNNEL
        ════════════════════════════════════════════════════════════════ */}
        {activeTab === "funnel" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Pipeline Stage Cards */}
            <div style={S.card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB", marginBottom: 2 }}>
                WhatsApp Onboarding State Funnel
              </div>
              <div style={{ fontSize: 12, color: "#8B93A0", marginBottom: 20 }}>
                Inspect conversion rates and merchant drop-offs during WhatsApp conversation
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                {[
                  { state: "new",                    label: "1. First Hi",    desc: "Initiated contact" },
                  { state: "awaiting_consent",        label: "2. Consent",     desc: "Opt-in buttons sent" },
                  { state: "awaiting_name",           label: "3. Name",        desc: "Prompted for name" },
                  { state: "awaiting_category",       label: "4. Category",    desc: "List menu sent" },
                  { state: "awaiting_business_name",  label: "5. Biz Name",    desc: "Shop name step" },
                  { state: "active",                  label: "6. Active",      desc: "Ready for ledger" },
                ].map((step, idx) => {
                  const count = vendors.filter((v) => v.state === step.state).length;
                  const isEnd = step.state === "active";
                  return (
                    <div
                      key={step.state}
                      style={{
                        padding: 16,
                        borderRadius: 8,
                        background: isEnd ? "rgba(34,197,94,0.04)" : "#0B0D10",
                        border: `1px solid ${isEnd ? "rgba(34,197,94,0.2)" : "#1F242B"}`,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0" }}>
                        Step {idx + 1}
                      </span>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#E6E8EB", marginTop: 4 }}>
                        {step.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2 }}>
                        {step.desc}
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 600, color: "#E6E8EB", marginTop: 12, ...S.tabular }}>
                        {count}
                      </div>
                      <div style={{ fontSize: 11, color: "#8B93A0" }}>merchants</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pending Merchants Action List */}
            <div style={S.cardNoPadding}>
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid #1F242B",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB" }}>
                    Pending Funnel Merchants
                  </div>
                  <div style={{ fontSize: 12, color: "#8B93A0", marginTop: 2 }}>
                    Merchants who contacted the bot but haven't finished onboarding
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.2)",
                    color: "#fcd34d",
                    fontWeight: 600,
                  }}
                >
                  {vendors.filter((v) => v.state !== "active").length} Pending
                </span>
              </div>

              <div>
                {vendors.filter((v) => v.state !== "active").length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#8B93A0", fontSize: 13 }}>
                    All merchants have completed onboarding! No pending funnel drop-offs.
                  </div>
                ) : (
                  vendors
                    .filter((v) => v.state !== "active")
                    .map((v) => (
                      <div
                        key={v.phone}
                        className="row-hover"
                        style={{
                          padding: "14px 20px",
                          borderBottom: "1px solid #1F242B",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, ...S.mono }}>
                              {v.phone.replace("whatsapp:", "")}
                            </span>
                            <StateBadge state={v.state} />
                            {v.name && (
                              <span style={{ fontSize: 12, color: "#8B93A0" }}>({v.name})</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 4 }}>
                            Last active: {formatDate(v.last_active)} · Registered: {formatDate(v.registered_at)}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <button
                            onClick={() => handleQuickActivateVendor(v.phone)}
                            disabled={activatingPhone === v.phone}
                            style={{
                              ...S.btnSecondary,
                              borderColor: "rgba(34,197,94,0.3)",
                              color: "#86efac",
                            }}
                          >
                            <Zap size={12} />
                            {activatingPhone === v.phone ? "Activating…" : "Approve & Activate"}
                          </button>

                          <button
                            onClick={() => handleNudgeVendor(v.phone)}
                            disabled={nudgingPhone === v.phone}
                            style={S.btnSecondary}
                          >
                            <MessageSquare size={12} />
                            {nudgingPhone === v.phone ? "Sending…" : "WhatsApp Nudge"}
                          </button>

                          <button
                            onClick={() => openVendorDrawer(v.phone, "settings")}
                            style={S.btnSecondary}
                          >
                            <Settings size={12} />
                            Manual Override
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 4: BROADCAST HUB
        ════════════════════════════════════════════════════════════════ */}
        {activeTab === "broadcast" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 20, alignItems: "start" }}>
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    border: "1px solid #1F242B",
                    background: "#0B0D10",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Send size={16} style={{ color: "#F97316" }} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#E6E8EB" }}>
                    WhatsApp Broadcast Hub
                  </div>
                  <div style={{ fontSize: 12, color: "#8B93A0" }}>
                    Send platform updates, feature alerts, or test delivery directly to merchants
                  </div>
                </div>
              </div>

              {/* Delivery Mode Toggle */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0", display: "block", marginBottom: 6 }}>
                  Content Format
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  {[
                    { id: "text",     label: "Text Only",       desc: "Free-form message",   icon: MessageSquare },
                    { id: "image",    label: "Photo / Image",   desc: "PNG, JPG with caption",icon: ImageIcon },
                    { id: "document", label: "PDF Document",    desc: "PDF file with caption",icon: FileText },
                    { id: "template", label: "Meta Template",   desc: "hello_world (24h bypass)", icon: CheckCircle2 },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = broadcastMode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setBroadcastMode(tab.id as any)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 6,
                          border: `1px solid ${active ? "#F97316" : "#1F242B"}`,
                          background: active ? "rgba(249,115,22,0.06)" : "#0B0D10",
                          color: active ? "#F97316" : "#8B93A0",
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "inherit",
                          transition: "border-color 0.15s, background 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: active ? "#E6E8EB" : "#8B93A0" }}>
                          <Icon size={13} style={{ color: active ? "#F97316" : "#8B93A0" }} />
                          {tab.label}
                        </div>
                        <div style={{ fontSize: 10, marginTop: 3, color: "#8B93A0" }}>
                          {tab.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <form onSubmit={handleBroadcastSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0", display: "block", marginBottom: 6 }}>
                    Target Audience
                  </label>
                  <select
                    value={broadcastTarget}
                    onChange={(e) => setBroadcastTarget(e.target.value)}
                    style={{ ...S.select, width: "100%" }}
                  >
                    <optgroup label="Audience Groups">
                      <option value="all">All Registered Merchants ({vendors.length})</option>
                      <option value="active">
                        Active Merchants Only ({vendors.filter((v) => v.state === "active").length})
                      </option>
                      <option value="pending">
                        Pending Onboarding Only ({vendors.filter((v) => v.state !== "active").length})
                      </option>
                    </optgroup>
                    <optgroup label="By Category">
                      {Array.from(new Set(vendors.map((v) => v.business_category).filter(Boolean))).map((cat) => (
                        <option key={cat!} value={cat!}>
                          {cat} ({vendors.filter((v) => v.business_category === cat).length})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Individual Merchant">
                      {vendors.map((v) => (
                        <option key={v.phone} value={v.phone}>
                          {v.name || "Merchant"} ({v.phone.replace("whatsapp:", "")})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Direct Test">
                      <option value="custom">Custom Phone Number</option>
                    </optgroup>
                  </select>
                </div>

                {broadcastTarget === "custom" && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#F97316", display: "block", marginBottom: 6 }}>
                      Phone Number (with Country Code)
                    </label>
                    <input
                      type="text"
                      value={broadcastCustomPhone}
                      onChange={(e) => setBroadcastCustomPhone(e.target.value)}
                      placeholder="+919892727629"
                      style={{ ...S.input, ...S.mono }}
                    />
                  </div>
                )}

                {/* Media Attachment section for Photo or PDF */}
                {(broadcastMode === "image" || broadcastMode === "document") && (
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 6,
                      background: "#0B0D10",
                      border: "1px solid #1F242B",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0" }}>
                        {broadcastMode === "image" ? "Attach Photo (PNG / JPG / WEBP)" : "Attach PDF Document"}
                      </span>
                      {uploadingMedia && (
                        <span style={{ fontSize: 11, color: "#F97316", display: "flex", alignItems: "center", gap: 4 }}>
                          <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Uploading…
                        </span>
                      )}
                    </div>

                    {/* Case 1: File is already attached */}
                    {broadcastMediaUrl ? (
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 6,
                          background: "#111418",
                          border: "1px solid #1F242B",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          {broadcastMode === "image" ? (
                            <img
                              src={broadcastMediaUrl}
                              alt="Attachment preview"
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 5,
                                objectFit: "cover",
                                border: "1px solid #1F242B",
                                background: "#0B0D10",
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 5,
                                background: "rgba(249,115,22,0.1)",
                                border: "1px solid rgba(249,115,22,0.3)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#F97316",
                                flexShrink: 0,
                              }}
                            >
                              <FileText size={20} />
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#E6E8EB", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                              {broadcastFilename || (broadcastMode === "image" ? "Photo Attachment" : "Document Attachment")}
                            </div>
                            <div style={{ fontSize: 11, color: "#86efac", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                              <CheckCircle2 size={12} />
                              <span>Attached and ready to broadcast</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setBroadcastMediaUrl("");
                            setBroadcastFilename("");
                            setBroadcastMediaId("");
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid rgba(239,68,68,0.25)",
                            background: "transparent",
                            color: "#fca5a5",
                            fontSize: 11,
                            fontWeight: 500,
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          <X size={12} />
                          Remove
                        </button>
                      </div>
                    ) : (
                      /* Case 2: No file attached yet - provide Upload or Link option */
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => setMediaSource("file")}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 4,
                              border: `1px solid ${mediaSource === "file" ? "#F97316" : "#1F242B"}`,
                              background: mediaSource === "file" ? "rgba(249,115,22,0.1)" : "transparent",
                              color: mediaSource === "file" ? "#F97316" : "#8B93A0",
                              fontSize: 11,
                              fontWeight: 500,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            <Upload size={12} />
                            Upload from Computer
                          </button>
                          <button
                            type="button"
                            onClick={() => setMediaSource("url")}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 4,
                              border: `1px solid ${mediaSource === "url" ? "#F97316" : "#1F242B"}`,
                              background: mediaSource === "url" ? "rgba(249,115,22,0.1)" : "transparent",
                              color: mediaSource === "url" ? "#F97316" : "#8B93A0",
                              fontSize: 11,
                              fontWeight: 500,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            <Paperclip size={12} />
                            Paste Web Link
                          </button>
                        </div>

                        {mediaSource === "file" ? (
                          <div>
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                padding: "14px 18px",
                                borderRadius: 6,
                                border: "1px dashed #2E3846",
                                background: "#111418",
                                color: "#E6E8EB",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: uploadingMedia ? "wait" : "pointer",
                              }}
                            >
                              <Upload size={14} style={{ color: "#F97316" }} />
                              <span>
                                {uploadingMedia
                                  ? "Uploading file to server…"
                                  : `Choose ${broadcastMode === "image" ? "Photo (PNG, JPG, WEBP)" : "PDF Document"} from Computer`}
                              </span>
                              <input
                                type="file"
                                disabled={uploadingMedia}
                                accept={broadcastMode === "image" ? "image/png,image/jpeg,image/webp,image/jpg" : "application/pdf,.pdf"}
                                onChange={handleMediaUpload}
                                style={{ display: "none" }}
                              />
                            </label>
                          </div>
                        ) : (
                          <div>
                            <input
                              type="text"
                              value={broadcastMediaUrl}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBroadcastMediaUrl(val);
                                if (!broadcastFilename && val) {
                                  try {
                                    const path = new URL(val).pathname;
                                    setBroadcastFilename(path.split("/").pop() || "");
                                  } catch {
                                    // Ignore
                                  }
                                }
                              }}
                              placeholder={broadcastMode === "image" ? "https://example.com/poster.jpg" : "https://example.com/catalog.pdf"}
                              style={{ ...S.input, ...S.mono, fontSize: 12 }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {broadcastMode === "document" && (
                      <div>
                        <label style={{ fontSize: 11, color: "#8B93A0", display: "block", marginBottom: 4 }}>
                          Document Filename shown on WhatsApp:
                        </label>
                        <input
                          type="text"
                          value={broadcastFilename}
                          onChange={(e) => setBroadcastFilename(e.target.value)}
                          placeholder="VyapaarSaathi_Catalogue.pdf"
                          style={{ ...S.input, fontSize: 12 }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Message Body or Caption */}
                {broadcastMode !== "template" ? (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0", display: "block", marginBottom: 6 }}>
                      {broadcastMode === "image" || broadcastMode === "document" ? "Caption / Accompanying Text" : "Message Body"}
                    </label>
                    <textarea
                      rows={broadcastMode === "text" ? 5 : 3}
                      value={broadcastMessage}
                      onChange={(e) => setBroadcastMessage(e.target.value)}
                      placeholder={
                        broadcastMode === "image"
                          ? "Check out our newest products! Voice recording is now available..."
                          : broadcastMode === "document"
                          ? "Please find attached our latest vendor catalogue and price list..."
                          : "Namaste! VyapaarSaathi update: voice ledger features are live…"
                      }
                      style={{ ...S.input, resize: "vertical", lineHeight: 1.5 }}
                    />
                  </div>
                ) : (
                  <div style={{ padding: 12, borderRadius: 6, background: "#0B0D10", border: "1px solid #1F242B" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#86efac", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      <CheckCircle2 size={14} />
                      hello_world template
                    </div>
                    <div style={{ fontSize: 12, color: "#E6E8EB" }}>
                      "Hello World! Welcome and congratulations on your new WhatsApp connection."
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
                  <span style={{ fontSize: 12, color: "#8B93A0" }}>
                    Targeting:{" "}
                    <strong style={{ color: "#E6E8EB" }}>
                      {broadcastTarget === "custom"
                        ? broadcastCustomPhone || "custom number"
                        : broadcastTarget === "all"
                        ? `${vendors.length} merchants`
                        : broadcastTarget === "active"
                        ? `${vendors.filter((v) => v.state === "active").length} active`
                        : broadcastTarget === "pending"
                        ? `${vendors.filter((v) => v.state !== "active").length} pending`
                        : broadcastTarget.replace("whatsapp:", "")}
                    </strong>
                  </span>

                  <button
                    type="submit"
                    disabled={
                      broadcasting ||
                      uploadingMedia ||
                      (broadcastMode === "text" && !broadcastMessage.trim()) ||
                      ((broadcastMode === "image" || broadcastMode === "document") && !broadcastMediaUrl.trim())
                    }
                    style={S.btnPrimary}
                    className="btn-hover"
                  >
                    <Send size={13} style={{ animation: broadcasting ? "spin 1s linear infinite" : "none" }} />
                    {broadcasting ? "Sending Broadcast…" : uploadingMedia ? "Uploading Media…" : "Send Broadcast"}
                  </button>
                </div>
              </form>

              {/* Delivery Report */}
              {broadcastResult && (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #1F242B" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#E6E8EB" }}>
                      Delivery Report
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34,197,94,0.08)", color: "#86efac", border: "1px solid rgba(34,197,94,0.2)" }}>
                        {broadcastResult.sent} Sent
                      </span>
                      {broadcastResult.failed > 0 && (
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.08)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}>
                          {broadcastResult.failed} Failed
                        </span>
                      )}
                    </div>
                  </div>

                  {broadcastResult.sent_recipients?.length > 0 && (
                    <div style={{ marginBottom: 10, padding: 10, borderRadius: 6, background: "#0B0D10", border: "1px solid #1F242B" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#86efac", marginBottom: 6 }}>
                        Delivered to {broadcastResult.sent_recipients.length} Recipient(s):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {broadcastResult.sent_recipients.map((r, i) => (
                          <span key={i} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#111418", border: "1px solid #1F242B", color: "#8B93A0", ...S.mono }}>
                            {r.phone.replace("whatsapp:", "")} ({r.name})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {broadcastResult.failed_recipients?.length > 0 && (
                    <div style={{ padding: 10, borderRadius: 6, background: "#0B0D10", border: "1px solid #1F242B" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#fca5a5", marginBottom: 6 }}>
                        Failures ({broadcastResult.failed_recipients.length}):
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {broadcastResult.failed_recipients.map((r, i) => (
                          <div key={i} style={{ padding: 8, borderRadius: 4, background: "#111418", border: "1px solid #1F242B" }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "#E6E8EB", ...S.mono }}>
                              {r.phone.replace("whatsapp:", "")} ({r.name})
                            </div>
                            <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2 }}>{r.error}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Broadcast Operations & Target Scope Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={S.card}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E6E8EB", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <Send size={14} style={{ color: "#F97316" }} />
                  Audience Scope & Delivery Target
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12, color: "#8B93A0" }}>
                  <div style={{ padding: 12, borderRadius: 6, background: "#0B0D10", border: "1px solid #1F242B" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#E6E8EB", marginBottom: 6 }}>
                      Registered Merchant Breakdown
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12 }}>
                      <span>Total Registered Vendors:</span>
                      <span style={{ fontWeight: 600, color: "#E6E8EB", ...S.mono }}>{vendors.length}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12 }}>
                      <span>Active Merchants:</span>
                      <span style={{ fontWeight: 600, color: "#86efac", ...S.mono }}>{vendors.filter(v => v.state === "active").length}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12 }}>
                      <span>Pending Onboarding:</span>
                      <span style={{ fontWeight: 600, color: "#fcd34d", ...S.mono }}>{vendors.filter(v => v.state !== "active").length}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, lineHeight: 1.5 }}>
                    <div>• <b>Direct Media Dispatch:</b> Photos and PDFs are uploaded straight to Meta WhatsApp servers via Cloud API.</div>
                    <div>• <b>24-Hour Customer Window:</b> Custom text, photo, and PDF messages deliver to merchants active in the last 24h.</div>
                    <div>• <b>Meta Template:</b> Use the pre-approved Meta Template (hello_world) to re-engage merchants outside the 24h window.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            TAB 5: SYSTEM HEALTH
        ════════════════════════════════════════════════════════════════ */}
        {activeTab === "system" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 20 }}>
            <div style={S.card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB", marginBottom: 2 }}>
                Infrastructure & Integrations
              </div>
              <div style={{ fontSize: 12, color: "#8B93A0", marginBottom: 16 }}>
                Runtime connectivity across external services
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { name: "FastAPI Backend", desc: "Port 8000 · Uvicorn ASGI · JWT Middleware", status: "Online" },
                  { name: "MongoDB Database", desc: "vendors, ledger, inventory scoping", status: "Connected" },
                  { name: "Meta WhatsApp Cloud API", desc: "Interactive buttons & voice webhook active", status: "Active" },
                  { name: "Groq Whisper & AI Pipeline", desc: "Speech-to-text & JSON intent categorization", status: "Ready" },
                ].map((s) => (
                  <div
                    key={s.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      borderRadius: 6,
                      border: "1px solid #1F242B",
                      background: "#0B0D10",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#E6E8EB" }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2 }}>{s.desc}</div>
                    </div>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "rgba(34,197,94,0.06)",
                        border: "1px solid rgba(34,197,94,0.2)",
                        color: "#86efac",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E6E8EB", marginBottom: 2 }}>
                Platform Metrics & Environment
              </div>
              <div style={{ fontSize: 12, color: "#8B93A0", marginBottom: 16 }}>
                Platform configuration and operational health
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Environment Mode", value: "Production Sandbox (Meta Cloud API)" },
                  { label: "Token Status", value: "Active & Verified" },
                  { label: "Total Registered Merchants", value: `${vendors.length} vendors in DB` },
                  { label: "Active Ledgers", value: `${stats?.total_entries ?? 0} total entries recorded` },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      borderRadius: 6,
                      border: "1px solid #1F242B",
                      background: "#0B0D10",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#8B93A0" }}>{item.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#E6E8EB" }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>

      {/* ── DETAIL DRAWER (1px Left Border, Flat Surface #111418) ──────── */}
      {selectedVendorPhone && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(11, 13, 16, 0.75)",
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedVendorPhone(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#111418",
              borderLeft: "1px solid #1F242B",
              height: "100%",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #1F242B",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#0B0D10",
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#E6E8EB" }}>
                  {vendorDetails?.vendor.name || "Merchant Profile"}
                </div>
                <div style={{ fontSize: 12, color: "#8B93A0", marginTop: 2, ...S.mono }}>
                  {selectedVendorPhone.replace("whatsapp:", "")}
                </div>
              </div>
              <button
                onClick={() => setSelectedVendorPhone(null)}
                style={{
                  padding: 6,
                  borderRadius: 6,
                  border: "1px solid #1F242B",
                  background: "#111418",
                  color: "#8B93A0",
                  cursor: "pointer",
                  display: "flex",
                }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Drawer Subtabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #1F242B", padding: "0 20px" }}>
              {[
                { id: "ledger",    label: `Ledger (${vendorDetails?.ledger.length ?? 0})`,    icon: Receipt },
                { id: "inventory", label: `Stock (${vendorDetails?.inventory.length ?? 0})`, icon: Package },
                { id: "settings",  label: "Edit & Controls",                                   icon: Edit3 },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = drawerTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setDrawerTab(tab.id as any)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "10px 0",
                      marginRight: 16,
                      background: "none",
                      border: "none",
                      borderBottom: active ? "2px solid #F97316" : "2px solid transparent",
                      color: active ? "#F97316" : "#8B93A0",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                      marginBottom: -1,
                    }}
                  >
                    <Icon size={13} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {drawerLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Skeleton height={32} />
                  <Skeleton height={32} />
                  <Skeleton height={32} />
                </div>
              ) : (
                <>
                  {/* Ledger Tab */}
                  {drawerTab === "ledger" && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0", marginBottom: 12 }}>
                        Voice Transactions
                      </div>
                      <div style={{ border: "1px solid #1F242B", borderRadius: 8, overflow: "hidden" }}>
                        {vendorDetails?.ledger.length ? (
                          vendorDetails.ledger.map((item, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: "10px 14px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderBottom: "1px solid #1F242B",
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 500, color: "#E6E8EB" }}>
                                  {item.description || item.category || "Transaction"}
                                </div>
                                <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2 }}>
                                  {item.quantity ? `${item.quantity} qty · ` : ""}
                                  {formatDate(item.created_at)}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  background: item.type === "expense" ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.06)",
                                  color: item.type === "expense" ? "#fca5a5" : "#86efac",
                                  border: `1px solid ${item.type === "expense" ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)"}`,
                                  ...S.tabular,
                                }}
                              >
                                {item.type === "expense" ? "−" : "+"}
                                {formatCurrency(item.amount ?? 0)}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: 30, textAlign: "center", color: "#8B93A0", fontSize: 12 }}>
                            No transactions recorded for this merchant.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Inventory Tab */}
                  {drawerTab === "inventory" && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0", marginBottom: 12 }}>
                        Daily Product Stock
                      </div>
                      <div style={{ border: "1px solid #1F242B", borderRadius: 8, overflow: "hidden" }}>
                        {vendorDetails?.inventory.length ? (
                          vendorDetails.inventory.map((item, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: "10px 14px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderBottom: "1px solid #1F242B",
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 500, color: "#E6E8EB" }}>
                                  {item.item_name} {item.item_name_hi ? `(${item.item_name_hi})` : ""}
                                </div>
                                <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2 }}>
                                  {formatCurrency(item.price_per_unit ?? 0)} / {item.unit || "unit"}
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#E6E8EB", ...S.tabular }}>
                                  Stock: {item.current_stock ?? item.daily_stock ?? 0}
                                </div>
                                <div style={{ fontSize: 10, color: "#8B93A0" }}>
                                  {item.stock_date || "Today"}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: 30, textAlign: "center", color: "#8B93A0", fontSize: 12 }}>
                            No inventory items logged.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Settings Tab */}
                  {drawerTab === "settings" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {/* Bypass Banner */}
                      {vendorDetails?.vendor.state !== "active" && (
                        <div
                          style={{
                            padding: 14,
                            borderRadius: 6,
                            background: "rgba(245,158,11,0.06)",
                            border: "1px solid rgba(245,158,11,0.2)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#fcd34d", fontSize: 12, fontWeight: 600 }}>
                              <AlertTriangle size={14} />
                              Pending Funnel Status
                            </div>
                            <StateBadge state={vendorDetails?.vendor.state || "new"} />
                          </div>
                          <p style={{ fontSize: 11, color: "#8B93A0", marginBottom: 10, lineHeight: 1.5 }}>
                            This merchant is stuck in conversational onboarding. Click below to fast-track activation.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickActivateVendor(
                                selectedVendorPhone!,
                                editForm.name,
                                editForm.business_name,
                                editForm.business_category
                              )
                            }
                            disabled={activatingPhone === selectedVendorPhone}
                            style={{
                              ...S.btnSecondary,
                              width: "100%",
                              borderColor: "rgba(34,197,94,0.3)",
                              color: "#86efac",
                            }}
                          >
                            <Zap size={13} />
                            {activatingPhone === selectedVendorPhone ? "Activating…" : "Fast-Track Approve & Activate"}
                          </button>
                        </div>
                      )}

                      {/* Edit Profile Form */}
                      <div
                        style={{
                          padding: 16,
                          borderRadius: 6,
                          border: "1px solid #1F242B",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8B93A0" }}>
                          Edit Profile Details
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11, color: "#8B93A0", display: "block", marginBottom: 4 }}>
                              Owner Name
                            </label>
                            <input
                              type="text"
                              value={editForm.name}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              style={S.input}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: "#8B93A0", display: "block", marginBottom: 4 }}>
                              Shop Name
                            </label>
                            <input
                              type="text"
                              value={editForm.business_name}
                              onChange={(e) => setEditForm({ ...editForm, business_name: e.target.value })}
                              style={S.input}
                            />
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: 11, color: "#8B93A0", display: "block", marginBottom: 4 }}>
                            Business Category
                          </label>
                          <input
                            type="text"
                            value={editForm.business_category}
                            onChange={(e) => setEditForm({ ...editForm, business_category: e.target.value })}
                            style={S.input}
                          />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11, color: "#8B93A0", display: "block", marginBottom: 4 }}>
                              Bot State
                            </label>
                            <select
                              value={editForm.state}
                              onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                              style={{ ...S.select, width: "100%" }}
                            >
                              <option value="active">Active (Onboarded)</option>
                              <option value="awaiting_consent">Awaiting Consent</option>
                              <option value="awaiting_name">Awaiting Name</option>
                              <option value="awaiting_category">Awaiting Category</option>
                              <option value="awaiting_business_name">Awaiting Biz Name</option>
                              <option value="new">New Lead</option>
                              <option value="declined">Declined</option>
                            </select>
                          </div>

                          <div>
                            <label style={{ fontSize: 11, color: "#8B93A0", display: "block", marginBottom: 4 }}>
                              Account Status
                            </label>
                            <select
                              value={editForm.active ? "true" : "false"}
                              onChange={(e) => setEditForm({ ...editForm, active: e.target.value === "true" })}
                              style={{ ...S.select, width: "100%" }}
                            >
                              <option value="true">Active (Enabled)</option>
                              <option value="false">Suspended</option>
                            </select>
                          </div>
                        </div>

                        <button
                          onClick={handleSaveVendorEdit}
                          disabled={savingEdit}
                          style={S.btnPrimary}
                          className="btn-hover"
                        >
                          <Save size={13} />
                          {savingEdit ? "Saving…" : "Save Changes"}
                        </button>
                      </div>

                      {/* Direct Nudge */}
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 6,
                          border: "1px solid #1F242B",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "#E6E8EB" }}>
                            Send WhatsApp Nudge
                          </div>
                          <div style={{ fontSize: 11, color: "#8B93A0", marginTop: 2 }}>
                            Direct re-engagement message to vendor
                          </div>
                        </div>
                        <button
                          onClick={() => handleNudgeVendor(selectedVendorPhone)}
                          disabled={nudgingPhone === selectedVendorPhone}
                          style={S.btnSecondary}
                        >
                          <Send size={12} />
                          {nudgingPhone === selectedVendorPhone ? "Sending…" : "Send Nudge"}
                        </button>
                      </div>

                      {/* Danger Zone */}
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 6,
                          border: "1px solid rgba(239, 68, 68, 0.25)",
                          background: "rgba(239, 68, 68, 0.04)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#fca5a5", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                          <ShieldAlert size={14} />
                          Permanent Deletion
                        </div>
                        <p style={{ fontSize: 11, color: "#8B93A0", marginBottom: 10 }}>
                          Permanently delete merchant account, audio ledger, and product catalogs.
                        </p>
                        <button
                          onClick={() => handleDelete(selectedVendorPhone)}
                          disabled={!!deletingPhone}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 6,
                            background: "#EF4444",
                            border: "none",
                            color: "#FFFFFF",
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Trash2 size={13} />
                          Delete Merchant Permanently
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
