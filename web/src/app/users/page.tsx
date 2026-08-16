import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { parseSearchParams, usersSearchParamsSchema } from "@/lib/search-params";
import { listUsers } from "@/server/queries/users";

import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const params = parseSearchParams(usersSearchParamsSchema, await searchParams);
  const page = await listUsers(params);

  return (
    <div className="flex flex-col">
      <PageHeader title="Users" description="Search, filter, and edit every account." />
      <UsersView params={params} page={page} />
    </div>
  );
}
