import type { Metadata } from "next";

import { ListSummary, shareOf } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatDuration, formatNumber } from "@/lib/format";
import {
  countActiveFilters,
  interviewsSearchParamsSchema,
  parseSearchParams,
} from "@/lib/search-params";
import {
  countInterviewsTabs,
  getInterviewsSummary,
  listInterviews,
} from "@/server/queries/interviews";
import { getLiveState } from "@/server/queries/live";

import { InterviewsView } from "./interviews-view";

export const metadata: Metadata = { title: "Interviews" };

export default async function InterviewsPage({ searchParams }: PageProps<"/interviews">) {
  const params = parseSearchParams(interviewsSearchParamsSchema, await searchParams);

  // One read of who is online, so the list, the strip, and the tab counts agree on "running".
  const live = await getLiveState();

  const [page, summary, tabCounts] = await Promise.all([
    listInterviews(params, live),
    getInterviewsSummary(params, live),
    countInterviewsTabs(params, live),
  ]);

  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Interviews"
        description="Every live and mock interview, and the ones running right now."
      />

      <ListSummary
        stats={[
          {
            label: filtered ? "Matching interviews" : "Total interviews",
            value: formatNumber(summary.total),
          },
          {
            label: "Running now",
            value: formatNumber(summary.running),
            hint: `${formatNumber(live.userIds.length)} accounts online`,
          },
          {
            label: "Live",
            value: formatNumber(summary.live),
            hint: shareOf(summary.live, summary.total),
          },
          {
            label: "Mock",
            value: formatNumber(summary.mock),
            hint: shareOf(summary.mock, summary.total),
          },
          {
            label: "Average length",
            value: summary.avg_duration_ms === null ? "-" : formatDuration(summary.avg_duration_ms),
            hint: "Ended interviews",
          },
        ]}
      />

      <InterviewsView params={params} page={page} tabCounts={tabCounts} />
    </div>
  );
}
