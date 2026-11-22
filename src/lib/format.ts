export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * A moment in UTC, as `2026-12-22 10:30 UTC`. For subscription end dates: backend grants passes as
 * UTC calendar months and the edit sheet picks dates in UTC, so the list must not show them in the
 * browser's zone, where an end near midnight lands on a different day than the sheet says.
 */
export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/**
 * Rough wall-clock length of a paced send, used to warn before a bulk run. Rounded up to whole
 * minutes past a minute: "about 9 minutes" sets the right expectation, "8m 47s" implies a
 * precision that per-recipient SMTP latency does not have.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * What a payment or a sale gives the customer: days of subscription, or credits on an order from
 * before subscriptions. Days win when both are set, since that is what was actually granted.
 */
export function formatGrant(days: number | null | undefined, credits: number | null | undefined): string {
  if (days) return `${formatNumber(days)} day${days === 1 ? "" : "s"}`;
  if (credits) return `${formatNumber(credits)} credits`;
  return "-";
}

/** What an order bought: calendar months for a pass, otherwise its legacy grant. */
export function formatPurchase(
  months: number,
  days: number | null | undefined,
  credits: number | null | undefined,
): string {
  if (months) return `${formatNumber(months)} month${months === 1 ? "" : "s"}`;
  return formatGrant(days, credits);
}

/** The plan id `yearly` is sold as Annual. */
export function planLabel(plan: string | null | undefined): string {
  return plan === "yearly" ? "Annual" : titleCase(plan);
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

