"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, formatRate, formatUsd, titleCase } from "@/lib/format";
import type { ResellerOverviewRow } from "@/lib/schemas/reseller";

import { ResellerSheet } from "./reseller-sheet";

const columns: ColumnDef<ResellerOverviewRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Reseller",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name || row.original.email}</span>
        <span className="text-xs text-muted-foreground">{row.original.email}</span>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Access",
    cell: ({ row }) => (
      <Badge variant={row.original.status === "approved" ? "secondary" : "destructive"}>
        {titleCase(row.original.status)}
      </Badge>
    ),
  },
  {
    id: "key",
    header: "API key",
    cell: ({ row }) =>
      row.original.key.prefix ? (
        <span className="font-mono text-xs">{row.original.key.prefix}...</span>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  },
  {
    id: "rate",
    header: "Rate",
    cell: ({ row }) => (
      <span className={row.original.rate_cents_per_hour === null ? "text-destructive" : undefined}>
        {formatRate(row.original.rate_cents_per_hour)}
      </span>
    ),
  },
  {
    accessorKey: "customers",
    header: "Customers",
    cell: ({ row }) => formatNumber(row.original.customers),
  },
  {
    accessorKey: "credits",
    header: "Credits",
    cell: ({ row }) => formatNumber(row.original.credits),
  },
  {
    id: "owed",
    header: "Owed now",
    cell: ({ row }) => (
      <span>
        {formatUsd(row.original.owed_open_cents / 100)}
        {row.original.unpriced_open_credits > 0 && (
          <span className="ml-1 text-xs text-destructive">
            + {formatNumber(row.original.unpriced_open_credits)} unpriced
          </span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "last_sale_at",
    header: "Last sale",
    cell: ({ row }) => formatDate(row.original.last_sale_at),
  },
];

export function ResellersView({ rows, days }: { rows: ResellerOverviewRow[]; days: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (rows.find((row) => row.id === selectedId) ?? null) : null;

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyTitle="No resellers yet"
        emptyMessage="Give an account the Reseller role from Access, and it will appear here."
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Customers and credits cover the last {days} days. Last sale and Owed now are not limited to
        the window: the first is the most recent sale ever, the second is every open settlement.
      </p>

      <ResellerSheet reseller={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
