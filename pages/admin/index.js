import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { supaPost, supaPatch, supaDelete } from "../../lib/supabase";

// Per-request render so Vercel's Edge CDN never caches this tenant-branded
// page. See lib/no-cache-ssr.js for why this is required on every page
// that renders tenant branding.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
import { mL, lds, tds } from "../../lib/format";
import { useToast } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useData } from "../../hooks/useData";
import { useSettings } from "../../hooks/useSettings";
import { useKeyboard } from "../../hooks/useKeyboard";
import { useIsMobile } from "../../hooks/useIsMobile";

import Header from "../../components/layout/Header";
import Nav from "../../components/layout/Nav";
import NavMobile from "../../components/layout/NavMobile";
import Toast from "../../components/ui/Toast";
import Confirm from "../../components/ui/Confirm";
import CommandPalette from "../../components/ui/CommandPalette";
import ShortcutsHelp from "../../components/ui/ShortcutsHelp";
import Sheet from "../../components/ui/Sheet";

import LoginForm from "../../components/forms/LoginForm";
import BookingForm from "../../components/forms/BookingForm";
import SyncModal from "../../components/forms/SyncModal";
import TodayView from "../../components/views/TodayView";

// Non-default views are loaded on demand. TodayView stays eager because it
// renders on login + /?view=today is the default landing. The other eight
// views ship as separate chunks (saves ~1.5k LOC on the initial admin load).
// ssr:false is safe: the parent page is getServerSideProps with no-cache and
// every view reads from client-only auth state.
const dynLoading = () => <div className="loading">Loading…</div>;
const WeekView = dynamic(() => import("../../components/views/WeekView"), { loading: dynLoading, ssr: false });
const OverviewView = dynamic(() => import("../../components/views/OverviewView"), { loading: dynLoading, ssr: false });
const CustomersView = dynamic(() => import("../../components/views/CustomersView"), { loading: dynLoading, ssr: false });
const ConfigView = dynamic(() => import("../../components/views/ConfigView"), { loading: dynLoading, ssr: false });
const DetailView = dynamic(() => import("../../components/views/DetailView"), { loading: dynLoading, ssr: false });
const ReportsView = dynamic(() => import("../../components/views/ReportsView"), { loading: dynLoading, ssr: false });
const EventsView = dynamic(() => import("../../components/views/EventsView"), { loading: dynLoading, ssr: false });
const ShopAdminView = dynamic(() => import("../../components/views/ShopAdminView"), { loading: dynLoading, ssr: false });
const SettingsView = dynamic(() => import("../../components/views/SettingsView"), { loading: dynLoading, ssr: false });
const InboxView = dynamic(() => import("../../components/views/InboxView"), { loading: dynLoading, ssr: false });

