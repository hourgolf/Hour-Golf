import Modal from "./Modal";

export default function Confirm({ open, onClose, onOk, title, msg, detail, label = "Confirm", danger }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="confirm-box">
        <h2 style={{ fontSize: 15, letterSpacing: 2, textTransform: "uppercase", color: danger ? "var(--red)" : "var(--primary)", marginBottom: 14 }}>
          {title}
        </h2>
        <p>{msg}</p>
        {detail && <span className="muted" style={{ display: "block", marginBottom: 16 }}>{detail}</span>}
        <div className="macts" style={{ justifyContent: "center" }}>
          <button className="btn" onClick={onClose}>Nevermind</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onOk}>{label}</button>
        </div>
      </div>
    </Modal>
  );
}
