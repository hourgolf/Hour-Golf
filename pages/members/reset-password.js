import { useState } from "react";
import { useRouter } from "next/router";

export default function ResetPassword() {
  const router = useRouter();
  const { token, email } = router.query;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleReset() {
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/member-reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        setError(data.error || "Something went wrong. Please try again.");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mem-layout" style={{ position: "relative", overflow: "hidden" }}>
      {/* Tenant background image (if any) is painted on body via SSR injection. */}

      <div className="mem-login" style={{
        position: "relative", zIndex: 1,
        background: "var(--surface, #fff)",
        borderRadius: "var(--radius, 15px)",
        border: "1px solid var(--border, #D1DFCB)",
        boxShadow: "0 4px 24px rgba(53,68,59,0.10)",
        padding: "28px 28px",
        maxWidth: 400,
        width: "calc(100% - 40px)",
        margin: "60px auto",
      }}>
        <img src="/blobs/HGC_card2.png" alt="Hour Golf" style={{ width: "100%", maxWidth: 350, marginBottom: 30 }} />

        {success ? (
          <>
            <div className="mem-brand-sub">Password Reset!</div>
            <p style={{ fontSize: 14, color: "var(--primary)", marginBottom: 24, lineHeight: 1.5 }}>
              Your password has been updated successfully. You can now sign in with your new password.
            </p>
            <button
              className="mem-btn mem-btn-primary mem-btn-full"
              onClick={() => router.push("/members")}
            >
              Sign In.
            </button>
          </>
        ) : !token || !email ? (
          <>
            <div className="mem-brand-sub">Invalid Link</div>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24, lineHeight: 1.5 }}>
              This reset link is invalid or has expired. Please request a new one.
            </p>
            <button
              className="mem-btn mem-btn-primary mem-btn-full"
              onClick={() => router.push("/members")}
            >
              Back to Sign In
            </button>
          </>
        ) : (
          <>
            <div className="mem-brand-sub">New Password.</div>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
              Enter your new password below.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="mem-input"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleReset(); }}
              placeholder="Confirm password"
              className="mem-input"
            />
            {error && <p className="mem-err">{error}</p>}
            <button
              className="mem-btn mem-btn-primary mem-btn-full"
              onClick={handleReset}
              disabled={loading || !password || !confirm}
            >
              {loading ? "Resetting..." : "Reset Password."}
            </button>
            <p style={{ marginTop: 20, fontSize: 13, color: "var(--text-muted)" }}>
              <button
                onClick={() => router.push("/members")}
                style={{ background: "none", border: "none", color: "var(--primary)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline" }}
              >
                Back to Sign In
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
