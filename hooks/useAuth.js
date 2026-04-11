import { useState, useCallback, useEffect, useRef } from "react";
import { supabase, supa } from "../lib/supabase";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true); // initial session restore
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");
  const verifyingRef = useRef(false);

  const verifyAdmin = useCallback(async (s) => {
    if (!s?.access_token || !s?.user?.id) return false;
    try {
      const rows = await supa(
        s.access_token,
        "admins",
        `?user_id=eq.${s.user.id}&select=user_id`
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }, []);

  // Restore session on mount + listen for auth state changes
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (s) {
        const ok = await verifyAdmin(s);
        if (!mounted) return;
        if (ok) {
          setSession(s);
          setIsAdmin(true);
        } else {
          await supabase.auth.signOut();
          setSession(null);
          setIsAdmin(false);
        }
      }
      setAuthLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        if (!mounted) return;
        if (!s) {
          setSession(null);
          setIsAdmin(false);
          return;
        }
        // Skip duplicate verification when login() already verified.
        if (verifyingRef.current) return;
        const ok = await verifyAdmin(s);
        if (!mounted) return;
        if (ok) {
          setSession(s);
          setIsAdmin(true);
        } else {
          await supabase.auth.signOut();
          setSession(null);
          setIsAdmin(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [verifyAdmin]);

  const login = useCallback(async (email, password) => {
    setError("");
    setLoginLoading(true);
    verifyingRef.current = true;
    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: (email || "").trim(),
        password: password || "",
      });
      if (signInErr) throw signInErr;

      const ok = await verifyAdmin(data.session);
      if (!ok) {
        await supabase.auth.signOut();
        throw new Error("This account is not authorized as an admin.");
      }
      setSession(data.session);
      setIsAdmin(true);
    } catch (e) {
      setError(e.message || "Login failed");
      setSession(null);
      setIsAdmin(false);
    }
    verifyingRef.current = false;
    setLoginLoading(false);
  }, [verifyAdmin]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
  }, []);

  const apiKey = session?.access_token || "";
  const connected = !!session && isAdmin;

  return {
    apiKey,
    user: session?.user || null,
    connected,
    authLoading,
    loading: loginLoading,
    error,
    login,
    logout,
  };
}
