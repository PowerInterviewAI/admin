import type { Metadata } from "next";

import { ListSummary, shareOf } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatNumber } from "@/lib/format";
import {
  countActiveFilters,
  parseSearchParams,
  sessionsSearchParamsSchema,
} from "@/lib/search-params";
import { countSessionsTabs, getSessionsSummary, listSessions } from "@/server/queries/sessions";

import { SessionsView } from "./sessions-view";

export const metadata: Metadata = { title: "Sessions" };

export default async function SessionsPage({ searchParams }: PageProps<"/sessions">) {
  const params = parseSearchParams(sessionsSearchParamsSchema, await searchParams);

  const [page, summary, tabCounts] = await Promise.all([
    listSessions(params),
    getSessionsSummary(params),
    countSessionsTabs(params),
  ]);

  const filtered = countActiveFilters(params) > 0;
  const perUser = summary.users > 0 ? summary.total / summary.users : 0;

  return (
    <div className="flex flex-col">
      <PageHeader title="Sessions" description="Active login sessions across all users." />

      <ListSummary
        stats={[
          {
            label: filtered ? "Matching sessions" : "Total sessions",
            value: formatNumber(summary.total),
          },
          {
            label: "Signed-in users",
            value: formatNumber(summary.users),
            hint: perUser > 0 ? `${perUser.toFixed(1)} sessions each` : "Distinct accounts",
          },
          {
            label: "Active",
            value: formatNumber(summary.active),
            hint: "Seen in the last 24 hours",
          },
          {
            label: "Idle",
            value: formatNumber(summary.idle),
            hint: "Last seen 1 to 7 days ago",
          },
          {
            label: "Stale",
            value: formatNumber(summary.stale),
            hint: shareOf(summary.stale, summary.total),
          },
        ]}
      />

      <SessionsView params={params} page={page} tabCounts={tabCounts} />
    </div>
  );
}
