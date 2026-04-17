import { useState, useCallback, useEffect, useRef } from "react";
import { supa } from "../lib/supabase";

export function useData(apiKey, connected) {
  const [members, setMembers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [tierCfg, setTierCfg] = useState([]);
  const [usage, setUsage] = useState([]);
  const [payments, setPayments] = useState([]);
  const [saving, setSaving] = useState(false);
  const apiKeyRef = useRef(apiKey);

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  const setAll = useCallback((data) => {
    setMembers(data.members);
    setBookings(data.bookings);
    setTierCfg(data.tierCfg);
    setUsage(data.usage);
    setPayments(data.payments);
  }, []);

  const refresh = useCallback(async () => {
    const key = apiKeyRef.current;
    if (!key) return;
    // Scope every admin-dashboard read to the current tenant. SSR-injected
    // in _document.js alongside window.__TENANT_BRANDING__. Without this,
    // the RLS `admin_all` policy on members/bookings/etc. (EXISTS in admins
    // by user_id only, no tenant check) lets any authenticated admin see
    // every tenant's rows — a real cross-tenant leak that surfaced once
    // Parts Dept rows appeared alongside Hour Golf's in the admin list.
    //
    // monthly_usage is intentionally NOT filtered here: it's a view that
    // does not expose tenant_id as a column, so PostgREST can't filter on
    // it. Fixing requires a view recreate and is tracked as tech debt
    // alongside the broader RLS hardening (admin_all policy scoping).
    const tid =
      (typeof window !== "undefined" && window.__TENANT_ID__) || "";
    const tenantQ = tid ? `tenant_id=eq.${encodeURIComponent(tid)}&` : "";
    try {
      const [members, bookings, tierCfg, usage, payments] = await Promise.all([
        supa(key, "members", `?${tenantQ}order=name`),
        supa(key, "bookings", `?${tenantQ}order=booking_start.desc&limit=5000`),
        supa(key, "tier_config", `?${tenantQ}order=display_order`),
        supa(key, "monthly_usage", "?order=billing_month.desc,overage_charge.desc"),
        supa(key, "payments", `?${tenantQ}order=created_at.desc`).catch(() => []),
      ]);
      setAll({ members, bookings, tierCfg, usage, payments });
    } catch (e) {
      console.error("Refresh failed:", e);
    }
  }, [setAll]);

  // Initial fetch when connected becomes true (after login or session restore)
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  // Auto-refresh every 60s while connected
  useEffect(() => {
    if (!connected) return;
    const iv = setInterval(refresh, 60000);
    return () => clearInterval(iv);
  }, [connected, refresh]);

  return {
    members, bookings, tierCfg, usage, payments,
    saving, setSaving,
    setAll, refresh,
    setMembers, setBookings, setTierCfg, setUsage, setPayments,
  };
}
