"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { RoleBadge } from "@/components/role-badge";
import { useCanWrite } from "@/components/session-context";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/format";
import type { AccountRow } from "@/lib/schemas/account";

import { AccountEditSheet } from "./account-edit-sheet";
import { NewAccountDialog } from "./new-account-dialog";

export function AccessView({
  accounts,
  currentAccountId,
}: {
  accounts: AccountRow[];
  currentAccountId: string;
}) {
  const canWrite = useCanWrite();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derived from the rendered rows rather than held in state, so an account edited through the
  // sheet shows its new role as soon as the action refreshes the server render.
  const selected = selectedId
    ? (accounts.find((account) => account._id === selectedId) ?? null)
    : null;

  /**
   * Built here rather than at module scope because the "You" marker needs the signed-in account's
   * id. That id is also why the columns are worth closing over: every rule in this panel turns on
   * whether a row is the caller's own.
   */
  const columns = useMemo<ColumnDef<AccountRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Account",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="flex items-center gap-2 font-medium">
              {row.original.name || "Unnamed"}
              {row.original._id === currentAccountId && (
                <Badge variant="secondary" className="font-normal">
                  You
                </Badge>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{row.original.email}</span>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
      },
      {
        accessorKey: "session_count",
        header: "Live sessions",
        cell: ({ row }) =>
          row.original.session_count > 0 ? (
            formatNumber(row.original.session_count)
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
      {
        accessorKey: "last_login_at",
        header: "Last sign-in",
        cell: ({ row }) =>
          row.original.last_login_at ? (
            formatDate(row.original.last_login_at)
          ) : (
            <span className="text-muted-foreground">Never</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: "Added",
        cell: ({ row }) => formatDate(row.original.created_at),
      },
    ],
    [currentAccountId],
  );

  return (
    <>
      <ReadOnlyNotice
        className="mb-4"
        message="Your account has read-only access, so these accounts can be viewed but not changed."
      />

      <DataTable
        columns={columns}
        data={accounts}
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedId(row._id)}
        emptyTitle="No accounts"
        emptyMessage="Nobody can sign in to this dashboard yet."
        // Five columns, all of them worth seeing: nothing here is wide or rare enough to hide.
        enableColumnToggle={false}
        toolbar={canWrite ? <NewAccountDialog /> : null}
      />

      <AccountEditSheet
        account={selected}
        isSelf={selected?._id === currentAccountId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
