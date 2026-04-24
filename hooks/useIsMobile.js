import { useEffect, useState } from "react";

// SSR-safe viewport detection. Returns false on server + first client
// render so hydration matches; flips to true on mount if the viewport
// is narrower than the breakpoint. Mobile-only behaviors (pull-to-
// refresh, swipe-to-action, bottom-sheet Detail) gate themselves on
// this so desktop never sees touch-only UI.
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, [breakpoint]);

  return isMobile;
}

export default useIsMobile;
