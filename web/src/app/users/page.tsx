"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { useUsers } from "@/hooks/use-users";
import type { User, UserRole, UserStatus } from "@/lib/types";
import { PageHeader } from "@/components/custom/page-header";
import { DataTable } from "@/components/custom/data-table";
import { UserEditSheet } from "@/components/custom/user-edit-sheet";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, titleCase } from "@/lib/format";

const PAGE_SIZE = 20;

const ROLE_BADGE_VARIANT: Record<UserRole, "default" | "secondary" | "outline"> = {
  admin: "default",
  user: "secondary",
  trial_user: "outline",
};

export default function UsersPage() {
  const [pageIndex, setPageIndex] = useState(0);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<UserRole | "all">("all");
  const [status, setStatus] = useState<UserStatus | "all">("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useUsers({
    q: q || undefined,
    role: role === "all" ? undefined : role,
    status: status === "all" ? undefined : status,
    offset: pageIndex * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const columns = useMemo<ColumnDef<User, unknown>[]>(
    () => [
      {
        accessorKey: "username",
        header: "User",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.username}</span>
            <span className="text-xs text-muted-foreground">{row.original.email}</span>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <Badge variant={ROLE_BADGE_VARIANT[row.original.role]}>{titleCase(row.original.role)}</Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "active" ? "secondary" : "outline"}>
            {titleCase(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "credits",
        header: "Credits",
        cell: ({ row }) => formatNumber(row.original.credits),
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ row }) => formatDate(row.original.created_at),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      <PageHeader title="Users" description="Search, filter, and edit every account." />

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <Input
          placeholder="Search username or email..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPageIndex(0);
          }}
          className="max-w-xs"
        />
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v as UserRole | "all");
            setPageIndex(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Role">
              {(v: string) => (v === "all" ? "All roles" : titleCase(v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="trial_user">Trial User</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as UserStatus | "all");
            setPageIndex(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status">
              {(v: string) => (v === "all" ? "All statuses" : titleCase(v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
        emptyMessage="No users match these filters."
        getRowId={(row) => row._id}
        onRowClick={(row) => setSelectedUserId(row._id)}
      />

      <UserEditSheet
        userId={selectedUserId}
        open={!!selectedUserId}
        onOpenChange={(open) => !open && setSelectedUserId(null)}
      />
    </div>
  );
}
