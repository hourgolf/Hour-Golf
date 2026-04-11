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
    try {
      const [members, bookings, tierCfg, usage, payments] = await Promise.all([
        supa(key, "members", "?order=name"),
        supa(key, "bookings", "?order=booking_start.desc&limit=5000"),
        supa(key, "tier_config", "?order=display_order"),
        supa(key, "monthly_usage", "?order=billing_month.desc,overage_charge.desc"),
        supa(key, "payments", "?order=created_at.desc").catch(() => []),
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
