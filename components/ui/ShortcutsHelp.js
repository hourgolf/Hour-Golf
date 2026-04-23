import Modal from "./Modal";

const SHORTCUTS = [
  { group: "Global", items: [
    { keys: ["⌘", "K"], note: "or Ctrl+K", desc: "Search members (command palette)" },
    { keys: ["?"], desc: "Show this cheat sheet" },
    { keys: ["/"], desc: "Focus the Customers search box" },
    { keys: ["N"], desc: "New booking" },
    { keys: ["R"], desc: "Refresh data" },
  ]},
  { group: "Views", items: [
    { keys: ["T"], desc: "Jump to Today" },
    { keys: ["W"], desc: "Switch to Calendar (week)" },
    { keys: ["["], desc: "Previous day (on Today)" },
    { keys: ["]"], desc: "Next day (on Today)" },
  ]},
  { group: "Lists", items: [
    { keys: ["↑", "↓"], desc: "Move selection in command palette or booking list" },
    { keys: ["Enter"], desc: "Open the selected item" },
    { keys: ["Esc"], desc: "Close a modal or clear selection" },
  ]},
];

function Key({ children }) {
  return (
    <span style={{
      display: "inline-block",
      minWidth: 22,
      padding: "2px 8px",
      margin: "0 2px",
      borderRadius: 4,
      background: "var(--primary-bg)",
      border: "1px solid var(--border)",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      fontWeight: 600,
      textAlign: "center",
      color: "var(--text)",
    }}>
      {children}
    </span>
  );
}

export default function ShortcutsHelp({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 style={{ marginTop: 0, marginBottom: 6 }}>Keyboard Shortcuts</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 12 }}>
        Shortcuts fire when you&rsquo;re not typing in a field (except ⌘K, which
        always works).
      </p>
      {SHORTCUTS.map((section) => (
        <div key={section.group} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
            {section.group}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {section.items.map((item, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <div style={{ minWidth: 140, whiteSpace: "nowrap" }}>
                  {item.keys.map((k, i) => (
                    <Key key={i}>{k}</Key>
                  ))}
                  {item.note && (
                    <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{item.note}</span>
                  )}
                </div>
                <div style={{ flex: 1, color: "var(--text)" }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
