import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, formatUsd } from "@/lib/format";
import type { ResellerSettlementRow } from "@/lib/schemas/reseller";

/**
 * Shared by the admin's settlements page and a reseller's own portal, which passes
 * `withReseller: false` because every row there is theirs.
 */
export function settlementColumns(withReseller: boolean): ColumnDef<ResellerSettlementRow, unknown>[] {
  return [
    {
      accessorKey: "day",
      header: "Day (UTC)",
      enableSorting: true,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.day}</span>,
    },
    ...(withReseller
      ? [
          {
            id: "reseller",
            header: "Reseller",
            cell: ({ row }) =>
              row.original.reseller?.name || row.original.reseller?.email || "Deleted reseller",
          } satisfies ColumnDef<ResellerSettlementRow, unknown>,
        ]
      : []),
    {
      accessorKey: "users_created",
      header: "New customers",
      cell: ({ row }) => formatNumber(row.original.users_created),
    },
    {
      accessorKey: "credits",
      header: "Credits",
      enableSorting: true,
      cell: ({ row }) => formatNumber(row.original.credits),
    },
    {
      accessorKey: "amount_owed_cents",
      header: "Owed",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.amount_owed_cents === null ? (
          // Unknown rather than understated: part of the day was sold with no rate set.
          <span className="text-destructive">
            Unpriced ({formatNumber(row.original.unpriced_credits)} credits)
          </span>
        ) : (
          formatUsd(row.original.amount_owed_cents / 100)
        ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.status === "paid" ? "secondary" : "outline"}>
          {row.original.status === "paid" ? "Paid" : "Open"}
        </Badge>
      ),
    },
    {
      accessorKey: "paid_at",
      header: "Paid",
      cell: ({ row }) =>
        row.original.paid_at ? (
          <span className="text-sm">
            {formatDate(row.original.paid_at)}
            {row.original.paid_by && (
              <span className="block text-xs text-muted-foreground">{row.original.paid_by}</span>
            )}
          </span>
        ) : (
          ""
        ),
    },
  ];
}
