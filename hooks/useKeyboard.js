import { useEffect } from "react";

export function useKeyboard({ onNewBooking, onRefresh, onFocusSearch }) {
  useEffect(() => {
    function handler(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "n") {
        e.preventDefault();
        onNewBooking();
      }
      if (e.key === "r") {
        e.preventDefault();
        onRefresh();
      }
      if (e.key === "/") {
        e.preventDefault();
        onFocusSearch();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNewBooking, onRefresh, onFocusSearch]);
}