export default function Dashboard() {
  const isMobile = useIsMobile();

  // Auth (email/password against Supabase Auth, gated by admins table)
  const { apiKey, user, connected, authLoading, loading, error, login, logout } = useAuth();

  // Data
  const data = useData(apiKey, connected);
  const { members, bookings, tierCfg, usage, payments, accessCodes, saving, setSaving, refresh } = data;

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
  const [viewDate, setViewDate] = useState(null); // null = today

  // Modals
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [editBk, setEditBk] = useState(null);
  const [cancTgt, setCancTgt] = useState(null);
  const [delTgt, setDelTgt] = useState(null);
  const [chgTgt, setChgTgt] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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

  // Inbox badge count — conflicts + past-due. Cheap derivations from
  // already-loaded data. Low-stock isn't included here because it
  // requires a separate query that the Inbox view owns; adding it
  // to the badge would mean keeping a third data stream in sync here.
  const inboxCount = useMemo(() => {
    const conflicts = bookings.filter((b) => b.conflict_detected_at).length;
    const pastDue = members.filter(
      (m) => m?.subscription_status === "past_due" || m?.subscription_status === "unpaid"
    ).length;
    return conflicts + pastDue;
  }, [bookings, members]);
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
        await logClientActivity("booking.edited", "booking", editBk.booking_id, {
          customer_name: bkData.customer_name || editBk.customer_name || null,
          member_email: bkData.customer_email || editBk.customer_email || null,
          start: bkData.booking_start || null,
          end: bkData.booking_end || null,
          bay: bkData.bay || null,
        });
        showToast("Updated");
        setEditBk(null);
      } else {
        const rows = await supaPost(apiKey, "bookings", bkData);
        const newId = Array.isArray(rows) && rows[0]?.booking_id ? rows[0].booking_id : null;
        await logClientActivity("booking.created", "booking", newId, {
          customer_name: bkData.customer_name || null,
          member_email: bkData.customer_email || null,
          start: bkData.booking_start || null,
          end: bkData.booking_end || null,
          bay: bkData.bay || null,
        });
        showToast("Added");
        setAddOpen(false);
      }
      await refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  }

  // Fire-and-forget audit log for admin actions that mutate via direct
  // PostgREST. Server-side admin-* routes log directly. See
  // lib/activity-log.js + pages/api/admin-log-activity.js.
  async function logClientActivity(action, targetType, targetId, metadata = null) {
    if (!apiKey) return;
    try {
      await fetch("/api/admin-log-activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ action, targetType, targetId, metadata }),
      });
    } catch (e) {
      // Never fail the caller on log errors.
      console.warn("activity log failed:", e?.message || e);
    }
  }

  async function cancelBooking() {
    if (!cancTgt) return;
    setSaving(true);
    try {
      await supaPatch(apiKey, "bookings", { booking_id: cancTgt.booking_id }, { booking_status: "Cancelled" });
      await logClientActivity("booking.cancelled", "booking", cancTgt.booking_id, {
        customer_name: cancTgt.customer_name || null,
        member_email: cancTgt.customer_email || null,
        start: cancTgt.booking_start || null,
        end: cancTgt.booking_end || null,
        bay: cancTgt.bay || null,
      });
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
      await logClientActivity("booking.deleted", "booking", delTgt.booking_id, {
        customer_name: delTgt.customer_name || null,
        member_email: delTgt.customer_email || null,
        start: delTgt.booking_start || null,
        end: delTgt.booking_end || null,
        bay: delTgt.bay || null,
      });
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
      await logClientActivity("booking.restored", "booking", b.booking_id, {
        customer_name: b.customer_name || null,
        member_email: b.customer_email || null,
        start: b.booking_start || null,
        end: b.booking_end || null,
        bay: b.bay || null,
      });
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
      // Server endpoint instead of direct PostgREST: it bypasses the
      // members RLS-INSERT policy with service-role and also looks up
      // an existing Stripe customer/subscription by email so a
      // migrated member (e.g. AllBooked → HG) gets linked instead of
      // orphaned. Read-only Stripe call — no charge ever fires here.
      const r = await fetch("/api/admin-update-tier", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ email, tier, name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || d.error || `Update failed (${r.status})`);
      showToast(
        d.linked_stripe
          ? `${name || email} → ${tier} (linked Stripe subscription)`
          : `${name || email} → ${tier}`
      );
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
      // Server owns the payments table INSERT now (see stripe-charge.js).
      // If it somehow failed server-side, surface it so the admin knows the
      // customer was charged but DB didn't capture it — rare, but possible.
      if (d.payments_row_recorded === false) {
        showToast(
          `Charged $${chgTgt.amount.toFixed(2)} but payments row NOT recorded (${d.payments_row_error || "unknown"}). Ping dev.`,
          "error"
        );
      } else {
        showToast(`Charged $${chgTgt.amount.toFixed(2)}`);
      }
      setChgTgt(null);
      await refresh();
    } catch (e) {
      showToast(`Failed: ${e.message}`, "error");
    }
    setSaving(false);
  }

  async function chargeNonMember(bookingId) {
    setSaving(true);
    try {
      const r = await fetch("/api/charge-nonmember", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      showToast(`Charged $${(d.amount_cents / 100).toFixed(2)} — ${d.customer_email}`);
      await refresh();
    } catch (e) {
      if (e.message === "Already charged") showToast("Already charged", "error");
      else showToast(`Failed: ${e.message}`, "error");
    }
    setSaving(false);
  }

  async function chargeNonMembersBatch() {
    setSaving(true);
    try {
      const r = await fetch("/api/charge-nonmembers-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      const msg = `Charged: ${d.summary.charged}, Failed: ${d.summary.failed}, Skipped: ${d.summary.skipped}`;
      showToast(msg, d.summary.failed > 0 ? "error" : undefined);
      await refresh();
    } catch (e) {
      showToast(`Batch failed: ${e.message}`, "error");
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

  // Date-nav helpers used by both the in-view buttons and the keyboard
  // shortcuts ([ / ] / t). Operate on viewDate (a YYYY-MM-DD string).
  // null means "today" — keep that representation so a viewer who just
  // hit `t` doesn't end up showing yesterday after a midnight rollover.
  function shiftViewDate(deltaDays) {
    const ref = viewDate ? new Date(`${viewDate}T12:00:00`) : new Date();
    ref.setDate(ref.getDate() + deltaDays);
    const next = ref.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    setViewDate(next === tds() ? null : next);
    setView("today");
  }
  function jumpToday() {
    setViewDate(null);
    setView("today");
  }

  // Keyboard shortcuts
  useKeyboard({
    onNewBooking: useCallback(() => openAdd(), []),
    onRefresh: useCallback(() => refresh(), [refresh]),
    onFocusSearch: useCallback(() => {
      setView("customers");
      setTimeout(() => { const el = document.querySelector(".search"); if (el) el.focus(); }, 100);
    }, []),
    onJumpToday: useCallback(jumpToday, []),
    onPrevDay: useCallback(() => shiftViewDate(-1), [viewDate]),
    onNextDay: useCallback(() => shiftViewDate(1), [viewDate]),
    onWeekView: useCallback(() => setView("week"), []),
    onCommandPalette: useCallback(() => setCmdKOpen(true), []),
    onShowHelp: useCallback(() => setHelpOpen(true), []),
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
          memberCount={members.filter((m) => m.tier && m.tier !== "Non-Member").length}
          onAddBooking={() => openAdd()}
          onRefresh={refresh}
          onSettings={() => setView("settings")}
          onHome={() => { setSelMember(null); setViewDate(null); setView("today"); }}
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
          inboxCount={inboxCount}
          detailName={detailName}
          onClearDetail={() => { setSelMember(null); setViewDate(null); }}
        />
        <NavMobile
          view={view}
          setView={setView}
          todayCount={todayBk.length}
          inboxCount={inboxCount}
          onClearDetail={() => { setSelMember(null); setViewDate(null); }}
        />
      </div>

      {saving && <div className="saving">Saving...</div>}

      {view === "inbox" && (
        <InboxView
          bookings={bookings}
          members={members}
          payments={payments}
          tierCfg={tierCfg}
          apiKey={apiKey}
          onSelectMember={selectMember}
          setView={setView}
          setCTier={setCTier}
        />
      )}

      {view === "today" && (
        <TodayView
          bookings={bookings}
          members={members}
          accessCodes={accessCodes}
          bayFilter={bayFilter}
          setBayFilter={setBayFilter}
          onEdit={setEditBk}
          onCancel={setCancTgt}
          onSelectMember={selectMember}
          targetDate={viewDate}
          onPrevDay={() => shiftViewDate(-1)}
          onNextDay={() => shiftViewDate(1)}
          onJumpToday={jumpToday}
          onBulkCancel={bulkCancel}
          onRefresh={refresh}
        />
      )}

      {view === "week" && (
        <WeekView
          bookings={bookings}
          members={members}
          weekOff={weekOff}
          setWeekOff={setWeekOff}
          onSelectMember={selectMember}
          onSelectDate={(dateStr) => { setViewDate(dateStr); setView("today"); }}
        />
      )}

      {view === "overview" && (
        <OverviewView
          usage={usage}
          payments={payments}
          members={members}
          bookings={bookings}
          tierCfg={tierCfg}
          selMonth={selMonth}
          setSelMonth={setSelMonth}
          onSelectMember={selectMember}
          onUpdateTier={updateTier}
          onChargeNonMember={chargeNonMember}
          onChargeNonMembersBatch={chargeNonMembersBatch}
          saving={saving}
        />
      )}

      {view === "customers" && (
        <CustomersView
          bookings={bookings}
          members={members}
          usage={usage}
          payments={payments}
          tierCfg={tierCfg}
          search={search}
          setSearch={setSearch}
          cSort={cSort}
          setCSort={setCSort}
          cTier={cTier}
          setCTier={setCTier}
          onSelectMember={selectMember}
          onUpdateTier={updateTier}
          onChargeNonMember={chargeNonMember}
          onChargeNonMembersBatch={chargeNonMembersBatch}
          saving={saving}
        />
      )}

      {view === "events" && (
        <EventsView apiKey={apiKey} />
      )}

      {view === "shop" && (
        <ShopAdminView apiKey={apiKey} />
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

      {view === "reports" && (
        <ReportsView
          members={members}
          bookings={bookings}
          tierCfg={tierCfg}
          payments={payments}
          apiKey={apiKey}
        />
      )}

      {view === "settings" && (
        <SettingsView
          settings={settings}
          updateSetting={updateSetting}
          apiKey={apiKey}
          user={user}
          onLogout={logout}
          onOpenSync={() => setSyncOpen(true)}
        />
      )}

      {/* Detail render strategy:
          • Desktop: full-width view (current behavior unchanged).
          • Mobile: render the Customers list underneath and slide
            DetailView up in a bottom sheet so the operator keeps
            list context. Closing the sheet drops back to Customers
            and clears selMember. */}
      {view === "detail" && !isMobile && (
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

      {view === "detail" && isMobile && (
        <CustomersView
          bookings={bookings}
          members={members}
          usage={usage}
          payments={payments}
          tierCfg={tierCfg}
          search={search}
          setSearch={setSearch}
          cSort={cSort}
          setCSort={setCSort}
          cTier={cTier}
          setCTier={setCTier}
          onSelectMember={selectMember}
          onUpdateTier={updateTier}
          onChargeNonMember={chargeNonMember}
          onChargeNonMembersBatch={chargeNonMembersBatch}
          saving={saving}
        />
      )}

      <Sheet
        open={isMobile && view === "detail" && !!selMember}
        onClose={() => { setSelMember(null); setView("customers"); }}
        ariaLabel={detailName ? `Detail for ${detailName}` : "Member detail"}
      >
        {selMember && (
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
      </Sheet>

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

      <SyncModal
        open={syncOpen}
        onClose={() => { setSyncOpen(false); refresh(); }}
        apiKey={apiKey}
      />

      <CommandPalette
        open={cmdKOpen}
        members={members}
        onClose={() => setCmdKOpen(false)}
        onSelect={(email) => {
          setCmdKOpen(false);
          selectMember(email);
        }}
      />

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      <Toast toast={toast} />

      {/* FAB buttons */}
      <button className="admin-fab admin-fab-booking" onClick={() => openAdd()} title="New Booking">+</button>
      <button className="admin-fab admin-fab-refresh" onClick={refresh} disabled={loading} title="Refresh">{"\u21BB"}</button>
      <button className="admin-fab admin-fab-settings" onClick={() => setView("settings")} title="Settings">*</button>
    </div>
  );
}
