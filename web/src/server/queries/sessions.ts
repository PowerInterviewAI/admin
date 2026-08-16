import "server-only";

import type { Filter } from "mongodb";

import type { Page } from "@/lib/schemas/common";
import { type SessionRow, sessionSchema } from "@/lib/schemas/session";
import { PAGE_SIZE, type SessionsSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, toObjectId } from "@/server/db";
import { getUserLabels } from "@/server/queries/user-labels";
import { findPage } from "@/server/repository";

export async function listSessions(params: SessionsSearchParams): Promise<Page<SessionRow>> {
  const filter: Filter<Document> = {};

  if (params.user_id) filter.user_id = toObjectId(params.user_id);

  const page = await findPage({
    collection: COLLECTIONS.sessions,
    schema: sessionSchema,
    filter,
    sort: { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 },
    offset: (params.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const labels = await getUserLabels(page.items.map((session) => session.user_id));

  return {
    ...page,
    items: page.items.map((session) => ({
      ...session,
      user: labels.get(session.user_id) ?? null,
    })),
  };
}
