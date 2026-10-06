"use client";

import { DataError } from "@/components/data-error";
import { AUTO_REFRESH_INTERVAL_MS } from "@/components/live-refresh";
import { Card, CardContent } from "@/components/ui/card";
import { usePoll } from "@/hooks/use-poll";

/**
 * Every page in this app renders from a database read, so a page-level error is almost always a
 * database problem. `retry()` re-fetches and re-renders the segment on the server.
 *
 * It also retries by itself. Pages refresh on an interval, so a database blip now lands here on a
 * tab nobody is watching, and this panel replaces the header that did the refreshing - without
 * its own timer, one failed read would strand the tab until somebody clicked.
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  usePoll(true, AUTO_REFRESH_INTERVAL_MS, async () => {
    if (!document.hidden) retry();
  });

  return (
    <Card>
      <CardContent className="py-12">
        <DataError error={error} onRetry={retry} />
      </CardContent>
    </Card>
  );
}
