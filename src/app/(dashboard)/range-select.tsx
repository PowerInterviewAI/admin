"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { usePendingNavigation } from "@/components/navigation-progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  buildQueryString,
  dashboardSearchParamsSchema,
} from "@/lib/search-params";

const LABELS: Record<AnalyticsRange, string> = {
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
  180: "Last 180 days",
};

/**
 * The dashboard's window lives in the URL like every list view's filters do, so a particular view
 * of the numbers is linkable. Writing through `startTransition` keeps the current charts on screen
 * while the next set of aggregations runs, instead of dropping to the loading skeleton.
 */
/** `path` is the page the window belongs to: the dashboard, or the reseller overview. */
export function RangeSelect({ value, path = "/" }: { value: AnalyticsRange; path?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  usePendingNavigation(isPending);

  return (
    <Select
      value={String(value)}
      onValueChange={(next: string | null) => {
        if (!next) return;
        const days = Number(next) as AnalyticsRange;
        const href = `${path}${buildQueryString(dashboardSearchParamsSchema, { days })}`;
        startTransition(() => router.push(href, { scroll: false }));
      }}
    >
      <SelectTrigger className="w-40" aria-label="Reporting window">
        <SelectValue>
          {(current: string | null) =>
            current === null ? "" : (LABELS[Number(current) as AnalyticsRange] ?? `${current} days`)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ANALYTICS_RANGES.map((days) => (
          <SelectItem key={days} value={String(days)}>
            {LABELS[days]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
