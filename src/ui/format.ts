/**
 * Display formatting. Port of the desktop main_window helpers (_fmt_int,
 * _fmt_duration, _fmt_eta) plus a few browser-specific date helpers for the
 * editable capture-time field.
 */

/** Thousands-separated integer, or "-" for null/non-finite. */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) {
    return "-";
  }
  return Math.round(n).toLocaleString("en-US");
}

/** HH:MM:SS elapsed duration. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Human time-to-level: "3d 5h", "2h 14m", "12m", "<1m", or "-". */
export function fmtEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) {
    return `${d}d ${h}h`;
  }
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m`;
  }
  return "<1m";
}

/** Percent with two decimals, or "-". */
export function fmtPercent(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) {
    return "-";
  }
  return `${p.toFixed(2)}%`;
}

/** Local HH:MM:SS clock time for an epoch-seconds value. */
export function fmtClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour12: false });
}

/** Local "YYYY-MM-DD HH:MM:SS" for display in the records list. */
export function fmtDateTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Epoch seconds -> value for an <input type="datetime-local" step="1">. */
export function toDateTimeLocal(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Parse a datetime-local input value back to epoch seconds, or null. */
export function fromDateTimeLocal(value: string): number | null {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t / 1000 : null;
}
