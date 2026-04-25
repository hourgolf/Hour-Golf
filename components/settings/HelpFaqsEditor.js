import { useState } from "react";
import { DEFAULT_HELP_FAQS, HELP_FAQ_TOKENS } from "../../lib/help-faqs";

// Help Center FAQ editor. Edits an array of categories, each with a
// label/icon and an items array of { q, a } pairs. Lives inside
// TenantBranding's Operations area; the parent owns the save button +
// payload build, so this component just mutates `branding.help_faqs`
// in place via the shared `update()` setter.
//
// On first edit (when the column is still null) we seed the editor
// with a deep clone of DEFAULT_HELP_FAQS so the operator has the
// full template to start from, not a blank canvas. The "Reset to
// defaults" button drops back to that null state via a sentinel
// flag (_helpFaqsResetToDefaults) read in the save payload builder.
export default function HelpFaqsEditor({ branding, update }) {
  const [showTokens, setShowTokens] = useState(false);

  // Editor state is the live `branding.help_faqs`. If the column is
  // null (default behavior, no override yet), we surface the
  // platform default so the operator sees something to edit. Saving
  // an unchanged copy persists the same content as the default.
  const faqs = Array.isArray(branding.help_faqs) && branding.help_faqs.length > 0
    ? branding.help_faqs
    : DEFAULT_HELP_FAQS;
  const isOverride = Array.isArray(branding.help_faqs) && branding.help_faqs.length > 0;

  function setFaqs(next) {
    update("help_faqs", next);
    update("_helpFaqsResetToDefaults", false);
  }

  function ensureEditable() {
    if (isOverride) return faqs;
    // First edit: deep-clone the defaults so we don't mutate the
    // shared module-level array.
    const cloned = DEFAULT_HELP_FAQS.map((cat) => ({
      ...cat,
      items: cat.items.map((it) => ({ ...it })),
    }));
    setFaqs(cloned);
    return cloned;
  }

  function updateCategory(idx, partial) {
    const next = [...ensureEditable()];
    next[idx] = { ...next[idx], ...partial };
    setFaqs(next);
  }

  function moveCategory(idx, dir) {
    const next = [...ensureEditable()];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setFaqs(next);
  }

  function removeCategory(idx) {
    if (!confirm("Remove this category and all its questions?")) return;
    const next = ensureEditable().filter((_, i) => i !== idx);
    setFaqs(next);
  }

  function addCategory() {
    const next = [
      ...ensureEditable(),
      { key: `cat_${Date.now()}`, label: "New Category", icon: "❓", items: [] },
    ];
    setFaqs(next);
  }

  function updateItem(catIdx, itemIdx, partial) {
    const next = [...ensureEditable()];
    const items = [...(next[catIdx].items || [])];
    items[itemIdx] = { ...items[itemIdx], ...partial };
    next[catIdx] = { ...next[catIdx], items };
    setFaqs(next);
  }

  function moveItem(catIdx, itemIdx, dir) {
    const next = [...ensureEditable()];
    const items = [...(next[catIdx].items || [])];
    const j = itemIdx + dir;
    if (j < 0 || j >= items.length) return;
    [items[itemIdx], items[j]] = [items[j], items[itemIdx]];
    next[catIdx] = { ...next[catIdx], items };
    setFaqs(next);
  }

  function removeItem(catIdx, itemIdx) {
    const next = [...ensureEditable()];
    next[catIdx] = {
      ...next[catIdx],
      items: (next[catIdx].items || []).filter((_, i) => i !== itemIdx),
    };
    setFaqs(next);
  }

  function addItem(catIdx) {
    const next = [...ensureEditable()];
    next[catIdx] = {
      ...next[catIdx],
      items: [...(next[catIdx].items || []), { q: "New question", a: "" }],
    };
    setFaqs(next);
  }

  function resetToDefaults() {
    if (!confirm("Reset the Help Center to platform defaults? Your custom questions will be discarded on save.")) return;
    update("help_faqs", DEFAULT_HELP_FAQS);
    update("_helpFaqsResetToDefaults", true);
  }

  const headerStyle = {
    fontFamily: "var(--font-display)", fontSize: 12,
    textTransform: "uppercase", letterSpacing: 1.5,
    color: "var(--text-muted)", marginBottom: 6,
  };

  return (
    <div style={{ marginTop: 28 }}>
      <h4 style={headerStyle}>Help Center FAQ</h4>
      <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 14 }}>
        Categories and questions shown to members in the floating Help (?) button. Use {"{"}tokens{"}"} to keep dynamic info (venue name, support email, cancel cutoff…) auto-synced with the rest of Settings.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={() => setShowTokens((s) => !s)}
          style={{ fontSize: 11 }}
        >
          {showTokens ? "Hide" : "Show"} available tokens
        </button>
        <button
          type="button"
          className="btn"
          onClick={resetToDefaults}
          style={{ fontSize: 11 }}
        >
          Reset to platform defaults
        </button>
        {isOverride && (
          <span className="muted" style={{ fontSize: 11 }}>
            Custom Help Center active.
          </span>
        )}
      </div>

      {showTokens && (
        <div style={{
          background: "var(--primary-bg, rgba(76,141,115,0.08))",
          border: "1px solid var(--border, rgba(0,0,0,0.08))",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 14,
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Tokens you can drop into any answer</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {HELP_FAQ_TOKENS.map((t) => (
              <li key={t.token} style={{ display: "flex", gap: 10, padding: "3px 0" }}>
                <code style={{ fontFamily: "var(--font-mono)", color: "var(--primary)", minWidth: 140 }}>{t.token}</code>
                <span className="muted">{t.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {faqs.map((cat, catIdx) => (
        <CategoryEditor
          key={cat.key || `idx_${catIdx}`}
          category={cat}
          onUpdate={(partial) => updateCategory(catIdx, partial)}
          onMoveUp={() => moveCategory(catIdx, -1)}
          onMoveDown={() => moveCategory(catIdx, 1)}
          onRemove={() => removeCategory(catIdx)}
          onAddItem={() => addItem(catIdx)}
          onUpdateItem={(itemIdx, partial) => updateItem(catIdx, itemIdx, partial)}
          onMoveItemUp={(itemIdx) => moveItem(catIdx, itemIdx, -1)}
          onMoveItemDown={(itemIdx) => moveItem(catIdx, itemIdx, 1)}
          onRemoveItem={(itemIdx) => removeItem(catIdx, itemIdx)}
          isFirst={catIdx === 0}
          isLast={catIdx === faqs.length - 1}
        />
      ))}

      <button
        type="button"
        className="btn"
        onClick={addCategory}
        style={{ fontSize: 12, marginTop: 8 }}
      >
        + Add category
      </button>
    </div>
  );
}

function CategoryEditor({
  category, onUpdate, onMoveUp, onMoveDown, onRemove,
  onAddItem, onUpdateItem, onMoveItemUp, onMoveItemDown, onRemoveItem,
  isFirst, isLast,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const items = category.items || [];

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 14,
      marginBottom: 12,
      background: "var(--surface)",
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, padding: 4, color: "var(--text-muted)" }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <input
          type="text"
          value={category.icon || ""}
          onChange={(e) => onUpdate({ icon: e.target.value })}
          maxLength={8}
          placeholder="🔑"
          style={{ width: 56, padding: "4px 8px", fontSize: 18, textAlign: "center", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)" }}
          aria-label="Category icon"
        />
        <input
          type="text"
          value={category.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          maxLength={60}
          placeholder="Category name"
          style={{ flex: 1, minWidth: 160, padding: "6px 10px", fontSize: 14, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)" }}
          aria-label="Category name"
        />
        <span className="muted" style={{ fontSize: 11 }}>
          {items.length} question{items.length === 1 ? "" : "s"}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="btn" onClick={onMoveUp} disabled={isFirst} style={{ fontSize: 12, padding: "4px 8px" }} title="Move up">↑</button>
          <button type="button" className="btn" onClick={onMoveDown} disabled={isLast} style={{ fontSize: 12, padding: "4px 8px" }} title="Move down">↓</button>
          <button type="button" className="btn" onClick={onRemove} style={{ fontSize: 12, padding: "4px 8px", color: "var(--red)" }} title="Remove category">✕</button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 12, paddingLeft: 28, borderLeft: "2px solid var(--border)" }}>
          {items.map((it, itemIdx) => (
            <div key={itemIdx} style={{ marginBottom: 12, padding: "10px 12px", background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={it.q || ""}
                    onChange={(e) => onUpdateItem(itemIdx, { q: e.target.value })}
                    maxLength={250}
                    placeholder="Question"
                    style={{ width: "100%", padding: "6px 10px", fontSize: 13, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--surface)", marginBottom: 6 }}
                  />
                  {it.troubleshoot ? (
                    <div className="muted" style={{ fontSize: 11, padding: "6px 10px", background: "var(--primary-bg)", borderRadius: 4 }}>
                      Special item: tapping this opens the access-code troubleshooting flow. Answer text is ignored.
                    </div>
                  ) : (
                    <textarea
                      value={it.a || ""}
                      onChange={(e) => onUpdateItem(itemIdx, { a: e.target.value })}
                      maxLength={4000}
                      rows={3}
                      placeholder="Answer (supports {tokens})"
                      style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 4, background: "var(--surface)", fontFamily: "inherit", resize: "vertical" }}
                    />
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button type="button" className="btn" onClick={() => onMoveItemUp(itemIdx)} disabled={itemIdx === 0} style={{ fontSize: 11, padding: "3px 7px" }} title="Move up">↑</button>
                  <button type="button" className="btn" onClick={() => onMoveItemDown(itemIdx)} disabled={itemIdx === items.length - 1} style={{ fontSize: 11, padding: "3px 7px" }} title="Move down">↓</button>
                  <button type="button" className="btn" onClick={() => onRemoveItem(itemIdx)} style={{ fontSize: 11, padding: "3px 7px", color: "var(--red)" }} title="Remove">✕</button>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn" onClick={onAddItem} style={{ fontSize: 12 }}>
            + Add question
          </button>
        </div>
      )}
    </div>
  );
}
