import { Skeleton } from "@/components/ui/skeleton";

interface TablePageSkeletonProps {
  columns: number;
  rows?: number;
  filters?: number;
}

/** Shape of a list page while its first render streams in, used as each route's loading fallback. */
export function TablePageSkeleton({ columns, rows = 8, filters = 0 }: TablePageSkeletonProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 pb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>

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
