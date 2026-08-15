"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { LogOut } from "lucide-react";

import { useRevokeSession, useSessions } from "@/hooks/use-sessions";
import type { Session } from "@/lib/types";
import { PageHeader } from "@/components/custom/page-header";
import { DataTable } from "@/components/custom/data-table";
import { UserCell } from "@/components/custom/user-cell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 20;

export default function SessionsPage() {
  const [pageIndex, setPageIndex] = useState(0);
  const { data, isLoading, error, refetch } = useSessions({
    offset: pageIndex * PAGE_SIZE,
    limit: PAGE_SIZE,
  });
  const revokeSession = useRevokeSession();

  const columns = useMemo<ColumnDef<Session, unknown>[]>(
    () => [
      {
        accessorKey: "user_id",
        header: "User",
        cell: ({ row }) => <UserCell user={row.original.user} userId={row.original.user_id} />,
      },
      {
        accessorKey: "device_info",
        header: "Device",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm">{row.original.device_info.ip_address}</span>
            <span className="text-xs text-muted-foreground truncate max-w-md">
              {row.original.device_info.user_agent}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Started",
        cell: ({ row }) => formatDate(row.original.created_at),
      },
      {
        accessorKey: "updated_at",
        header: "Last active",
        cell: ({ row }) => formatDate(row.original.updated_at ?? row.original.created_at),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
              <LogOut data-icon="inline-start" />
              Revoke
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
                <AlertDialogDescription>
                  The user on {row.original.device_info.ip_address} will be signed out immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => revokeSession.mutate(row.original._id)}
                >
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ),
      },
    ],
    [revokeSession],
  );

  return (
    <div className="flex flex-col">
      <PageHeader title="Sessions" description="Active login sessions across all users." />
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        onPageChange={setPageIndex}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyMessage="No sessions found."
        getRowId={(row) => row._id}
      />
    </div>
  );
}
