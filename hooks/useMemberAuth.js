import { useState, useEffect, useCallback } from "react";

export default function useMemberAuth() {
  const [member, setMember] = useState(null);
  const [tierConfig, setTierConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-session", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setMember(d.member);
        setTierConfig(d.tierConfig);
      } else {
        setMember(null);
        setTierConfig(null);
      }
    } catch (_) {
      setMember(null);
      setTierConfig(null);
    }
    setLoading(false);
  }

  // login + signup both RETURN the error message directly in the result
  // object instead of relying on the shared `error` state to flow back to
  // callers. The shared-state pattern had a stale-closure bug: handleLogin
  // in MemberLayout would read `error` from its render-frozen closure,
  // which still held the previous render's value, so a freshly failed
  // attempt would show the prior attempt's error text. Returning the
  // message directly is race-free.
  async function login(email, password, rememberMe = false) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/member-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Login failed");
      setMember(d.member);
      setTierConfig(d.tierConfig);
      setLoading(false);
      return { ok: true };
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return { ok: false, error: e.message };
    }
  }

  async function signup({ email, password, name, phone, birthday }) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/member-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name, phone, birthday }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Signup failed");
      setMember(d.member);
      setTierConfig(d.tierConfig);
      setLoading(false);
      return { ok: true };
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return { ok: false, error: e.message };
    }
  }

  async function completeAccount(password) {
    setError("");
    try {
      const r = await fetch("/api/member-complete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      // Refresh session to clear needsAccountSetup flag
      await checkSession();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function logout() {
    try {
      await fetch("/api/member-logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (_) { /* best effort */ }
    setMember(null);
    setTierConfig(null);
  }

  const refresh = useCallback(checkSession, []);

  return { member, tierConfig, loading, error, login, signup, completeAccount, logout, refresh };
}
