import { useEffect, useState } from "react";
import { useStore, InventoryItem } from "../store/useStore";
import { Package, Plus, RefreshCw, Edit3, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";

const UNITS = ["piece", "cup", "kg", "litre", "dozen", "packet", "bundle"];

export default function Inventory() {
  const { inventory, loadInventory, addInventoryItem, removeInventoryItem, language } = useStore();
  const isHindi = language === "hi";

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState({
    item_name: "",
    item_name_hi: "",
    daily_stock: 50,
    unit: "piece",
    price_per_unit: 0,
  });

  // Only show items the vendor manually created (source = "catalog")
  const catalogItems = (inventory as (InventoryItem & { source?: string })[]).filter(
    i => !i.source || i.source === "catalog"
  );

  useEffect(() => {
    loadInventory();
    const id = setInterval(loadInventory, 30000);
    return () => clearInterval(id);
  }, []);

  const openNew = () => {
    setEditItem(null);
    setForm({ item_name: "", item_name_hi: "", daily_stock: 50, unit: "piece", price_per_unit: 0 });
    setShowForm(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setForm({
      item_name: item.item_name,
      item_name_hi: item.item_name_hi || "",
      daily_stock: item.daily_stock,
      unit: item.unit,
      price_per_unit: item.price_per_unit || 0,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.item_name.trim() || form.daily_stock <= 0) return;
    setSaving(true);
    try {
      await addInventoryItem({
        item_name: form.item_name.trim().toLowerCase(),
        item_name_hi: form.item_name_hi.trim() || form.item_name.trim(),
        unit: form.unit,
        daily_stock: form.daily_stock,
        current_stock: editItem ? editItem.current_stock : form.daily_stock,
        price_per_unit: form.price_per_unit,
        is_active: true,
      });
      setShowForm(false);
      setEditItem(null);
    } finally {
      setSaving(false);
    }
  };

  const stockPct = (item: InventoryItem) =>
    item.daily_stock > 0 ? Math.min(100, Math.round((item.current_stock / item.daily_stock) * 100)) : 0;

  return (
    <div className="flex flex-col gap-6 flex-1">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-orange-50 text-orange-600">
              <Package className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              {isHindi ? "दुकान का स्टॉक व इन्वेंट्री" : "Shop Inventory & Stock"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {isHindi
              ? "आइटम जोड़ें और आवाज़ से स्टॉक / रेट बदलें"
              : "Add items below. Use voice to update stock count or price anytime."}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadInventory}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 shadow-xs transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>{isHindi ? "ताज़ा करें" : "Refresh"}</span>
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 px-5 py-2.5 text-xs font-black text-white shadow-md shadow-orange-500/25 transition"
          >
            <Plus className="w-4 h-4" />
            <span>{isHindi ? "नया आइटम जोड़ें" : "Add Item"}</span>
          </button>
        </div>
      </div>

      {/* ── Add / Edit Form Modal/Card ───────────────────────────────────────── */}
      {showForm && (
        <div className="rounded-3xl border-2 border-orange-200 bg-white p-6 sm:p-8 shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="text-base font-black text-slate-900 mb-5 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
            {editItem
              ? (isHindi ? `"${editItem.item_name}" संशोधित करें` : `Edit "${editItem.item_name}"`)
              : (isHindi ? "नया सामान / उत्पाद जोड़ें" : "Add New Product")}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-slate-700">{isHindi ? "आइटम नाम (English)" : "Item Name (English)"}</span>
              <input
                disabled={!!editItem}
                type="text"
                placeholder="chai, samosa, bread..."
                value={form.item_name}
                onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-orange-500 focus:bg-white disabled:bg-slate-100 transition"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-slate-700">{isHindi ? "हिंदी नाम" : "Hindi Name"}</span>
              <input
                type="text"
                placeholder="चाय, समोसा, ब्रेड..."
                value={form.item_name_hi}
                onChange={e => setForm(f => ({ ...f, item_name_hi: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-slate-700">{isHindi ? "इकाई (Unit)" : "Unit"}</span>
              <select
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition"
              >
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-slate-700">{isHindi ? "दैनिक शुरुआती स्टॉक" : "Daily Stock Target"}</span>
              <input
                type="number" min={1}
                value={form.daily_stock}
                onChange={e => setForm(f => ({ ...f, daily_stock: parseInt(e.target.value) || 0 }))}
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-slate-700">{isHindi ? "बिक्री मूल्य प्रति यूनिट (₹)" : "Selling Price (₹)"}</span>
              <input
                type="number" min={0} step={0.5}
                value={form.price_per_unit}
                onChange={e => setForm(f => ({ ...f, price_per_unit: parseFloat(e.target.value) || 0 }))}
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-orange-500 focus:bg-white transition"
              />
            </label>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={handleSave}
              disabled={saving || !form.item_name.trim() || form.daily_stock <= 0}
              className="rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 px-7 py-2.5 text-xs font-black text-white shadow-md shadow-orange-500/20 transition disabled:opacity-50"
            >
              {saving ? (isHindi ? "सेव हो रहा है..." : "Saving...") : (isHindi ? "सेव करें" : "Save Item")}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditItem(null); }}
              className="rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-6 py-2.5 text-xs font-bold text-slate-600 transition"
            >
              {isHindi ? "रद्द करें" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      {/* ── Empty State ─────────────────────────────────────────────────────── */}
      {catalogItems.length === 0 && !showForm && (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-14 shadow-xs text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center mb-3">
            <Package className="w-8 h-8" />
          </div>
          <p className="font-black text-slate-900 text-lg">
            {isHindi ? "अभी तक कोई आइटम नहीं है" : "No products added yet"}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">
            {isHindi
              ? "ऊपर \"नया आइटम जोड़ें\" पर क्लिक करें और अपनी दुकान के उत्पाद बनाएं।"
              : "Click \"Add Item\" above to create your catalog items. Then simply speak to update stock."}
          </p>
          <button
            onClick={openNew}
            className="mt-5 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 px-6 py-2.5 text-xs font-black text-white shadow-md shadow-orange-500/20 transition"
          >
            + {isHindi ? "पहला आइटम जोड़ें" : "Add First Product"}
          </button>
        </div>
      )}

      {/* ── Inventory Cards Grid ────────────────────────────────────────────── */}
      {catalogItems.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {catalogItems.map(item => {
            const pct = stockPct(item);
            const barColor = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-rose-500";
            const textColor = pct > 50 ? "text-emerald-700" : pct > 20 ? "text-amber-700" : "text-rose-700";
            const status = pct > 50
              ? (isHindi ? "पर्याप्त" : "In Stock")
              : pct > 20
              ? (isHindi ? "कम हो रहा है" : "Low Stock")
              : (isHindi ? "लगभग खत्म" : "Critical");

            return (
              <div
                key={item.id || item.item_name}
                className="relative rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs hover:shadow-md hover:border-orange-200 transition-all duration-200 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-black text-slate-900 capitalize leading-tight">
                        {item.item_name_hi && item.item_name_hi !== item.item_name
                          ? item.item_name_hi
                          : item.item_name}
                      </p>
                      <p className="text-xs text-slate-400 font-medium mt-0.5">{item.item_name} · {item.unit}</p>
                    </div>

                    {pct <= 20 && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700 animate-pulse">
                        ⚠️ {isHindi ? "कम स्टॉक" : "Low"}
                      </span>
                    )}
                  </div>

                  {/* Stock progress bar */}
                  <div className="mt-4">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between mt-1.5 text-xs">
                      <span className="text-slate-600 font-bold">
                        {item.current_stock} / {item.daily_stock} {item.unit}
                      </span>
                      <span className={`font-black ${textColor}`}>{pct}% · {status}</span>
                    </div>
                  </div>

                  {/* Price info */}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-xs text-slate-600">
                    <span className="font-semibold">
                      {item.price_per_unit && item.price_per_unit > 0
                        ? `₹${item.price_per_unit} / ${item.unit}`
                        : (isHindi ? "मूल्य निर्धारित नहीं" : "No price set")}
                    </span>
                    {item.price_per_unit && item.price_per_unit > 0 && (
                      <span className="font-bold text-emerald-600">
                        ≈ ₹{Math.round((item.daily_stock - item.current_stock) * item.price_per_unit)} {isHindi ? "बिक्री" : "sold"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Edit and Delete Actions */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => openEdit(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isHindi ? "संपादित करें" : "Edit"}</span>
                  </button>
                  <button
                    onClick={() => removeInventoryItem(item.item_name)}
                    className="flex items-center justify-center rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition"
                    title="Delete item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
