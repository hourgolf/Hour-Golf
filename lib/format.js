import { TZ } from "./constants";

export function fT(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fD(d) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
}

export function fDL(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: TZ });
}

export function fDS(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}

export function lds(d) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function tds() {
  return lds(new Date());
}

export function mL(iso) {
  const d = new Date(iso);
  const n = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${n[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function hrs(n) {
  return Number(n).toFixed(1) + "h";
}

export function dlr(n) {
  return "$" + Number(n).toFixed(2);
}

export function allD(n) {
  return Number(n) >= 99999 ? "\u221e" : Number(n) + "h";
}
