import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Shown wherever a query fails. Distinguishing this from the empty state matters: an unreachable
 * API rendering as "no results" reads as "this table is empty", which is the wrong conclusion to
 * hand an admin looking at user or payment data.
 */
export function QueryError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const reason = (error.message || "The admin API did not respond").replace(/\.$/, "");

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Could not load data</EmptyTitle>
        <EmptyDescription>
          {reason}. Check that the admin API is running on{" "}
          <code className="font-mono">{process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}</code>.
        </EmptyDescription>
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
