"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { usePoll } from "@/hooks/use-poll";
import { cn } from "@/lib/utils";

/**
 * Every page here is a fresh read of the database, so a refresh costs that page's queries again.
 * Thirty seconds keeps the "right now" figures honest without an idle tab re-running the
 * dashboard's aggregations more often than anybody looks at them.
 */
export const AUTO_REFRESH_INTERVAL_MS = 30_000;

const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

const subscribe = () => () => {};

/**
 * A refresh re-renders the route with new props. An open edit sheet finds its record by id in
 * those props, so a row that moved off the page would close the sheet under a half-typed form.
 */
function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Re-renders the current route on an interval and shows when the data on screen was read.
 *
 * `at` is taken by the server during the render that produced the page, so it is the age of the
 * rows themselves rather than of the last time the browser asked - and it is what moves when a
 * server action's own `refresh()` lands, with nothing here having to hear about it.
 */
export function LiveRefresh({ at }: { at: number }) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  // The server formats in its own zone and locale, so the time is only rendered once hydrated.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const refresh = useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router]);

  const tick = useCallback(async () => {
    if (document.hidden || isDialogOpen()) return;
    refresh();
  }, [refresh]);

  usePoll(true, AUTO_REFRESH_INTERVAL_MS, tick);

  // A hidden tab skips its ticks, so coming back to one catches up at once instead of showing
  // old rows for up to another interval.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden || isDialogOpen()) return;
      if (Date.now() - at >= AUTO_REFRESH_INTERVAL_MS) refresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [at, refresh]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground tabular-nums"
      onClick={refresh}
      disabled={isRefreshing}
      title={`Refreshes every ${AUTO_REFRESH_INTERVAL_MS / 1000} seconds. Click to refresh now.`}
    >
      <RefreshCw data-icon="inline-start" className={cn(isRefreshing && "animate-spin")} />
      <span>
        Updated{" "}
        <time dateTime={new Date(at).toISOString()}>
          {hydrated ? timeFormatter.format(at) : ""}
        </time>
      </span>
    </Button>
  );
}
