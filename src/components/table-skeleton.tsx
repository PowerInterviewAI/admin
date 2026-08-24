import { Skeleton } from "@/components/ui/skeleton";

interface TablePageSkeletonProps {
  columns: number;
  rows?: number;
  filters?: number;
  /** How many quick-filter tabs sit above the filter row. Zero for a list that has none. */
  tabs?: number;
  /** The summary strip. Every list page has one; kept a prop so the shape stays describable. */
  summary?: boolean;
}

/** Shape of a list page while its first render streams in, used as each route's loading fallback. */
export function TablePageSkeleton({
  columns,
  rows = 8,
  filters = 0,
  tabs = 0,
  summary = true,
}: TablePageSkeletonProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 pb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>

      {summary && (
        <div className="mb-4 flex flex-wrap gap-px overflow-hidden rounded-lg border bg-border">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex min-w-40 flex-1 flex-col gap-2 bg-card px-4 py-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      )}

      {tabs > 0 && (
        <div className="mb-4 flex w-fit items-center gap-1 rounded-lg bg-muted p-0.75">
          {Array.from({ length: tabs }, (_, index) => (
            <Skeleton key={index} className="h-6 w-20" />
          ))}
        </div>
      )}

      {filters > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-4">
          {Array.from({ length: filters }, (_, index) => (
            <Skeleton key={index} className="h-9 w-40" />
          ))}
        </div>
      )}

      {/* The export and column-visibility strip the table renders above itself. */}
      <div className="flex items-center gap-2 pb-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center gap-4 border-b px-4 py-3">
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className="h-4 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
            {Array.from({ length: columns }, (_, index) => (
              <Skeleton key={index} className="h-5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
