import { useState, useEffect, useCallback } from "react";
import Modal from "../ui/Modal";
import Confirm from "../ui/Confirm";
import StatusBadge from "../ui/StatusBadge";
import { isOnSale, saleDiscountPct } from "../../lib/shop-pricing";
import DiscountCodesSection from "../settings/DiscountCodesSection";
import ShopRequestsSection from "../settings/ShopRequestsSection";

// --- CSV helpers ---
const CSV_COLUMNS = [
  "id", "title", "subtitle", "description", "brand", "category",
  "price", "compare_at_price", "sale_ends_at",
  "quantity_available", "sizes", "is_published", "is_limited",
  "drop_date", "display_order",
];

function csvEscape(v) {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("|") : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportItemsCsv(items) {
  const header = CSV_COLUMNS.join(",");
  const lines = items.map((it) => CSV_COLUMNS.map((c) => csvEscape(it[c])).join(","));
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shop-items-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Very small CSV parser: handles quoted fields + embedded commas +
// doubled-quote escapes. Not a general-purpose library; good enough
// for the export format we produce (round-trippable).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); cell = ""; rows.push(row); row = []; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const CATEGORIES = ["Apparel", "Accessories", "Equipment", "Other"];

const STATUS_COLORS = {
  pending: "#E8A838",
  confirmed: "#4C8D73",
  ready: "#35443B",
  picked_up: "#8BB5A0",
  cancelled: "#C92F1F",
  refunded: "#C77B3C",
};

function ShopItemFormModal({ open, onClose, item, onSave, apiKey }) {
  const [form, setForm] = useState({
    title: "", subtitle: "", description: "", image_urls: [],
    price: 0, compare_at_price: "", sale_ends_at: "",
    category: "Apparel", brand: "", is_limited: false,
    drop_date: "", quantity_available: "", sizes: "",
    is_published: true, display_order: 0,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isNew = !item;

  useEffect(() => {
    if (item) {
      const urls = Array.isArray(item.image_urls) && item.image_urls.length > 0
        ? item.image_urls
        : item.image_url ? [item.image_url] : [];
      setForm({
        title: item.title || "",
        subtitle: item.subtitle || "",
        description: item.description || "",
        image_urls: urls,
        price: Number(item.price || 0),
        compare_at_price: item.compare_at_price != null ? Number(item.compare_at_price) : "",
        sale_ends_at: item.sale_ends_at ? item.sale_ends_at.slice(0, 16) : "",
        category: item.category || "Apparel",
        brand: item.brand || "",
        is_limited: !!item.is_limited,
        drop_date: item.drop_date ? item.drop_date.slice(0, 16) : "",
        quantity_available: item.quantity_available != null ? item.quantity_available : "",
        sizes: Array.isArray(item.sizes) ? item.sizes.join(", ") : "",
        is_published: item.is_published !== false,
        display_order: Number(item.display_order || 0),
      });
    } else {
      setForm({
        title: "", subtitle: "", description: "", image_urls: [],
        price: 0, compare_at_price: "", sale_ends_at: "",
        category: "Apparel", brand: "", is_limited: false,
        drop_date: "", quantity_available: "", sizes: "",
        is_published: true, display_order: 0,
      });
    }
  }, [item, open]);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Vercel serverless functions cap request bodies at ~4.5MB, so reject
    // anything above 4MB client-side with a clear message.
    if (file.size > 4 * 1024 * 1024) { alert("Image too large. Please use a file under 4MB."); return; }
    if (form.image_urls.length >= 5) { alert("Maximum 5 images"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const name = `shop_${Date.now()}.${ext}`;
      const r = await fetch(`/api/upload-shop-image?filename=${name}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": file.type },
        body: file,
      });
      // Parse JSON if possible; fall back to raw text so platform errors
      // (e.g. Vercel's plain-text "Request Entity Too Large") don't show up
      // as cryptic "Unexpected token" JSON errors.
      const d = await r.json().catch(async () => ({ detail: (await r.text().catch(() => "")) }));
      if (!r.ok) {
        if (r.status === 413) throw new Error("Image too large for the server. Please use a file under 4MB.");
        throw new Error(d.detail || d.error || `Upload failed (${r.status})`);
      }
      update("image_urls", [...form.image_urls, d.url]);
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setUploading(false);
    e.target.value = "";
  }

  function removeImage(idx) {
    update("image_urls", form.image_urls.filter((_, i) => i !== idx));
  }

  // Move the image at `from` to position `to` (for reordering).
  // Index 0 is the primary thumbnail on every shop surface, so this
  // lets the operator choose which image members see on the card.
  function moveImage(from, to) {
    if (from === to) return;
    if (to < 0 || to >= form.image_urls.length) return;
    const next = [...form.image_urls];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update("image_urls", next);
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    const sizesArr = form.sizes.trim()
      ? form.sizes.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    await onSave({
      ...form,
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      description: form.description.trim() || null,
      image_urls: form.image_urls,
      price: Number(form.price || 0),
      compare_at_price: form.compare_at_price !== "" ? Number(form.compare_at_price) : null,
      sale_ends_at: form.sale_ends_at ? new Date(form.sale_ends_at).toISOString() : null,
      quantity_available: form.quantity_available !== "" ? Number(form.quantity_available) : null,
      sizes: sizesArr,
      drop_date: form.drop_date ? new Date(form.drop_date).toISOString() : null,
    }, !!item);
    setSaving(false);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2>{isNew ? "Add Item" : "Edit Item"}</h2>
      <div className="mf">
        <label>Product Images ({form.image_urls.length}/5)</label>
        {form.image_urls.length > 1 && (
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            First image is the thumbnail members see. Use ◀ ▶ to reorder.
          </div>
        )}
        {form.image_urls.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            {form.image_urls.map((url, i) => {
              const isFirst = i === 0;
              const isLast = i === form.image_urls.length - 1;
              return (
                <div key={`${url}-${i}`} style={{ position: "relative", width: 80, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ position: "relative", width: 80, height: 80 }}>
                    <img src={url} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, border: isFirst ? "2px solid var(--primary)" : "1px solid var(--border)" }} />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      title="Remove image"
                      style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--red)", color: "#fff", border: "none", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                    >x</button>
                    {isFirst && <div style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, background: "var(--primary)", color: "#EDF3E3", padding: "1px 4px", borderRadius: 3 }}>Primary</div>}
                  </div>
                  {form.image_urls.length > 1 && (
                    <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={() => moveImage(i, i - 1)}
                        disabled={isFirst}
                        title="Move earlier"
                        style={{ flex: 1, padding: "2px 0", fontSize: 12, background: isFirst ? "var(--border)" : "var(--surface)", color: isFirst ? "var(--text-muted)" : "var(--text)", border: "1px solid var(--border)", borderRadius: 4, cursor: isFirst ? "default" : "pointer", lineHeight: 1 }}
                      >◀</button>
                      <button
                        type="button"
                        onClick={() => moveImage(i, i + 1)}
                        disabled={isLast}
                        title="Move later"
                        style={{ flex: 1, padding: "2px 0", fontSize: 12, background: isLast ? "var(--border)" : "var(--surface)", color: isLast ? "var(--text-muted)" : "var(--text)", border: "1px solid var(--border)", borderRadius: 4, cursor: isLast ? "default" : "pointer", lineHeight: 1 }}
                      >▶</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {form.image_urls.length < 5 && (
          <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
        )}
        {uploading && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Uploading...</span>}
      </div>
      <div className="mf">
        <label>Title *</label>
        <input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Travis Mathew Polo" />
      </div>
      <div className="mf">
        <label>Subtitle</label>
        <input value={form.subtitle} onChange={(e) => update("subtitle", e.target.value)} placeholder="Limited edition colorway" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="mf">
          <label>Price ($) *</label>
          <input type="number" min={0} step="0.01" value={form.price} onChange={(e) => update("price", e.target.value)} />
        </div>
        <div className="mf">
          <label>Compare-at price ($) <span className="muted" style={{ fontSize: 10 }}>for sale</span></label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.compare_at_price}
            onChange={(e) => update("compare_at_price", e.target.value)}
            placeholder="Blank = no sale"
            title="Set higher than Price to show a SALE chip with the original price crossed out"
          />
        </div>
        <div className="mf">
          <label>Sale ends <span className="muted" style={{ fontSize: 10 }}>optional</span></label>
          <input
            type="datetime-local"
            value={form.sale_ends_at}
            onChange={(e) => update("sale_ends_at", e.target.value)}
            disabled={!form.compare_at_price}
          />
        </div>
        <div className="mf">
          <label>Category</label>
          <select value={form.category} onChange={(e) => update("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="mf">
          <label>Brand</label>
          <input value={form.brand} onChange={(e) => update("brand", e.target.value)} placeholder="Travis Mathew" />
        </div>
        <div className="mf">
          <label>Stock (blank = unlimited)</label>
          <input type="number" min={0} value={form.quantity_available} onChange={(e) => update("quantity_available", e.target.value)} placeholder="Unlimited" />
        </div>
        <div className="mf">
          <label>Sizes (comma-separated)</label>
          <input value={form.sizes} onChange={(e) => update("sizes", e.target.value)} placeholder="S, M, L, XL" />
        </div>
        <div className="mf">
          <label>Display Order</label>
          <input type="number" min={0} value={form.display_order} onChange={(e) => update("display_order", e.target.value)} />
        </div>
      </div>
      <div className="mf">
        <label>Description</label>
        <textarea rows={3} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Product details..." style={{ width: "100%", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 24, margin: "12px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
          <input type="checkbox" checked={form.is_published} onChange={(e) => update("is_published", e.target.checked)} />
          Published
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
          <input type="checkbox" checked={form.is_limited} onChange={(e) => update("is_limited", e.target.checked)} />
          Limited Drop
        </label>
      </div>
      {form.is_limited && (
        <div className="mf">
          <label>Drop Date (leave blank = available now)</label>
          <input type="datetime-local" value={form.drop_date} onChange={(e) => update("drop_date", e.target.value)} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !form.title.trim()}>
          {saving ? "Saving..." : isNew ? "Add Item" : "Update"}
        </button>
      </div>
    </Modal>
  );
}

// CSV import modal: textarea paste → preview → upsert. Upserts by
// the `id` column if present; otherwise inserts new. Boolean fields
// accept true/false/1/0/yes/no; sizes accepts pipe- or comma-
// separated values.
function CsvImportModal({ open, onClose, onDone, apiKey }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open) { setText(""); setPreview(null); setErr(null); setBusy(false); }
  }, [open]);

  function coerce(row, header) {
    const BOOLS = ["is_published", "is_limited"];
    const NUMS = ["price", "compare_at_price", "quantity_available", "display_order"];
    const out = {};
    header.forEach((col, i) => {
      const v = row[i];
      if (v == null || v === "") return;
      if (BOOLS.includes(col)) out[col] = /^(true|1|yes|y)$/i.test(String(v).trim());
      else if (NUMS.includes(col)) out[col] = Number(v);
      else if (col === "sizes") {
        const parts = String(v).split(/[|,]/).map((s) => s.trim()).filter(Boolean);
        out[col] = parts.length ? parts : null;
      } else {
        out[col] = String(v).trim();
      }
    });
    return out;
  }

  function runPreview() {
    setErr(null);
    try {
      const rows = parseCsv(text.trim());
      if (rows.length < 2) return setErr("Need a header row + at least one data row.");
      const header = rows[0].map((s) => s.trim());
      const missing = ["title", "price"].filter((c) => !header.includes(c));
      if (missing.length) return setErr(`Missing required column(s): ${missing.join(", ")}`);
      const parsed = rows.slice(1)
        .filter((r) => r.some((c) => c && c.trim()))
        .map((r) => coerce(r, header));
      setPreview({ header, rows: parsed });
    } catch (e) {
      setErr(e.message || "Parse failed");
    }
  }

  async function runImport() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    const results = { created: 0, updated: 0, failed: 0 };
    try {
      for (const row of preview.rows) {
        const { id, ...data } = row;
        if (!data.title || data.price == null) { results.failed++; continue; }
        try {
          const url = id ? `/api/admin-shop?id=${id}` : "/api/admin-shop";
          const r = await fetch(url, {
            method: id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(data),
          });
          if (!r.ok) { results.failed++; continue; }
          if (id) results.updated++;
          else results.created++;
        } catch {
          results.failed++;
        }
      }
      await onDone();
      alert(`Import complete — ${results.created} created, ${results.updated} updated, ${results.failed} failed.`);
      onClose();
    } catch (e) {
      setErr(e.message || "Import failed");
    }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2>Import items from CSV</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Paste a CSV with these columns (first row is the header):
        <br />
        <code style={{ fontSize: 11 }}>{CSV_COLUMNS.join(", ")}</code>
        <br />
        Rows with an <code>id</code> update existing items; rows without one create new.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder="id,title,price,category,brand,is_published
,Travis Mathew Polo,79,Apparel,Travis Mathew,true"
        style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}
      />
      {err && <div style={{ color: "var(--danger, #C92F1F)", fontSize: 13, marginTop: 8 }}>{err}</div>}
      {preview && (
        <div style={{ marginTop: 12, padding: 10, background: "var(--primary-bg)", borderRadius: 6, fontSize: 12 }}>
          <strong>Preview:</strong> {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"} ready.
          <br />
          <span style={{ color: "var(--text-muted)" }}>
            {preview.rows.filter((r) => r.id).length} will update, {preview.rows.filter((r) => !r.id).length} will create.
          </span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        {!preview ? (
          <button className="btn primary" onClick={runPreview} disabled={!text.trim() || busy}>Preview</button>
        ) : (
          <button className="btn primary" onClick={runImport} disabled={busy}>
            {busy ? "Importing…" : `Import ${preview.rows.length}`}
          </button>
        )}
      </div>
    </Modal>
  );
}

export default function ShopAdminView({ apiKey }) {
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("items");
  const [editItem, setEditItem] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const r = await fetch("/api/admin-shop", { headers: { Authorization: `Bearer ${apiKey}` } });
      if (r.ok) setItems(await r.json());
    } catch {}
  }, [apiKey]);

  const fetchOrders = useCallback(async () => {
    try {
      const url = orderFilter !== "all" ? `/api/admin-shop?action=orders&status=${orderFilter}` : "/api/admin-shop?action=orders";
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (r.ok) setOrders(await r.json());
    } catch {}
  }, [apiKey, orderFilter]);

  useEffect(() => { fetchItems().then(() => setLoading(false)); }, [fetchItems]);
  useEffect(() => { if (tab === "orders") fetchOrders(); }, [tab, fetchOrders]);

  async function handleSave(data, isEdit) {
    try {
      const url = isEdit ? `/api/admin-shop?id=${editItem.id}` : "/api/admin-shop";
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      setEditItem(null);
      await fetchItems();
    } catch (e) {
      alert("Save failed: " + e.message);
    }
  }

  async function handleDelete() {
    if (!delTarget) return;
    try {
      const r = await fetch(`/api/admin-shop?id=${delTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || "Delete failed");
      }
      setDelTarget(null);
      await fetchItems();
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  }

  async function updateOrderStatus(orderId, status) {
    try {
      await fetch(`/api/admin-shop?id=${orderId}&action=orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
      await fetchItems();
    } catch {}
  }

  function toggleSelect(id) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAllItems() {
    setSelectedIds((s) => {
      if (s.size === items.length) return new Set();
      return new Set(items.map((i) => i.id));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkPatch(patchFn) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      // Sequential — parallel Stripe/Supabase load from 20+ concurrent
      // PATCHes isn't worth optimizing for; admin catalogs are small.
      for (const id of ids) {
        const data = typeof patchFn === "function"
          ? patchFn(items.find((i) => i.id === id))
          : patchFn;
        if (!data) continue;
        await fetch(`/api/admin-shop?id=${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(data),
        });
      }
      clearSelection();
      await fetchItems();
    } catch (e) {
      alert("Bulk update failed: " + (e.message || e));
    }
    setBulkBusy(false);
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulkBusy(true);
    try {
      for (const id of ids) {
        await fetch(`/api/admin-shop?id=${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      }
      clearSelection();
      await fetchItems();
    } catch (e) {
      alert("Bulk delete failed: " + (e.message || e));
    }
    setBulkBusy(false);
  }

  async function bulkPriceChange() {
    const raw = window.prompt(
      "Adjust price for selected items:\n• Percent off: type e.g. -10% (reduces by 10%)\n• Fixed amount: type e.g. 5 (sets to $5)\n• Compare-at (creates sale): type e.g. sale 20% to mark all as 20% off current price",
      ""
    );
    if (!raw) return;
    const trimmed = raw.trim();
    let patchFn = null;
    const pctMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)%$/);
    const saleMatch = trimmed.match(/^sale\s+(-?\d+(?:\.\d+)?)%$/i);
    const absMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
    if (saleMatch) {
      const pct = Math.abs(Number(saleMatch[1])) / 100;
      patchFn = (it) => {
        const current = Number(it?.price || 0);
        if (!current) return null;
        const salePrice = Math.round(current * (1 - pct) * 100) / 100;
        return { compare_at_price: current, price: salePrice };
      };
    } else if (pctMatch) {
      const factor = 1 + Number(pctMatch[1]) / 100;
      patchFn = (it) => ({ price: Math.round(Number(it?.price || 0) * factor * 100) / 100 });
    } else if (absMatch) {
      patchFn = () => ({ price: Number(absMatch[1]) });
    } else {
      alert("Couldn't parse. Examples: -10%   5   sale 20%");
      return;
    }
    await bulkPatch(patchFn);
  }

  async function refundOrder(order) {
    const amount = (
      Number(order.unit_price || 0) * (Number(order.quantity) || 1) * (1 - Number(order.discount_pct || 0) / 100)
      + Number(order.shipping_amount || 0)
      + Number(order.tax_amount || 0)
    ).toFixed(2);
    const reason = window.prompt(
      `Refund $${amount} to ${order.member_name || order.member_email}?\n\nOptional reason (shown in their refund email):`,
      ""
    );
    if (reason === null) return; // user cancelled the prompt
    try {
      const r = await fetch("/api/admin-refund-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ order_id: order.id, reason: reason || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
      await fetchOrders();
      await fetchItems();
      alert(`Refunded $${(d.amount_cents / 100).toFixed(2)}. Stripe ref: ${d.stripe_refund_id}`);
    } catch (e) {
      alert("Refund failed: " + e.message);
    }
  }

  const pendingCount = orders.filter((o) => o.status === "pending").length;

  if (loading) return <div className="content"><p className="muted">Loading shop...</p></div>;

  return (
    <div className="content">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`rpt-tab ${tab === "items" ? "active" : ""}`} onClick={() => setTab("items")}>Items</button>
          <button className={`rpt-tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
            Orders {pendingCount > 0 && <span className="cnt" style={{ marginLeft: 4 }}>{pendingCount}</span>}
          </button>
          <button className={`rpt-tab ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}>Requests</button>
          <button className={`rpt-tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Settings</button>
        </div>
        {tab === "items" && (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setShowImport(true)}>Import CSV</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => exportItemsCsv(items)}>Export CSV</button>
            <button className="btn primary" onClick={() => setEditItem({})}>+ New Item</button>
          </div>
        )}
      </div>

      {tab === "items" && (
        <>
          {items.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 32 }}>No items yet. Add your first product!</p>}

          {/* Desktop table */}
          <div className="tbl usage-desktop">
            {items.length > 0 && (
              <div className="th">
                <span style={{ width: 28, flex: "0 0 28px", display: "flex", justifyContent: "center" }}>
                  <input
                    type="checkbox"
                    className="chk"
                    checked={selectedIds.size === items.length && items.length > 0}
                    onChange={selectAllItems}
                    aria-label="Select all"
                  />
                </span>
                <span style={{ flex: 0.5 }}></span>
                <span style={{ flex: 2 }}>Item</span>
                <span style={{ flex: 1 }}>Category</span>
                <span style={{ flex: 0.7 }} className="text-r">Price</span>
                <span style={{ flex: 0.7 }} className="text-c">Stock</span>
                <span style={{ flex: 0.7 }} className="text-c">Orders</span>
                <span style={{ flex: 1 }} className="text-r">Actions</span>
              </div>
            )}
            {items.map((it) => (
              <div key={it.id} className={`tr ${selectedIds.has(it.id) ? "selected" : ""}`}>
                <span
                  style={{ width: 28, flex: "0 0 28px", display: "flex", justifyContent: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="chk"
                    checked={selectedIds.has(it.id)}
                    onChange={() => toggleSelect(it.id)}
                    aria-label={`Select ${it.title}`}
                  />
                </span>
                <span style={{ flex: 0.5 }}>
                  {it.image_url ? (
                    <img src={it.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-muted)" }}>&#9670;</div>
                  )}
                </span>
                <span style={{ flex: 2 }}>
                  <strong>{it.title}</strong>
                  {it.brand && <><br /><span className="email-sm">{it.brand}</span></>}
                  {it.is_limited && <StatusBadge intent="danger" style={{ marginLeft: 6, fontSize: 8 }}>DROP</StatusBadge>}
                  {isOnSale(it) && <StatusBadge intent="warning" style={{ marginLeft: 6, fontSize: 8 }}>SALE</StatusBadge>}
                  {!it.is_published && <StatusBadge intent="neutral" style={{ marginLeft: 6, fontSize: 8 }}>DRAFT</StatusBadge>}
                </span>
                <span style={{ flex: 1 }} className="email-sm">{it.category}</span>
                <span style={{ flex: 0.7 }} className="text-r tab-num">
                  {isOnSale(it) ? (
                    <>
                      <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 11, marginRight: 4 }}>
                        ${Number(it.compare_at_price).toFixed(0)}
                      </span>
                      <span style={{ color: "var(--danger, #C92F1F)", fontWeight: 600 }}>${Number(it.price).toFixed(0)}</span>
                    </>
                  ) : (
                    `$${Number(it.price).toFixed(0)}`
                  )}
                </span>
                <span style={{ flex: 0.7 }} className="text-c tab-num">
                  {it.quantity_available != null ? `${it.quantity_available - (it.quantity_claimed || 0)}/${it.quantity_available}` : "\u221E"}
                </span>
                <span style={{ flex: 0.7 }} className="text-c tab-num">{it.order_count || 0}</span>
                <span style={{ flex: 1 }} className="text-r">
                  <button className="btn" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => setEditItem(it)}>Edit</button>
                  <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => setDelTarget(it)}>Delete</button>
                </span>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <div className="usage-mobile">
            {items.map((it) => (
              <div key={it.id} className="usage-card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", gap: 12, padding: "12px 14px", alignItems: "flex-start" }}>
                  {it.image_url ? (
                    <img src={it.image_url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--text-muted)", flexShrink: 0 }}>&#9670;</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 15 }}>{it.title}</strong>
                      {it.is_limited && <StatusBadge intent="danger" style={{ fontSize: 8 }}>DROP</StatusBadge>}
                      {isOnSale(it) && <StatusBadge intent="warning" style={{ fontSize: 8 }}>SALE</StatusBadge>}
                      {!it.is_published && <StatusBadge intent="neutral" style={{ fontSize: 8 }}>DRAFT</StatusBadge>}
                    </div>
                    {it.brand && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{it.brand}</div>}
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      {isOnSale(it) ? (
                        <>
                          <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 11, marginRight: 4 }}>
                            ${Number(it.compare_at_price).toFixed(0)}
                          </span>
                          <span className="tab-num" style={{ fontWeight: 600, color: "var(--danger, #C92F1F)" }}>${Number(it.price).toFixed(0)}</span>
                        </>
                      ) : (
                        <span className="tab-num" style={{ fontWeight: 600 }}>${Number(it.price).toFixed(0)}</span>
                      )}
                      <span className="muted" style={{ marginLeft: 8 }}>{it.category}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        Stock: {it.quantity_available != null ? `${it.quantity_available - (it.quantity_claimed || 0)}` : "\u221E"}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderTop: "0.5px solid var(--border)" }}>
                  <span className="muted">{it.order_count || 0} orders</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => setEditItem(it)}>Edit</button>
                    <button className="btn" style={{ fontSize: 11, padding: "4px 12px", color: "var(--red)" }} onClick={() => setDelTarget(it)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {selectedIds.size > 0 && (
            <div className="bulk-bar">
              <span>{selectedIds.size} selected</span>
              <button disabled={bulkBusy} onClick={() => bulkPatch({ is_published: true })}>Publish</button>
              <button disabled={bulkBusy} onClick={() => bulkPatch({ is_published: false })}>Unpublish</button>
              <button disabled={bulkBusy} onClick={bulkPriceChange}>Price…</button>
              <button disabled={bulkBusy} onClick={() => bulkPatch({ compare_at_price: null, sale_ends_at: null })}>Clear sale</button>
              <button className="bulk-danger" disabled={bulkBusy} onClick={bulkDelete}>Delete</button>
              <button onClick={clearSelection}>Clear</button>
            </div>
          )}
        </>
      )}

      <CsvImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onDone={fetchItems}
        apiKey={apiKey}
      />

      {tab === "orders" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {["all", "pending", "confirmed", "ready", "picked_up", "cancelled"].map((s) => (
              <button
                key={s}
                className={`mo-btn ${orderFilter === s ? "active" : ""}`}
                onClick={() => setOrderFilter(s)}
                style={{ textTransform: "capitalize" }}
              >
                {s === "picked_up" ? "Picked Up" : s}
              </button>
            ))}
          </div>

          {orders.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 32 }}>No orders{orderFilter !== "all" ? ` with status "${orderFilter}"` : ""}.</p>}

          {/* Desktop table */}
          <div className="tbl usage-desktop">
            {orders.length > 0 && (
              <div className="th">
                <span style={{ flex: 2 }}>Member</span>
                <span style={{ flex: 2 }}>Item</span>
                <span style={{ flex: 0.7 }}>Size</span>
                <span style={{ flex: 0.7 }} className="text-r">Total</span>
                <span style={{ flex: 1 }} className="text-c">Status</span>
                <span style={{ flex: 1.5 }} className="text-r">Actions</span>
              </div>
            )}
            {orders.map((o) => (
              <div key={o.id} className="tr">
                <span style={{ flex: 2 }}>
                  <strong>{o.member_name}</strong><br />
                  <span className="email-sm">{o.member_email}</span>
                </span>
                <span style={{ flex: 2 }}>
                  {o.item_title}
                  {o.quantity > 1 && <span className="muted"> x{o.quantity}</span>}
                </span>
                <span style={{ flex: 0.7 }}>{o.size || "\u2014"}</span>
                <span style={{ flex: 0.7 }} className="text-r tab-num">${Number(o.total).toFixed(2)}</span>
                <span style={{ flex: 1 }} className="text-c">
                  <span className="badge" style={{ background: STATUS_COLORS[o.status] || "var(--text-muted)", color: "#EDF3E3", fontSize: 9 }}>
                    {o.status === "picked_up" ? "PICKED UP" : o.status.toUpperCase()}
                  </span>
                </span>
                <span style={{ flex: 1.5 }} className="text-r">
                  {o.status === "pending" && (
                    <>
                      <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => updateOrderStatus(o.id, "confirmed")}>Confirm</button>
                      <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                    </>
                  )}
                  {o.status === "confirmed" && (
                    <>
                      <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => updateOrderStatus(o.id, "ready")}>Ready</button>
                      <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                    </>
                  )}
                  {o.status === "ready" && (
                    <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "picked_up")}>Picked Up</button>
                  )}
                  {(o.status === "confirmed" || o.status === "ready" || o.status === "picked_up") && !o.refunded_at && o.stripe_payment_intent_id && (
                    <button className="btn" style={{ fontSize: 10, padding: "2px 8px", marginLeft: 4, color: "var(--red)" }} onClick={() => refundOrder(o)} title="Refund via Stripe + email the member">Refund</button>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <div className="usage-mobile">
            {orders.map((o) => (
              <div key={o.id} className="usage-card">
                <div className="usage-card-top">
                  <div>
                    <strong>{o.member_name}</strong>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{o.item_title}{o.size ? ` — ${o.size}` : ""}</div>
                  </div>
                  <span className="badge" style={{ background: STATUS_COLORS[o.status] || "var(--text-muted)", color: "#EDF3E3", fontSize: 9 }}>
                    {o.status === "picked_up" ? "PICKED UP" : o.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <span className="tab-num" style={{ fontWeight: 600 }}>${Number(o.total).toFixed(2)}{o.discount_pct > 0 ? ` (${o.discount_pct}% off)` : ""}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {o.status === "pending" && (
                      <>
                        <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "confirmed")}>Confirm</button>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                      </>
                    )}
                    {o.status === "confirmed" && (
                      <>
                        <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "ready")}>Ready</button>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                      </>
                    )}
                    {o.status === "ready" && (
                      <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "picked_up")}>Picked Up</button>
                    )}
                    {(o.status === "confirmed" || o.status === "ready" || o.status === "picked_up") && !o.refunded_at && o.stripe_payment_intent_id && (
                      <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => refundOrder(o)}>Refund</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "requests" && (
        <div style={{ padding: "12px 0" }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Members submit "please source this" requests from the member app. Review, update status, add a note — transitioning to Ready emails the member.
          </p>
          <ShopRequestsSection jwt={apiKey} />
        </div>
      )}

      {tab === "settings" && (
        <div style={{ padding: "12px 0" }}>
          <h3 className="section-head" style={{ marginTop: 0 }}>Discount Codes</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
            Promo codes for the member + guest checkout. Not stackable with member tier discount.
          </p>
          <DiscountCodesSection jwt={apiKey} />
        </div>
      )}

      <ShopItemFormModal
        open={editItem !== null}
        onClose={() => setEditItem(null)}
        item={editItem?.id ? editItem : null}
        onSave={handleSave}
        apiKey={apiKey}
      />

      <Confirm
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        onOk={handleDelete}
        title="Delete Item"
        msg={delTarget ? `Delete "${delTarget.title}"? This also removes all orders for this item.` : ""}
        label="Delete"
        danger
      />
    </div>
  );
}
