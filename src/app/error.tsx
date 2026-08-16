"use client";

import { DataError } from "@/components/data-error";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Every page in this app renders from a database read, so a page-level error is almost always a
 * database problem. `reset()` re-renders the segment on the server, which is the retry.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <CardContent className="py-12">
        <DataError error={error} onRetry={reset} />
      </CardContent>
    </Card>
  );
}
