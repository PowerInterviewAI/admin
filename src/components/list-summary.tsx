import { cn } from "@/lib/utils";

export interface SummaryStat {
  label: string;
  value: string;
  /** One line of context under the number: what it is a share of, what it is measured over. */
  hint?: string;
  /** Draws the eye when the number means there is work outstanding. */
  alert?: boolean;
  /** For a value that is not a quantity - a timestamp, a name - which needs the room. */
  text?: boolean;
}

/**
 * The strip of numbers above a list table.
 *
 * Rendered by each route's server component rather than inside the client view, so the figures
 * never cross the boundary and cannot be recomputed in the browser against a different clock. Every
 * stat describes the rows the filters currently select, which is why the first one is labelled
 * "Matching ..." as soon as anything is narrowing the list.
 *
 * Cells are `flex-1`, so any number of them fills the row; the hairlines between them are the
 * container's own background showing through a one-pixel gap.
 */
export function ListSummary({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="stale-dim mb-4 flex flex-wrap gap-px overflow-hidden rounded-lg border bg-border">
      {stats.map((stat) => (
        <div key={stat.label} className="flex min-w-40 flex-1 flex-col gap-0.5 bg-card px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
          <span
            className={cn(
              stat.text
                ? "py-1 text-sm font-medium"
                : "text-xl font-semibold tracking-tight tabular-nums",
              stat.alert && "text-destructive",
            )}
          >
            {stat.value}
          </span>
          {/* A non-breaking space rather than nothing, so a hintless cell keeps the row's height. */}
          <span className="text-xs text-muted-foreground">{stat.hint ?? " "}</span>
        </div>
      ))}
    </div>
  );
}

/** How much of the matched set one of its parts is, for a stat's hint line. */
export function shareOf(part: number, whole: number, of = "matching"): string {
  if (whole <= 0) return "Nothing matched";
  const percent = (part / whole) * 100;
  // One decimal below 10%, so a single failure in a few thousand events does not read as "0%".
  return `${percent >= 10 || percent === 0 ? percent.toFixed(0) : percent.toFixed(1)}% of ${of}`;
}
