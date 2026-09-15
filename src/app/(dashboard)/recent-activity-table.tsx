"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate, titleCase } from "@/lib/format";
import type { AuditLog } from "@/lib/schemas/audit-log";

const columns: ColumnDef<AuditLog, unknown>[] = [
  {
    accessorKey: "event_type",
    header: "Event",
    cell: ({ row }) => <span className="font-medium">{titleCase(row.original.event_type)}</span>,
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.email ?? "—"}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.status === "success" ? "secondary" : "destructive"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "created_at",
    header: "When",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{formatDate(row.original.created_at)}</span>
    ),
  },
];

/**
 * The dashboard's activity feed is a fixed slice of the newest events, so it has no pager - and no
 * column toggle either: four columns inside a card is not a table anyone needs to rearrange, and
 * the control would sit above the card's own heading.
 */
export function RecentActivityTable({ entries }: { entries: AuditLog[] }) {
  return (
    <DataTable
      columns={columns}
      data={entries}
      getRowId={(row) => row._id}
      emptyTitle="No activity yet"
      emptyMessage="Nothing has been logged."
      enableColumnToggle={false}
    />
  );
}
