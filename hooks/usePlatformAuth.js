import { useState, useCallback, useEffect, useRef } from "react";
import { supabase, supa } from "../lib/supabase";

// Client-side auth hook for the /platform super-admin surface.
//
// Mirrors hooks/useAuth.js but checks platform_admins instead of admins.
// Shares the Supabase Auth singleton, which means a browser can only hold
// one active JWT at a time — if the same email is both a tenant admin
// and a platform admin, that's fine (same JWT, different backend checks);
// if they're different emails, logging into /platform clobbers the tenant
// admin session in the same browser. Acceptable for v1.
export function usePlatformAuth() {
  const [session, setSession] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");
  const verifyingRef = useRef(false);

  const verifyPlatformAdmin = useCallback(async (s) => {
    if (!s?.access_token || !s?.user?.id) return false;
    try {
      const rows = await supa(
        s.access_token,
        "platform_admins",
        `?user_id=eq.${s.user.id}&select=user_id`
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (s) {
        const ok = await verifyPlatformAdmin(s);
        if (!mounted) return;
        if (ok) {
          setSession(s);
          setIsPlatformAdmin(true);
        } else {
          setSession(null);
          setIsPlatformAdmin(false);
        }
      }
      setAuthLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        if (!mounted) return;
        if (!s) {
          setSession(null);
          setIsPlatformAdmin(false);
          return;
        }
        if (verifyingRef.current) return;
        const ok = await verifyPlatformAdmin(s);
        if (!mounted) return;
        if (ok) {
          setSession(s);
          setIsPlatformAdmin(true);
        } else {
          setSession(null);
          setIsPlatformAdmin(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [verifyPlatformAdmin]);

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

      const ok = await verifyPlatformAdmin(data.session);
      if (!ok) {
        await supabase.auth.signOut();
        throw new Error("This account is not authorized for the platform dashboard.");
      }
      setSession(data.session);
      setIsPlatformAdmin(true);
    } catch (e) {
      setError(e.message || "Login failed");
      setSession(null);
      setIsPlatformAdmin(false);
    }
    verifyingRef.current = false;
    setLoginLoading(false);
  }, [verifyPlatformAdmin]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setIsPlatformAdmin(false);
  }, []);

  const apiKey = session?.access_token || "";
  const connected = !!session && isPlatformAdmin;

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
