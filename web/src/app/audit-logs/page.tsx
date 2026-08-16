import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { auditLogsSearchParamsSchema, parseSearchParams } from "@/lib/search-params";
import { listAuditLogs } from "@/server/queries/audit-logs";

import { AuditLogsView } from "./audit-logs-view";

export const metadata: Metadata = { title: "Audit Logs" };

export default async function AuditLogsPage({ searchParams }: PageProps<"/audit-logs">) {
  const params = parseSearchParams(auditLogsSearchParamsSchema, await searchParams);
  const page = await listAuditLogs(params);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Audit Logs"
        description="Every login, payment, and ASR event. Read-only."
      />
      <AuditLogsView params={params} page={page} />
    </div>
  );
}
