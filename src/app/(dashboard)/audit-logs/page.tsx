import type { Metadata } from "next";

import { ListSummary, shareOf } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatNumber } from "@/lib/format";
import {
  auditLogsSearchParamsSchema,
  countActiveFilters,
  parseSearchParams,
} from "@/lib/search-params";
import {
  countAuditLogsTabs,
  getAuditLogsSummary,
  listAuditLogs,
} from "@/server/queries/audit-logs";

import { AuditLogsView } from "./audit-logs-view";

export const metadata: Metadata = { title: "Audit Logs" };

export default async function AuditLogsPage({ searchParams }: PageProps<"/audit-logs">) {
  const params = parseSearchParams(auditLogsSearchParamsSchema, await searchParams);

  const [page, summary, tabCounts] = await Promise.all([
    listAuditLogs(params),
    getAuditLogsSummary(params),
    countAuditLogsTabs(params),
  ]);

  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Audit Logs"
        description="Every login, payment, and ASR event. Read-only."
      />

      <ListSummary
        stats={[
          {
            label: filtered ? "Matching events" : "Total events",
            value: formatNumber(summary.total),
          },
          {
            label: "Failures",
            value: formatNumber(summary.failures),
            hint: shareOf(summary.failures, summary.total),
            alert: summary.failures > 0,
          },
          {
            label: "Accounts involved",
            value: formatNumber(summary.users),
            hint: "Distinct users named",
          },
          {
            label: "IP addresses",
            value: formatNumber(summary.ips),
            hint: "Distinct sources",
          },
          {
            label: "Most recent",
            value: summary.latest ? formatDate(summary.latest) : "—",
            hint: "Newest matching event",
            text: true,
          },
        ]}
      />

      <AuditLogsView params={params} page={page} tabCounts={tabCounts} />
    </div>
  );
}
