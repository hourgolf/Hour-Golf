import { useState, useEffect, useRef, useMemo } from "react";

// ---- date utilities ------------------------------------------------------

function pad2(n) { return String(n).padStart(2, "0"); }

function toISODate(y, monthIdx, d) {
  return `${y}-${pad2(monthIdx + 1)}-${pad2(d)}`;
}

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}

function todayInTZ(tz) {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function formatDisplay(iso) {
  const { y, m, d } = parseISODate(iso);
  // Noon local time dodges DST rollover weirdness for display only.
  const dt = new Date(y, m, d, 12);
  return dt.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// Accept free-form typed input in a handful of common US date formats
// and normalize to our canonical YYYY-MM-DD. Returns "" for an empty
// string (caller treats as clear), null for unparseable.
function tryParseTypedDate(text) {
  const s = (text || "").trim();
  if (!s) return "";

  // YYYY-MM-DD (our canonical — also what type="date" inputs emit)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validateISO(`${m[1]}-${pad2(m[2])}-${pad2(m[3])}`);

  // MM/DD/YYYY and M/D/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return validateISO(`${m[3]}-${pad2(m[1])}-${pad2(m[2])}`);

  // MM/DD/YY — 2-digit year. <=49 -> 20YY, 50+ -> 19YY. Matches how
  // browsers and most US business apps disambiguate.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const yy = Number(m[3]);
    const yyyy = yy <= 49 ? 2000 + yy : 1900 + yy;
    return validateISO(`${yyyy}-${pad2(m[1])}-${pad2(m[2])}`);
  }

  // MM-DD-YYYY (some users do this)
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return validateISO(`${m[3]}-${pad2(m[1])}-${pad2(m[2])}`);

  return null;
}

// Reject ISOs that aren't a real calendar date (e.g. 2024-02-30).
function validateISO(iso) {
  const { y, m, d } = parseISODate(iso);
  if (y < 1 || m < 0 || m > 11 || d < 1) return null;
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
  return iso;
}

function daysInMonth(y, monthIdx) {
  return new Date(y, monthIdx + 1, 0).getDate();
}

// JS getDay(): Sunday=0..Saturday=6.  Monday-first remap: Mon=0..Sun=6.
function mondayFirstWeekday(jsDay) {
  return (jsDay + 6) % 7;
}

const WEEKDAYS_MON_FIRST = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---- component -----------------------------------------------------------

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  timezone = "America/Los_Angeles",
  placeholder = "Pick a date",
}) {
  const today = todayInTZ(timezone);
  // Clamp the initial view into [min, max] so wide-range pickers (e.g.
  // birthday: max = today - 18y) don't open showing a fully-disabled
  // month with the user wondering what to click.
  function clampToRange(iso) {
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
  }
  const initial = clampToRange(value || today);
  const { y: initY, m: initM } = parseISODate(initial);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: initY, m: initM });
  const [focusedISO, setFocusedISO] = useState(initial);
  // typedText tracks what the user has typed since focusing the input;
  // null means "show the formatted value, input isn't being edited".
  const [typedText, setTypedText] = useState(null);

  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const gridRef = useRef(null);

  // Sync view + focus when value changes externally (e.g. today changes at midnight).
  useEffect(() => {
    if (!value) return;
    const { y, m } = parseISODate(value);
    setView({ y, m });
    setFocusedISO(value);
    // External value change wins over anything the user typed; clear
    // the typed buffer so the input renders the formatted display.
    setTypedText(null);
  }, [value]);

  // Escape + outside-click while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Move DOM focus to the focused cell whenever it changes while open.
  useEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector(`[data-iso="${focusedISO}"]`);
    el?.focus({ preventScroll: true });
  }, [open, focusedISO]);

  function openPicker() {
    const start = clampToRange(value || today);
    const { y, m } = parseISODate(start);
    setView({ y, m });
    setFocusedISO(start);
    setOpen(true);
  }

  function isDisabled(iso) {
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  }

  function selectDate(iso) {
    if (isDisabled(iso)) return;
    onChange(iso);
    setTypedText(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  // Commit whatever the user typed on blur or Enter. Invalid input is
  // left in place and visually flagged — we don't silently snap to a
  // "close" date.
  function commitTypedInput() {
    if (typedText === null) return;
    const parsed = tryParseTypedDate(typedText);
    if (parsed === null) {
      // Unparseable: keep the input open so the user can fix. The
      // parseError flag drives the red border below.
      return;
    }
    if (parsed === "") {
      onChange("");
      setTypedText(null);
      return;
    }
    if (min && parsed < min) return;
    if (max && parsed > max) return;
    onChange(parsed);
    setTypedText(null);
  }

  const typedParseAttempt = typedText !== null ? tryParseTypedDate(typedText) : null;
  const typedParseError = typedText !== null && typedText !== "" && (
    typedParseAttempt === null ||
    (min && typedParseAttempt && typedParseAttempt < min) ||
    (max && typedParseAttempt && typedParseAttempt > max)
  );

  function changeMonth(delta) {
    const next = new Date(view.y, view.m + delta, 1);
    setView({ y: next.getFullYear(), m: next.getMonth() });
  }

  function changeYear(delta) {
    setView({ y: view.y + delta, m: view.m });
  }

  function moveFocus(days) {
    const { y, m, d } = parseISODate(focusedISO);
    const next = new Date(y, m, d + days);
    const nextISO = toISODate(next.getFullYear(), next.getMonth(), next.getDate());
    if (isDisabled(nextISO)) return;
    setFocusedISO(nextISO);
    if (next.getFullYear() !== view.y || next.getMonth() !== view.m) {
      setView({ y: next.getFullYear(), m: next.getMonth() });
    }
  }

  function onGridKeyDown(e) {
    switch (e.key) {
      case "ArrowLeft":  e.preventDefault(); moveFocus(-1); break;
      case "ArrowRight": e.preventDefault(); moveFocus(1);  break;
      case "ArrowUp":    e.preventDefault(); moveFocus(-7); break;
      case "ArrowDown":  e.preventDefault(); moveFocus(7);  break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectDate(focusedISO);
        break;
      default: break;
    }
  }

  // 6 x 7 = 42 cells, Monday-first, with leading/trailing days from adjacent months.
  const grid = useMemo(() => {
    const { y, m } = view;
    const firstDow = mondayFirstWeekday(new Date(y, m, 1).getDay());
    const thisMonthDays = daysInMonth(y, m);
    const prevMonthDays = daysInMonth(y, m - 1);
    const cells = [];
    for (let i = firstDow - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const dt = new Date(y, m - 1, day);
      cells.push({ iso: toISODate(dt.getFullYear(), dt.getMonth(), day), day, inMonth: false });
    }
    for (let d = 1; d <= thisMonthDays; d++) {
      cells.push({ iso: toISODate(y, m, d), day: d, inMonth: true });
    }
    let nd = 1;
    while (cells.length < 42) {
      const dt = new Date(y, m + 1, nd);
      cells.push({ iso: toISODate(dt.getFullYear(), dt.getMonth(), nd), day: nd, inMonth: false });
      nd++;
    }
    return cells;
  }, [view]);

  const firstOfView = toISODate(view.y, view.m, 1);
  const lastOfView  = toISODate(view.y, view.m, daysInMonth(view.y, view.m));
  const canPrev = !min || firstOfView > min;
  const canNext = !max || lastOfView < max;
  // Year nav: at least one day of the target year must be in [min, max].
  // For booking's 7-day window, both will usually be false (good — keeps
  // the buttons inert there). For wider ranges (birthday, reports) they
  // light up.
  const firstOfPrevYear = toISODate(view.y - 1, 0, 1);
  const lastOfPrevYear  = toISODate(view.y - 1, 11, 31);
  const firstOfNextYear = toISODate(view.y + 1, 0, 1);
  const lastOfNextYear  = toISODate(view.y + 1, 11, 31);
  const canPrevYear = (!max || firstOfPrevYear <= max) && (!min || lastOfPrevYear >= min);
  const canNextYear = (!max || firstOfNextYear <= max) && (!min || lastOfNextYear >= min);

  return (
    <div className="hg-datepicker">
      <div
        ref={triggerRef}
        className={`hg-dp-trigger ${typedParseError ? "hg-dp-trigger--error" : ""}`}
      >
        <input
          ref={inputRef}
          type="text"
          className="hg-dp-input"
          value={typedText !== null ? typedText : (value ? formatDisplay(value) : "")}
          placeholder={placeholder}
          onFocus={() => {
            // Enter "editing" mode — blank the input for typing if
            // nothing is set, else show ISO for easier editing.
            if (typedText === null) {
              setTypedText(value || "");
              // Defer selectAll so the browser sees the new value.
              setTimeout(() => inputRef.current?.select(), 0);
            }
          }}
          onChange={(e) => setTypedText(e.target.value)}
          onBlur={commitTypedInput}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTypedInput();
            } else if (e.key === "Escape") {
              setTypedText(null);
              inputRef.current?.blur();
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
        />
        <button
          type="button"
          className="hg-dp-trigger-icon-btn"
          onClick={() => (open ? setOpen(false) : openPicker())}
          aria-label={open ? "Close calendar" : "Open calendar"}
          title={open ? "Close calendar" : "Open calendar"}
        >
          <svg className="hg-dp-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8"  y1="2" x2="8"  y2="6" />
            <line x1="3"  y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="hg-dp-popover" ref={popoverRef} role="dialog" aria-label="Choose a date">
          <div className="hg-dp-head">
            <div className="hg-dp-nav-group">
              <button
                type="button"
                className="hg-dp-nav"
                onClick={() => changeYear(-1)}
                disabled={!canPrevYear}
                aria-label="Previous year"
                title="Previous year"
              >
                &laquo;
              </button>
              <button
                type="button"
                className="hg-dp-nav"
                onClick={() => changeMonth(-1)}
                disabled={!canPrev}
                aria-label="Previous month"
                title="Previous month"
              >
                &lsaquo;
              </button>
            </div>
            <div className="hg-dp-month">{MONTHS[view.m]} {view.y}</div>
            <div className="hg-dp-nav-group">
              <button
                type="button"
                className="hg-dp-nav"
                onClick={() => changeMonth(1)}
                disabled={!canNext}
                aria-label="Next month"
                title="Next month"
              >
                &rsaquo;
              </button>
              <button
                type="button"
                className="hg-dp-nav"
                onClick={() => changeYear(1)}
                disabled={!canNextYear}
                aria-label="Next year"
                title="Next year"
              >
                &raquo;
              </button>
            </div>
          </div>

          <div className="hg-dp-weekdays">
            {WEEKDAYS_MON_FIRST.map((w, i) => (
              <div key={i} className="hg-dp-weekday">{w}</div>
            ))}
          </div>

          <div className="hg-dp-grid" ref={gridRef} role="grid" onKeyDown={onGridKeyDown}>
            {grid.map((cell) => {
              const disabled = isDisabled(cell.iso);
              const selected = cell.iso === value;
              const isToday  = cell.iso === today;
              const focused  = cell.iso === focusedISO;
              const cls = [
                "hg-dp-cell",
                selected && "selected",
                isToday && "today",
                !cell.inMonth && "out",
                disabled && "disabled",
              ].filter(Boolean).join(" ");
              return (
                <button
                  type="button"
                  key={cell.iso}
                  data-iso={cell.iso}
                  className={cls}
                  onClick={() => selectDate(cell.iso)}
                  disabled={disabled}
                  tabIndex={focused ? 0 : -1}
                  aria-selected={selected}
                  aria-current={isToday ? "date" : undefined}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div className="hg-dp-foot">
            <button
              type="button"
              className="hg-dp-today"
              onClick={() => selectDate(today)}
              disabled={isDisabled(today)}
            >
              Today
            </button>
            <button
              type="button"
              className="hg-dp-close"
              onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
