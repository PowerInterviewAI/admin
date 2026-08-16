import "server-only";

import type { Filter } from "mongodb";

import type { Page } from "@/lib/schemas/common";
import { type UserRow, userSchema } from "@/lib/schemas/user";
import { PAGE_SIZE, type UsersSearchParams } from "@/lib/search-params";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";
import { findPage } from "@/server/repository";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Payment and session counts for a whole page of users, in two grouped queries rather than 2N. */
async function getRelatedCounts(
  userIds: string[],
): Promise<{ payments: Map<string, number>; sessions: Map<string, number> }> {
  if (userIds.length === 0) {
    return { payments: new Map(), sessions: new Map() };
  }

  const match = { user_id: { $in: userIds.map(toObjectId) } };
  const group = [{ $match: match }, { $group: { _id: "$user_id", count: { $sum: 1 } } }];

  const [payments, sessions] = await Promise.all([
    getCollection(COLLECTIONS.payments).aggregate<{ _id: unknown; count: number }>(group).toArray(),
    getCollection(COLLECTIONS.sessions).aggregate<{ _id: unknown; count: number }>(group).toArray(),
  ]);

  return {
    payments: new Map(payments.map((doc) => [String(doc._id), doc.count])),
    sessions: new Map(sessions.map((doc) => [String(doc._id), doc.count])),
  };
}

export async function listUsers(params: UsersSearchParams): Promise<Page<UserRow>> {
  const filter: Filter<Document> = {};

  if (params.q) {
    const pattern = new RegExp(escapeRegExp(params.q), "i");
    filter.$or = [{ username: pattern }, { email: pattern }];
  }
  if (params.role) filter.role = params.role;
  if (params.status) filter.status = params.status;

  const page = await findPage({
    collection: COLLECTIONS.users,
    schema: userSchema,
    filter,
    sort: { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 },
    offset: (params.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const counts = await getRelatedCounts(page.items.map((user) => user._id));

  return {
    ...page,
    items: page.items.map((user) => ({
      ...user,
      payment_count: counts.payments.get(user._id) ?? 0,
      session_count: counts.sessions.get(user._id) ?? 0,
    })),
  };
}
