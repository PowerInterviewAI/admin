"use client";

import {
  type ColumnDef,
  type Header,
  type SortingState,
  type Updater,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { SortDir } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";

export interface TablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface TableSorting {
  sortBy: string;
  sortDir: SortDir;
  onSortChange: (sortBy: string, sortDir: SortDir) => void;
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  /** True while the next page is being fetched: rows stay on screen, dimmed. */
  isPending?: boolean;
  /** Server-driven paging. Omit to render the rows as a complete list. */
  pagination?: TablePagination;
  /**
   * Server-driven sorting. Sorting is off for every column by default and a column opts in with
   * `enableSorting: true` - the sort key goes into the query, and offering a sort on a field the
   * query cannot order by would just return a confusingly ordered page.
   */
  sorting?: TableSorting;
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
  getRowId,
  onRowClick,
  emptyTitle = "No results",
  emptyMessage = "Nothing matched.",
  isPending,
  pagination,
  sorting,
}: DataTableProps<T>) {
  // Sorting defaults to off per column, the inverse of TanStack's default, so a new column is
  // never accidentally sortable by a key the server does not accept.
  const resolvedColumns = useMemo(
    () => columns.map((column) => ({ enableSorting: false, ...column })),
    [columns],
  );

  const sortingState = useMemo<SortingState>(
    () => (sorting ? [{ id: sorting.sortBy, desc: sorting.sortDir === "desc" }] : []),
    [sorting],
  );

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSorting: !!sorting,
    // The list is always ordered by something, matching the query's `created_at desc` default.
    enableSortingRemoval: false,
    pageCount: pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1,
    state: { sorting: sortingState },
    onSortingChange: (updater: Updater<SortingState>) => {
      if (!sorting) return;
      const next = typeof updater === "function" ? updater(sortingState) : updater;
      const first = next[0];
      if (first) {
        sorting.onSortChange(first.id, first.desc ? "desc" : "asc");
      }
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "overflow-x-auto rounded-lg border transition-opacity",
          isPending && "pointer-events-none opacity-60",
        )}
        aria-busy={isPending}
      >
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
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={resolvedColumns.length} className="h-48 text-center">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>{emptyTitle}</EmptyTitle>
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

      {pagination && <TablePager {...pagination} />}
    </div>
  );
}

function TablePager({ page, pageSize, total, onPageChange }: TablePagination) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total > 0
          ? `Showing ${formatNumber(rangeStart)}-${formatNumber(rangeEnd)} of ${formatNumber(total)}`
          : "0 results"}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {formatNumber(page)} of {formatNumber(pageCount)}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
