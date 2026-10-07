import type { Metadata } from "next";

import { ListSummary, shareOf } from "@/components/list-summary";
import { PageHeader } from "@/components/page-header";
import { formatNumber } from "@/lib/format";
import { countActiveFilters, parseSearchParams, usersSearchParamsSchema } from "@/lib/search-params";
import { getLiveState } from "@/server/queries/live";
import { countUsersTabs, getUsersSummary, listUsers } from "@/server/queries/users";

import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const params = parseSearchParams(usersSearchParamsSchema, await searchParams);

  // Read once, so the online filter, the tab count, and each row's badge agree on who is online.
  const live = await getLiveState();

  // Independent reads, awaited together: the page costs the slowest rather than their sum.
  const [page, summary, tabCounts] = await Promise.all([
    listUsers(params, live),
    getUsersSummary(params, live),
    countUsersTabs(params, live),
  ]);

  const filtered = countActiveFilters(params) > 0;

  return (
    <div className="flex flex-col">
      <PageHeader title="Users" description="Search, filter, and edit every account." />

      <ListSummary
        stats={[
          {
            label: filtered ? "Matching users" : "Total users",
            value: formatNumber(summary.total),
            hint: `${formatNumber(summary.new_in_week)} joined in the last 7 days`,
          },
          {
            label: "Active",
            value: formatNumber(summary.active),
            hint: shareOf(summary.active, summary.total),
          },
          {
            label: "Online now",
            value: formatNumber(summary.online),
            hint: "Client app signed in",
          },
          {
            label: "Interview set up",
            value: formatNumber(summary.configured),
            hint: shareOf(summary.configured, summary.total),
          },
          {
            label: "Not set up",
            value: formatNumber(summary.total - summary.configured),
            hint: "Signed up, never configured",
          },
          {
            label: "Credits held",
            value: formatNumber(summary.credits),
            hint: "Sum across these accounts",
          },
        ]}
      />

      <UsersView params={params} page={page} tabCounts={tabCounts} />
    </div>
  );
}
