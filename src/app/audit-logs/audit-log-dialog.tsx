"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, titleCase } from "@/lib/format";
import type { AuditLog } from "@/lib/schemas/audit-log";

export function AuditLogDialog({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  return (
    <Dialog open={!!log} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{log ? titleCase(log.event_type) : ""}</DialogTitle>
          <DialogDescription>{log ? formatDate(log.created_at) : ""}</DialogDescription>
        </DialogHeader>
        {log && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <DetailRow label="Status" value={log.status} />
              <DetailRow label="Email" value={log.email ?? "—"} />
              <DetailRow label="User ID" value={log.user_id ?? "—"} />
              <DetailRow label="IP address" value={log.ip_address ?? "—"} />
            </div>
            {log.user_agent && <DetailRow label="User agent" value={log.user_agent} />}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Metadata</span>
              <pre className="max-h-64 overflow-x-auto overflow-y-auto rounded-md bg-muted p-3 text-xs">
                {log.metadata ? JSON.stringify(log.metadata, null, 2) : "null"}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-xs">{value}</span>
    </div>
  );
}
