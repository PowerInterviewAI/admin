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
 * React replaces the message of anything thrown during a Server Component render with a generic
 * "Minified React error #441" in a production build, and moves the real one server-side behind a
 * `digest`. So in the build an admin actually runs, `error.message` says nothing about the cause -
 * and the digest is the only thread back to the matching line in the server log.
 */
const MASKED_MESSAGE = /Minified React error #\d+|omitted in production builds/i;

/**
 * Anything that means the database itself could not be reached. Matched rather than assumed,
 * because this component used to state it unconditionally: a schema mismatch between backend and
 * this app rendered as "check that MongoDB is reachable", which sent the reader after a database
 * that was answering the whole time.
 */
const CONNECTION_ERROR = /MONGO_URL|ECONNREFUSED|ETIMEDOUT|ServerSelection|querySrv|topology/i;

/**
 * Shown whenever a page fails to read the database. Distinguishing this from the empty state
 * matters: an unreachable database rendering as "no results" reads as "this table is empty", which
 * is the wrong conclusion to hand an admin looking at user or payment data.
 */
export function DataError({
  error,
  onRetry,
}: {
  error: Error & { digest?: string };
  onRetry?: () => void;
}) {
  const masked = MASKED_MESSAGE.test(error.message);
  const reason = masked
    ? "The server could not finish rendering this page"
    : (error.message || "The database did not respond").replace(/\.$/, "");

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>Could not load data</EmptyTitle>
        <EmptyDescription>
          {reason}.{" "}
          {!masked && CONNECTION_ERROR.test(error.message) && (
            <>
              Check that MongoDB is reachable at the{" "}
              <code className="font-mono">MONGO_URL</code> in your{" "}
              <code className="font-mono">.env.local</code>.
            </>
          )}
          {error.digest && (
            <>
              The server log records the real error under digest{" "}
              <code className="font-mono">{error.digest}</code>.
            </>
          )}
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
