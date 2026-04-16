export default function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ position: "relative" }}>
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 12, right: 12, zIndex: 10,
            width: 32, height: 32, borderRadius: "50%",
            border: "none", background: "rgba(53,68,59,0.1)",
            color: "var(--text)", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}
          aria-label="Close"
        >&times;</button>
        {children}
      </div>
    </div>
  );
}
