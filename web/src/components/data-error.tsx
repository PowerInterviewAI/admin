"use client";

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
 * Shown whenever a page fails to read the database. Distinguishing this from the empty state
 * matters: an unreachable database rendering as "no results" reads as "this table is empty", which
 * is the wrong conclusion to hand an admin looking at user or payment data.
 */
export function DataError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const reason = (error.message || "The database did not respond").replace(/\.$/, "");

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Could not load data</EmptyTitle>
        <EmptyDescription>
          {reason}. Check that MongoDB is reachable at the <code className="font-mono">MONGO_URL</code>{" "}
          in your <code className="font-mono">.env.local</code>.
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
