import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { parseSearchParams, sessionsSearchParamsSchema } from "@/lib/search-params";
import { listSessions } from "@/server/queries/sessions";

import { SessionsView } from "./sessions-view";

export const metadata: Metadata = { title: "Sessions" };

export default async function SessionsPage({ searchParams }: PageProps<"/sessions">) {
  const params = parseSearchParams(sessionsSearchParamsSchema, await searchParams);
  const page = await listSessions(params);

  return (
    <div className="flex flex-col">
      <PageHeader title="Sessions" description="Active login sessions across all users." />
      <SessionsView params={params} page={page} />
    </div>
  );
}
