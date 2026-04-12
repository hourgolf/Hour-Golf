import { useState, useCallback, useMemo } from "react";
import { supaPost, supaPatch, supaDelete } from "../lib/supabase";
import { mL, lds, tds } from "../lib/format";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../hooks/useAuth";
import { useData } from "../hooks/useData";
import { useSettings } from "../hooks/useSettings";
import { useKeyboard } from "../hooks/useKeyboard";

import Header from "../components/layout/Header";
import Nav from "../components/layout/Nav";
import Toast from "../components/ui/Toast";
import Confirm from "../components/ui/Confirm";

import LoginForm from "../components/forms/LoginForm";
import BookingForm from "../components/forms/BookingForm";
import SyncModal from "../components/forms/SyncModal";
import SettingsPanel from "../components/settings/SettingsPanel";

import TodayView from "../components/views/TodayView";
import WeekView from "../components/views/WeekView";
import OverviewView from "../components/views/OverviewView";
import CustomersView from "../components/views/CustomersView";
import ConfigView from "../components/views/ConfigView";
import DetailView from "../components/views/DetailView";

export default function Dashboard() {
  // Auth (email/password against Supabase Auth, gated by admins table)
  const { apiKey, user, connected, authLoading, loading, error, login, logout } = useAuth();

  // Data
  const data = useData(apiKey, connected);
  const { members, bookings, tierCfg, usage, payments, saving, setSaving, refresh } = data;

  // Settings (cloud-synced when connected, localStorage when not)
  const { settings, updateSetting } = useSettings({ user, apiKey, connected });

  // Toast
  const { toast, show: showToast } = useToast();

  // UI state
  const [view, setView] = useState("today");
  const [selMember, setSelMember] = useState(null);
  const [selMonth, setSelMonth] = useState(null);
  const [search, setSearch] = useState("");
  const [bayFilter, setBayFilter] = useState("all");
  const [showCanc, setShowCanc] = useState(false);
  const [cSort, setCSort] = useState("hours");
  const [cTier, setCTier] = useState("all");
  const [weekOff, setWeekOff] = useState(0);

  // Modals
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [editBk, setEditBk] = useState(null);
  const [cancTgt, setCancTgt] = useState(null);
  const [delTgt, setDelTgt] = useState(null);
  const [chgTgt, setChgTgt] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  // Customer list for booking form autocomplete
  const custList = useMemo(() => {
    const m = {};
    bookings.forEach((b) => {
      if (!m[b.customer_email]) m[b.customer_email] = { email: b.customer_email, name: b.customer_name };
      if (b.customer_name) m[b.customer_email].name = b.customer_name;
    });
    return Object.values(m).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [bookings]);

  // Today stats for header
  const todayBk = useMemo(() => {
    const t = tds();
    return bookings.filter((b) => b.booking_status !== "Cancelled" && lds(new Date(b.booking_start)) === t);
  }, [bookings]);
  const todayHours = todayBk.reduce((s, b) => s + Number(b.duration_hours || 0), 0);

  // Detail tab name
  const detailName = useMemo(() => {
    if (!selMember) return null;
    const activeBk = bookings.filter((b) => b.booking_status !== "Cancelled");
    const c = activeBk.find((b) => b.customer_email === selMember);
    return c?.customer_name || selMember;
  }, [selMember, bookings]);

  // --- Actions ---
  function openAdd(email) {
    setAddEmail(email || "");
    setEditBk(null);
    setAddOpen(true);
  }

  function selectMember(email) {
    setSelMember(email);
    setView("detail");
  }

  async function saveBk(bkData) {
    setSaving(true);
    try {
      if (editBk) {
        await supaPatch(apiKey, "bookings", { booking_id: editBk.booking_id }, bkData);
        showToast("Updated");
        setEditBk(null);
      } else {
        await supaPost(apiKey, "bookings", bkData);
        showToast("Added");
        setAddOpen(false);
      }
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  async function cancelBooking() {
    if (!cancTgt) return;
    setSaving(true);
    try {
      await supaPatch(apiKey, "bookings", { booking_id: cancTgt.booking_id }, { booking_status: "Cancelled" });
      showToast("Cancelled");
      setCancTgt(null);
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  async function deleteBooking() {
    if (!delTgt) return;
    setSaving(true);
    try {
      await supaDelete(apiKey, "bookings", { booking_id: delTgt.booking_id });
      showToast("Deleted");
      setDelTgt(null);
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  async function restoreBooking(b) {
    setSaving(true);
    try {
      await supaPatch(apiKey, "bookings", { booking_id: b.booking_id }, { booking_status: "Confirmed" });
      showToast("Restored");
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  async function updateTier(email, tier, name) {
    setSaving(true);
    try {
      const ex = members.find((m) => m.email === email);
      if (ex) await supaPatch(apiKey, "members", { email }, { tier });
      else await supaPost(apiKey, "members", { email, name: name || email, tier });
      showToast(`${name || email} \u2192 ${tier}`);
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  async function chargeOverage() {
    if (!chgTgt) return;
    setSaving(true);
    try {
      const r = await fetch("/api/stripe-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          stripe_customer_id: chgTgt.stripe_customer_id,
          amount_cents: Math.round(chgTgt.amount * 100),
          description: `Hour Golf overage \u2014 ${mL(chgTgt.month)}`,
          member_email: chgTgt.email,
          billing_month: chgTgt.month,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      await supaPost(apiKey, "payments", {
        member_email: chgTgt.email,
        billing_month: chgTgt.month,
        amount_cents: Math.round(chgTgt.amount * 100),
        stripe_payment_intent_id: d.payment_intent_id,
        status: "succeeded",
        description: `Overage \u2014 ${mL(chgTgt.month)}`,
      });
      showToast(`Charged $${chgTgt.amount.toFixed(2)}`);
      setChgTgt(null);
      await refresh();
    } catch (e) {
      showToast(`Failed: ${e.message}`, "error");
    }
    setSaving(false);
  }

  async function saveTier(data, isNew) {
    setSaving(true);
    try {
      if (isNew) {
        await supaPost(apiKey, "tier_config", data);
        showToast(`Added tier: ${data.tier}`);
      } else {
        await supaPatch(apiKey, "tier_config", { tier: data.tier }, data);
        showToast(`Updated tier: ${data.tier}`);
      }
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  async function linkStripe(email, name) {
    try {
      const r = await fetch("/api/stripe-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      if (!d.found || !d.customers.length) {
        showToast(`No Stripe for ${email}`, "error");
        return;
      }
      await supaPatch(apiKey, "members", { email }, { stripe_customer_id: d.customers[0].id });
      showToast(`Linked ${name || email}`);
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function bulkCancel(ids) {
    setSaving(true);
    for (const id of ids) {
      try { await supaPatch(apiKey, "bookings", { booking_id: id }, { booking_status: "Cancelled" }); } catch {}
    }
    showToast(`Cancelled ${ids.length} bookings`);
    await refresh();
    setSaving(false);
  }

  async function bulkDelete(ids) {
    setSaving(true);
    for (const id of ids) {
      try { await supaDelete(apiKey, "bookings", { booking_id: id }); } catch {}
    }
    showToast(`Deleted ${ids.length} bookings`);
    await refresh();
    setSaving(false);
  }

  // Keyboard shortcuts
  useKeyboard({
    onNewBooking: useCallback(() => openAdd(), []),
    onRefresh: useCallback(() => refresh(), [refresh]),
    onFocusSearch: useCallback(() => {
      setView("customers");
      setTimeout(() => { const el = document.querySelector(".search"); if (el) el.focus(); }, 100);
    }, []),
  });

  // --- Render ---

  // While restoring session on mount, render nothing (avoids login flash)
  if (authLoading) {
    return <div className="setup"><div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading...</div></div>;
  }

  if (!connected) {
    return <LoginForm onLogin={login} loading={loading} error={error} />;
  }

  return (
    <div>
      <div className="sticky-top">
        <Header
          todayCount={todayBk.length}
          todayHours={todayHours}
          memberCount={members.length}
          onAddBooking={() => openAdd()}
          onRefresh={refresh}
          onSettings={() => setSettingsOpen(true)}
          onHome={() => { setSelMember(null); setView("today"); }}
          loading={loading}
          logoUrl={settings.logoUrl}
          logoScale={settings.logoScale}
          showLogo={settings.showLogo}
          showTitle={settings.showTitle}
          showSubtitle={settings.showSubtitle}
        />

        <Nav
          view={view}
          setView={setView}
          todayCount={todayBk.length}
          detailName={detailName}
          onClearDetail={() => { setSelMember(null); }}
        />
      </div>

      {saving && <div className="saving">Saving...</div>}

      {view === "today" && (
        <TodayView
          bookings={bookings}
          members={members}
          bayFilter={bayFilter}
          setBayFilter={setBayFilter}
          onEdit={setEditBk}
          onCancel={setCancTgt}
          onSelectMember={selectMember}
        />
      )}

      {view === "week" && (
        <WeekView
          bookings={bookings}
          weekOff={weekOff}
          setWeekOff={setWeekOff}
          onSelectMember={selectMember}
        />
      )}

      {view === "overview" && (
        <OverviewView
          usage={usage}
          payments={payments}
          members={members}
          bookings={bookings}
          selMonth={selMonth}
          setSelMonth={setSelMonth}
          onSelectMember={selectMember}
          onUpdateTier={updateTier}
        />
      )}

      {view === "customers" && (
        <CustomersView
          bookings={bookings}
          members={members}
          search={search}
          setSearch={setSearch}
          cSort={cSort}
          setCSort={setCSort}
          cTier={cTier}
          setCTier={setCTier}
          onSelectMember={selectMember}
          onUpdateTier={updateTier}
        />
      )}

      {view === "tiers" && (
        <ConfigView
          tierCfg={tierCfg}
          members={members}
          onUpdateTier={updateTier}
          onLinkStripe={linkStripe}
          onSaveTier={saveTier}
          onSelectMember={selectMember}
          jwt={apiKey}
        />
      )}

      {view === "detail" && (
        <DetailView
          selMember={selMember}
          members={members}
          bookings={bookings}
          usage={usage}
          payments={payments}
          apiKey={apiKey}
          bayFilter={bayFilter}
          setBayFilter={setBayFilter}
          showCanc={showCanc}
          setShowCanc={setShowCanc}
          saving={saving}
          onUpdateTier={updateTier}
          onEdit={setEditBk}
          onCancel={setCancTgt}
          onDelete={setDelTgt}
          onRestore={restoreBooking}
          onAddBooking={(email) => openAdd(email)}
          onChargeOverage={setChgTgt}
          onBulkCancel={bulkCancel}
          onBulkDelete={bulkDelete}
          onRefresh={refresh}
        />
      )}

      {/* Modals */}
      <BookingForm
        open={addOpen || !!editBk}
        onClose={() => { setAddOpen(false); setEditBk(null); }}
        onSave={saveBk}
        booking={editBk}
        customers={custList}
        presetEmail={addEmail}
      />

      <Confirm
        open={!!cancTgt}
        onClose={() => setCancTgt(null)}
        onOk={cancelBooking}
        title="Cancel Booking"
        msg={cancTgt ? `Cancel ${cancTgt.customer_name}'s booking on ${new Date(cancTgt.booking_start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })}?` : ""}
        detail="Monthly totals will update."
        label="Cancel Booking"
        danger
      />

      <Confirm
        open={!!delTgt}
        onClose={() => setDelTgt(null)}
        onOk={deleteBooking}
        title="Delete"
        msg="Permanently delete? Cannot undo."
        detail={delTgt ? `${delTgt.customer_name} \u2014 ${new Date(delTgt.booking_start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })}` : ""}
        label="Delete"
        danger
      />

      <Confirm
        open={!!chgTgt}
        onClose={() => setChgTgt(null)}
        onOk={chargeOverage}
        title="Charge Card"
        msg={chgTgt ? `Charge ${chgTgt.name || chgTgt.email} $${chgTgt.amount.toFixed(2)} for ${mL(chgTgt.month)} overage?` : ""}
        detail={chgTgt ? "Card on file via Stripe" : ""}
        label={`Charge $${chgTgt ? chgTgt.amount.toFixed(2) : "0"}`}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        updateSetting={updateSetting}
        apiKey={apiKey}
        user={user}
        onLogout={logout}
        onOpenSync={() => setSyncOpen(true)}
      />

      <SyncModal
        open={syncOpen}
        onClose={() => { setSyncOpen(false); refresh(); }}
        apiKey={apiKey}
      />

      <Toast toast={toast} />
    </div>
  );
}
