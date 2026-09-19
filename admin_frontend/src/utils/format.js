/**
 * Formatting helpers. Keep the timezone in sync with `timezone` in backend config.py.
 */
export const TIMEZONE = "Asia/Kolkata";

/**
 * The API stores UTC, but SQLite hands datetimes back WITHOUT a timezone suffix
 * ("2026-09-19T08:30:00"). JavaScript would read that as local time and every
 * clock would be off by the UTC offset. Treat a missing zone as UTC.
 */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = new Date(hasZone ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: TIMEZONE,
});

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TIMEZONE,
});

/** "2:45 pm" */
export function fmtTime(value) {
  const d = parseDate(value);
  return d ? timeFmt.format(d).replace(/\s?([AP]M)$/i, (_, m) => ` ${m.toLowerCase()}`) : "-";
}

/** "Saturday, 19 September" */
export function fmtToday(now = new Date()) {
  return dateFmt.format(now);
}

/** Whole minutes from `value` until now (negative = in the future). */
export function minutesSince(value, now = Date.now()) {
  const d = parseDate(value);
  return d ? Math.floor((now - d.getTime()) / 60000) : null;
}

/** "just now", "12 min ago", "1 h 5 min ago" */
export function fmtAgo(value, now = Date.now()) {
  const m = minutesSince(value, now);
  if (m === null) return "-";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

/** "About 25 min", "Under 1 min" */
export function fmtWait(minutes) {
  if (minutes === null || minutes === undefined) return "-";
  if (minutes < 1) return "Under 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${Math.round(minutes % 60)} min`;
}

/** "CAR-014" - same shape as Token.display_code on the backend. */
export function tokenCode(token, deptCode) {
  if (token?.display_code) return token.display_code;
  if (token?.code) return token.code;
  const n = String(token?.token_number ?? "").padStart(3, "0");
  return deptCode ? `${deptCode}-${n}` : `#${n}`;
}

export const PRIORITY = {
  0: { key: "emergency", label: "Emergency" },
  1: { key: "priority", label: "Priority" },
  2: { key: "normal", label: "Normal" },
};

export function priorityInfo(p) {
  return PRIORITY[p] ?? PRIORITY[2];
}

/** Maps a token to one of the design system's status badges. */
export function statusBadge(token) {
  const virtual = token.queue_type === "virtual";
  switch (token.status) {
    case "waiting":
      return virtual
        ? { cls: "badge-preregistered", label: "Booked" }
        : { cls: "badge-checkedin", label: "On site" };
    case "called":
      return { cls: "badge-called", label: "Called" };
    case "in_consultation":
      return { cls: "badge-consultation", label: "With doctor" };
    case "completed":
      return { cls: "badge-completed", label: "Completed" };
    case "no_show":
      return { cls: "badge-noshow", label: "No-show" };
    case "cancelled":
      return { cls: "badge-left", label: "Cancelled" };
    case "skipped":
      return { cls: "badge-left", label: "Skipped" };
    default:
      return { cls: "badge-left", label: String(token.status ?? "Unknown").replace(/_/g, " ") };
  }
}
