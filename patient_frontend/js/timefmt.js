/**
 * QUEUE — Time formatting helpers (timefmt.js)
 * The backend sends every instant as ISO-8601 UTC plus the hospital's IANA timezone.
 * Always format with that timezone so the patient sees hospital-local times even if their
 * device is set to something else.
 */

/** 'YYYY-MM-DD' for a Date in the browser's local timezone (used for <input type="date">). */
export function localDateString(d = new Date()) {
  return d.toLocaleDateString('en-CA');
}

/** '4:00 PM' */
export function fmtClock(iso, tz) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {})
  });
}

/** '3:40 – 3:50 PM' (or '11:50 AM – 12:00 PM' when the window straddles noon) */
export function fmtWindow(fromIso, untilIso, tz) {
  const from = fmtClock(fromIso, tz);
  const until = fmtClock(untilIso, tz);
  const [fromTime, fromMeridiem] = from.split(' ');
  const [, untilMeridiem] = until.split(' ');
  return fromMeridiem === untilMeridiem
    ? `${fromTime} – ${until}`
    : `${from} – ${until}`;
}

/** 'Today' | 'Tomorrow' | 'Mon, 21 Sep' */
export function fmtDayLabel(iso, tz) {
  const opts = tz ? { timeZone: tz } : {};
  const day = new Date(iso).toLocaleDateString('en-CA', opts);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (day === today.toLocaleDateString('en-CA', opts)) return 'Today';
  if (day === tomorrow.toLocaleDateString('en-CA', opts)) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts
  });
}
