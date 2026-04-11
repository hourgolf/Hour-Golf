import { useState, useCallback } from "react";
import { supa } from "../lib/supabase";

export function useAuth() {
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const connect = useCallback(async (key, onSuccess) => {
    if (!key) return;
    setError("");
    setLoading(true);
    try {
      const [members, bookings, tierCfg, usage, payments] = await Promise.all([
        supa(key, "members", "?order=name"),
        supa(key, "bookings", "?order=booking_start.desc&limit=5000"),
        supa(key, "tier_config", "?order=display_order"),
        supa(key, "monthly_usage", "?order=billing_month.desc,overage_charge.desc"),
        supa(key, "payments", "?order=created_at.desc").catch(() => []),
      ]);
      setApiKey(key);
      setConnected(true);
      if (typeof window !== "undefined") localStorage.setItem("hg-key", key);
      if (onSuccess) onSuccess({ members, bookings, tierCfg, usage, payments });
    } catch (e) {
      setError(`Failed: ${e.message}`);
      setConnected(false);
    }
    setLoading(false);
  }, []);

  return { apiKey, connected, loading, error, connect, setApiKey };
}
