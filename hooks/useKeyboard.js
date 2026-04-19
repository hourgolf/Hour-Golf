import { useEffect } from "react";

// Global admin keyboard shortcuts. Skips events whose target is an
// input/select/textarea so typing in forms doesn't trigger view jumps.
//
// Bindings (all lowercase, no modifier required):
//   n  → new booking
//   r  → refresh data
//   /  → focus the customer search
//   t  → jump back to today (TodayView, clears any history-date)
//   [  → previous day in TodayView
//   ]  → next day in TodayView
//   w  → switch to Week view
//   ?  → show the shortcut cheatsheet (handled by the host)
//
// All handlers are optional. The host passes only what it can wire.
export function useKeyboard({
  onNewBooking,
  onRefresh,
  onFocusSearch,
  onJumpToday,
  onPrevDay,
  onNextDay,
  onWeekView,
  onShowHelp,
}) {
  useEffect(() => {
    function handler(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      // Bail if a modifier is held — leaves Cmd+R, Ctrl+F etc. for the
      // browser. Only bare letters / brackets / slash trigger a shortcut.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "n":
          if (!onNewBooking) return;
          e.preventDefault(); onNewBooking(); break;
        case "r":
          if (!onRefresh) return;
          e.preventDefault(); onRefresh(); break;
        case "/":
          if (!onFocusSearch) return;
          e.preventDefault(); onFocusSearch(); break;
        case "t":
          if (!onJumpToday) return;
          e.preventDefault(); onJumpToday(); break;
        case "[":
          if (!onPrevDay) return;
          e.preventDefault(); onPrevDay(); break;
        case "]":
          if (!onNextDay) return;
          e.preventDefault(); onNextDay(); break;
        case "w":
          if (!onWeekView) return;
          e.preventDefault(); onWeekView(); break;
        case "?":
          if (!onShowHelp) return;
          e.preventDefault(); onShowHelp(); break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNewBooking, onRefresh, onFocusSearch, onJumpToday, onPrevDay, onNextDay, onWeekView, onShowHelp]);
}
