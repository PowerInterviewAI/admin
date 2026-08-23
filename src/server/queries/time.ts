import "server-only";

export const MS_PER_DAY = 86_400_000;

/**
 * Node reads `TZ` for both `Intl` and `Date`'s local-time methods, so every day boundary in this
 * app - chart buckets, date filters, the "last 24 hours" thresholds - lands in the same zone.
 * Overriding the zone means setting `TZ`, not adding a new env var.
 */
export function reportingTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * A `YYYY-MM-DD` filter is a calendar day, not a UTC instant.
 *
 * `Date.parse("2026-08-17T00:00:00.000Z")` is UTC midnight, which west of Greenwich is the
 * afternoon of the 16th - so a "from 17 Aug" filter used to pull in several hours of the 16th while
 * the charts, which bucket in local time, disagreed about which day those rows belonged to. The
 * offset-less form is parsed as local time, which is the same zone `dayBucket` groups by.
 */
/**
 * A hand-edited URL can carry a date that matches `YYYY-MM-DD` and still does not exist. JavaScript
 * does not reject those - it rolls them over, so `2026-02-31` becomes 3 March and the page quietly
 * answers a question nobody asked. Checking that the parsed date reports back the same calendar day
 * is what turns that into "ignore this filter", which is how every other stale param degrades.
 */
function parseLocalDay(day: string, endOfDay: boolean): number | undefined {
  const date = new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  if (Number.isNaN(date.getTime())) return undefined;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  const roundTrip = `${date.getFullYear()}-${month}-${dayOfMonth}`;

  return roundTrip === day ? date.getTime() : undefined;
}

export function dayRangeMs(
  from?: string,
  to?: string,
): { $gte?: number; $lte?: number } | undefined {
  const range: { $gte?: number; $lte?: number } = {};

  const start = from ? parseLocalDay(from, false) : undefined;
  const end = to ? parseLocalDay(to, true) : undefined;
  if (start !== undefined) range.$gte = start;
  if (end !== undefined) range.$lte = end;

  return Object.keys(range).length > 0 ? range : undefined;
}

/** Local midnight `daysAgo` days back, as unix ms. Day 0 is the start of today. */
export function startOfLocalDay(daysAgo = 0): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.getTime() - daysAgo * MS_PER_DAY;
}
