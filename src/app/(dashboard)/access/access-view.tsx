"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, ShieldCheck, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { RoleBadge } from "@/components/role-badge";
import { useCan } from "@/components/session-context";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import type { AccountRow } from "@/lib/schemas/account";
import { setAccountStatus } from "@/server/actions/accounts";

import { AccountEditSheet } from "./account-edit-sheet";
import { NewAccountDialog } from "./new-account-dialog";

export function AccessView({
  accounts,
  currentAccountId,
}: {
  accounts: AccountRow[];
  currentAccountId: string;
}) {
  const canWrite = useCan("access:manage");
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
              {row.original.is_bootstrap && (
                <span
                  className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
                  title="Named by ADMIN_EMAIL. Re-asserted as an approved admin on every restart."
                >
                  <ShieldCheck className="size-3" />
                  Built-in
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{row.original.email}</span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Access",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
      {
        // Approving is the one thing on this page that happens often enough to deserve a control
        // in the row rather than two clicks through the sheet. Everything else stays in the sheet.
        id: "decide",
        header: undefined,
        cell: ({ row }) =>
          row.original.status === "pending" ? (
            <PendingDecision account={row.original} disabled={!canWrite} />
          ) : null,
      },
    ],
    [canWrite, currentAccountId],
  );

  return (
    <>
      <ReadOnlyNotice
        permission="access:manage"
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
        // Every column here is worth seeing, and the action column has no name to list anyway.
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

/**
 * Approve or reject, straight from the row.
 *
 * `stopPropagation` on the wrapper, not on each button: the row is clickable and opens the sheet,
 * and a decision made here should not also leave a sheet open over the table it just changed.
 */
function PendingDecision({ account, disabled }: { account: AccountRow; disabled: boolean }) {
  const [isDeciding, startDeciding] = useTransition();

  const decide = (status: "approved" | "rejected") => {
    startDeciding(async () => {
      const result = await setAccountStatus(account._id, { status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        status === "approved"
          ? `${account.email} can now sign in`
          : `${account.email} was rejected`,
      );
    });
  };

  return (
    <div
      className="flex justify-end gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button size="sm" disabled={disabled || isDeciding} onClick={() => decide("approved")}>
        <Check data-icon="inline-start" />
        Approve
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || isDeciding}
        onClick={() => decide("rejected")}
      >
        <X data-icon="inline-start" />
        Reject
      </Button>
    </div>
  );
}
