"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { useAuditLogs } from "@/hooks/use-audit-logs";
import type { AuditEventType, AuditLog, AuditStatus } from "@/lib/types";
import { PageHeader } from "@/components/custom/page-header";
import { DataTable } from "@/components/custom/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, titleCase } from "@/lib/format";

const PAGE_SIZE = 25;

const EVENT_TYPES: AuditEventType[] = [
  "login",
  "logout",
  "signup",
  "password_change",
  "profile_update",
  "session_expire",
  "email_verification_requested",
  "email_verification_confirmed",
  "payment_created",
  "payment_webhook_received",
  "payment_completed",
  "payment_partially_paid",
  "payment_failed",
  "payment_error",
  "credits_applied",
  "asr_start",
  "asr_stop",
];

export default function AuditLogsPage() {
  const [pageIndex, setPageIndex] = useState(0);
  const [eventType, setEventType] = useState<AuditEventType | "all">("all");
  const [status, setStatus] = useState<AuditStatus | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const { data, isLoading, error, refetch } = useAuditLogs({
    event_type: eventType === "all" ? undefined : eventType,
    status: status === "all" ? undefined : status,
    from: from ? new Date(from).getTime() : undefined,
    to: to ? new Date(to).getTime() + 86_399_999 : undefined,
    offset: pageIndex * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const columns = useMemo<ColumnDef<AuditLog, unknown>[]>(
    () => [
      {
        accessorKey: "event_type",
        header: "Event",
        cell: ({ row }) => <span className="font-medium">{titleCase(row.original.event_type)}</span>,
      },
      {
        accessorKey: "email",
        header: "User",
        cell: ({ row }) => row.original.email ?? "—",
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
        accessorKey: "ip_address",
        header: "IP",
        cell: ({ row }) => row.original.ip_address ?? "—",
      },
      {
        accessorKey: "created_at",
        header: "When",
        cell: ({ row }) => formatDate(row.original.created_at),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      <PageHeader title="Audit Logs" description="Every login, payment, and ASR event. Read-only." />

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <Select
          value={eventType}
          onValueChange={(v) => {
            setEventType(v as AuditEventType | "all");
            setPageIndex(0);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Event type">
              {(v: string) => (v === "all" ? "All events" : titleCase(v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {EVENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {titleCase(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as AuditStatus | "all");
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
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failure">Failure</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPageIndex(0);
          }}
          className="w-40"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPageIndex(0);
          }}
          className="w-40"
        />
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
        emptyMessage="No audit events match these filters."
        getRowId={(row) => row._id}
        onRowClick={setSelected}
      />

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected ? titleCase(selected.event_type) : ""}</DialogTitle>
            <DialogDescription>{selected ? formatDate(selected.created_at) : ""}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <DetailRow label="Status" value={selected.status} />
                <DetailRow label="Email" value={selected.email ?? "—"} />
                <DetailRow label="User ID" value={selected.user_id ?? "—"} />
                <DetailRow label="IP address" value={selected.ip_address ?? "—"} />
              </div>
              {selected.user_agent && <DetailRow label="User agent" value={selected.user_agent} />}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Metadata</span>
                <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-64 overflow-y-auto">
                  {selected.metadata ? JSON.stringify(selected.metadata, null, 2) : "null"}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs break-all">{value}</span>
    </div>
  );
}
