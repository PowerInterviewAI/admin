"use client";

import {
  type ColumnDef,
  type Header,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
} from "lucide-react";
import { useMemo, useState } from "react";

import { PageSizeSelect } from "@/components/filters";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** Omit to render a fixed page size with no selector. */
  onPageSizeChange?: (pageSize: number) => void;
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
  /** Rendered on the left of the toolbar strip above the table (an export button, say). */
  toolbar?: React.ReactNode;
  /** Column ids hidden until an admin turns them on. Wide, rarely-needed columns belong here. */
  defaultHiddenColumns?: string[];
  /** Set false for tables with too few columns for hiding any to be useful. */
  enableColumnToggle?: boolean;
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
  toolbar,
  defaultHiddenColumns,
  enableColumnToggle = true,
}: DataTableProps<T>) {
  // Sorting defaults to off per column, the inverse of TanStack's default, so a new column is
  // never accidentally sortable by a key the server does not accept.
  const resolvedColumns = useMemo(
    () => columns.map((column) => ({ enableSorting: false, ...column })),
    [columns],
  );

  // Column visibility is the one piece of table state that is *not* in the URL: it describes how
  // this admin likes to look at the table, not which rows they are looking at, and putting it in
  // the query string would make every shared link carry it.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries((defaultHiddenColumns ?? []).map((id) => [id, false])),
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
    state: { sorting: sortingState, columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: (updater: Updater<SortingState>) => {
      if (!sorting) return;
      const next = typeof updater === "function" ? updater(sortingState) : updater;
      const first = next[0];
      if (first) {
        sorting.onSortChange(first.id, first.desc ? "desc" : "asc");
      }
    },
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const showToolbar = !!toolbar || enableColumnToggle;

  return (
    <div className="flex flex-col gap-3">
      {showToolbar && (
        <div className="flex items-center gap-2">
          {toolbar}
          {enableColumnToggle && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" aria-label="Toggle columns" />}
                >
                  <Columns3 data-icon="inline-start" />
                  Columns
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-44">
                  {/* The group is not decoration: `DropdownMenuLabel` is Base UI's
                      `Menu.GroupLabel`, which throws "MenuGroupContext is missing" outside a
                      `Menu.Group`. It labels the group for a screen reader, not the popup. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {table.getAllLeafColumns().map((column) => {
                      const header = column.columnDef.header;
                      // Only columns with a real text header are offered. An action column has no
                      // name to list, and hiding one would take away the row's only control.
                      if (typeof header !== "string" || !header) return null;
                      return (
                        <DropdownMenuCheckboxItem
                          key={column.id}
                          checked={column.getIsVisible()}
                          // The last visible column cannot be hidden: an empty table has no header
                          // row to turn anything back on from.
                          disabled={column.getIsVisible() && visibleColumnCount === 1}
                          onCheckedChange={(checked) => column.toggleVisibility(checked)}
                        >
                          {header}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}

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
                <TableCell colSpan={visibleColumnCount} className="h-48 text-center">
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
                  // A click-only row is unreachable without a mouse. The row is not a native
                  // control, so the keyboard affordance has to be spelled out.
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row.original);
                          }
                        }
                      : undefined
                  }
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

function TablePager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: TablePagination) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>
          {total > 0
            ? `Showing ${formatNumber(rangeStart)}-${formatNumber(rangeEnd)} of ${formatNumber(total)}`
            : "0 results"}
        </span>
        {onPageSizeChange && <PageSizeSelect value={pageSize} onChange={onPageSizeChange} />}
      </div>
      <div className="flex items-center gap-2">
        <span>
          Page {formatNumber(page)} of {formatNumber(pageCount)}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="First page"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft />
        </Button>
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
        <Button
          variant="outline"
          size="icon"
          aria-label="Last page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(pageCount)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}
