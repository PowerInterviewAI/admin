import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { UserCell } from "@/components/user-cell";
import { formatDate, formatNumber, formatRate } from "@/lib/format";
import { LEDGER_KIND_LABELS, type ResellerSaleRow } from "@/lib/schemas/reseller";

/**
 * The sales table's columns, shared by the admin's history across every reseller and a reseller's
 * own portal - which passes `withReseller: false` and, being scoped to one account, has no use for
 * a column that would say the same name on every row.
 */
/** What the reseller's app said it charged. Ours to reconcile against, never what we bill. */
function reportedPrice(sale: ResellerSaleRow): string {
  if (sale.price_amount === null) return "";
  const amount = sale.price_amount.toFixed(2);
  return sale.price_currency ? `${amount} ${sale.price_currency}` : amount;
}

export function saleColumns(withReseller: boolean): ColumnDef<ResellerSaleRow, unknown>[] {
  return [
    {
      accessorKey: "committed_at",
      header: "When",
      enableSorting: true,
      cell: ({ row }) => formatDate(row.original.committed_at),
    },
    ...(withReseller
      ? [
          {
            id: "reseller",
            header: "Reseller",
            cell: ({ row }) =>
              row.original.reseller?.name || row.original.reseller?.email || "Deleted reseller",
          } satisfies ColumnDef<ResellerSaleRow, unknown>,
        ]
      : []),
    {
      accessorKey: "kind",
      header: "Kind",
      cell: ({ row }) => (
        <Badge variant={row.original.kind === "user_created" ? "secondary" : "outline"}>
          {LEDGER_KIND_LABELS[row.original.kind]}
        </Badge>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: ({ row }) =>
        row.original.user_id ? (
          <UserCell user={row.original.user} userId={row.original.user_id} />
        ) : (
          row.original.customer_email
        ),
    },
    {
      accessorKey: "credits",
      header: "Credits",
      enableSorting: true,
      cell: ({ row }) => formatNumber(row.original.credits),
    },
    {
      id: "rate",
      header: "Rate",
      cell: ({ row }) => formatRate(row.original.rate_cents_per_hour),
    },
    {
      accessorKey: "reference",
      header: "Reference",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? ""}</span>,
    },
    {
      accessorKey: "price_amount",
      header: "Reported price",
      enableSorting: true,
      cell: ({ row }) => reportedPrice(row.original),
    },
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
          {row.original.note ?? ""}
        </span>
      ),
    },
  ];
}
