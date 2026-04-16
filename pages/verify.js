import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function VerifyMember() {
  const router = useRouter();
  const { token } = router.query;
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/verify-member?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Invalid or expired code");
        return r.json();
      })
      .then((data) => setMember(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const tierColors = {
    Patron: { bg: "#D1DFCB", text: "#35443B" },
    Starter: { bg: "#8BB5A0", text: "#EDF3E3" },
    "Green Jacket": { bg: "#4C8D73", text: "#EDF3E3" },
    Unlimited: { bg: "#35443B", text: "#D1DFCB" },
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#EDF3E3", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "32px 28px", maxWidth: 380,
        width: "calc(100% - 40px)", textAlign: "center",
        boxShadow: "0 4px 24px rgba(53,68,59,0.12)", border: "1px solid #D1DFCB",
      }}>
        <img src="/blobs/MASTERS FLAG.svg" alt="" style={{ height: 48, marginBottom: 16, opacity: 0.3 }} />

        {loading && <p style={{ color: "#8BB5A0" }}>Verifying member...</p>}

        {error && (
          <>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#10007;</div>
            <h2 style={{ margin: "0 0 8px 0", color: "#C92F1F" }}>Invalid Code</h2>
            <p style={{ color: "#8BB5A0", fontSize: 14 }}>{error}</p>
          </>
        )}

        {member && (
          <>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", background: "#4C8D73",
              color: "#EDF3E3", fontSize: 32, fontWeight: 700, display: "flex",
              alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
              fontFamily: "var(--font-display, 'Bungee', sans-serif)",
            }}>
              {(member.name || "?")[0].toUpperCase()}
            </div>

            <h1 style={{ margin: "0 0 4px 0", fontSize: 22, color: "#35443B" }}>{member.name}</h1>

            <div style={{
              display: "inline-block", padding: "4px 16px", borderRadius: 8,
              background: (tierColors[member.tier] || { bg: "#D1DFCB" }).bg,
              color: (tierColors[member.tier] || { text: "#35443B" }).text,
              fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              marginBottom: 20,
            }}>
              {member.tier}
            </div>

            <div style={{
              background: "#e7efd8", borderRadius: 12, padding: "16px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 14, color: "#8BB5A0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>
                Pro Shop Discount
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: "#4C8D73" }}>
                {member.discount}% OFF
              </div>
            </div>

            {member.credit_balance > 0 && (
              <div style={{
                background: "#faf5e4", borderRadius: 12, padding: "12px 16px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 12, color: "#B8A44E", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2, fontWeight: 600 }}>
                  Store Credit
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#8B7D3C" }}>
                  ${member.credit_balance.toFixed(2)}
                </div>
              </div>
            )}

            <div style={{
              background: "#4C8D73", color: "#EDF3E3", borderRadius: 12,
              padding: "12px 16px", fontSize: 14, fontWeight: 600,
            }}>
              &#10003; Verified Member
            </div>

            <p style={{ fontSize: 11, color: "#8BB5A0", marginTop: 12 }}>
              Scanned {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
