"use client";

import {
  type ColumnDef,
  type Header,
  type OnChangeFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { QueryError } from "@/components/custom/query-error";
import { formatNumber } from "@/lib/format";

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total: number;
  pageIndex: number;
  pageSize: number;
  onPageChange: (pageIndex: number) => void;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  emptyMessage?: string;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Sorting is server-side: pass both to enable it, and opt columns in with `enableSorting`. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
}

function HeaderContent<T>({ header }: { header: Header<T, unknown> }) {
  const content = flexRender(header.column.columnDef.header, header.getContext());

  if (!header.column.getCanSort()) {
    return content;
  }

  const direction = header.column.getIsSorted();
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  const label =
    typeof header.column.columnDef.header === "string"
      ? header.column.columnDef.header
      : header.column.id;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 h-8 px-2 data-[sorted=true]:text-foreground"
      data-sorted={!!direction}
      onClick={header.column.getToggleSortingHandler()}
      aria-label={`Sort by ${label}, currently ${direction || "unsorted"}`}
    >
      {content}
      <Icon className={direction ? undefined : "opacity-50"} />
    </Button>
  );
}

export function DataTable<T>({
  columns,
  data,
  total,
  pageIndex,
  pageSize,
  onPageChange,
  isLoading,
  error,
  onRetry,
  emptyMessage = "No results.",
  getRowId,
  onRowClick,
  sorting,
  onSortingChange,
}: DataTableProps<T>) {
  const sortable = !!sorting && !!onSortingChange;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSorting: sortable,
    enableSortingRemoval: false,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    getRowId: getRowId as ((row: T) => string) | undefined,
    state: sorting ? { sorting } : undefined,
    onSortingChange,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <HeaderContent header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48 text-center">
                  <QueryError error={error} onRetry={onRetry} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              Array.from({ length: pageSize > 8 ? 8 : pageSize }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((_col, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48 text-center">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No results</EmptyTitle>
                      <EmptyDescription>{emptyMessage}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div
        className="flex items-center justify-between text-sm text-muted-foreground"
        hidden={!!error}
      >
        <span>
          {total > 0
            ? `Showing ${formatNumber(rangeStart)}-${formatNumber(rangeEnd)} of ${formatNumber(total)}`
            : "0 results"}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page {pageIndex + 1} of {formatNumber(pageCount)}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={pageIndex + 1 >= pageCount}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
