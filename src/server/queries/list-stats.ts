import "server-only";

import type { Filter } from "mongodb";

import { type ListTab, type ListTabCounts, tabParams } from "@/lib/list-tabs";
import { type CollectionName, type Document, getCollection } from "@/server/db";

interface SummarizeOptions<T> {
  collection: CollectionName;
  /**
   * The filter the list query itself built. Every summary describes exactly the rows the table is
   * showing, which is the only reading of these numbers that cannot mislead: a total that ignored
   * the filters would sit above a filtered table claiming to be about it.
   */
  filter: Filter<Document>;
  /** Accumulators for the single `$group` stage. `_id` is supplied. */
  group: Document;
  /** For fields needing a post-group expression, such as `$size` of an `$addToSet`. */
  project?: Document;
  /** What an empty match reports: `$group` emits no row at all when nothing matched. */
  empty: T;
}

export async function summarize<T>({
  collection,
  filter,
  group,
  project,
  empty,
}: SummarizeOptions<T>): Promise<T> {
  const pipeline: Document[] = [{ $match: filter }, { $group: { _id: null, ...group } }];
  if (project) pipeline.push({ $project: { _id: 0, ...project } });
  else pipeline.push({ $project: { _id: 0 } });

  // Not `aggregate<T>`: the driver constrains its type parameter to a document with an index
  // signature, and the summary interfaces deliberately have none. The `$project` above is what
  // makes the shape true, so the assertion is on this function rather than on every caller.
  const [row] = await getCollection(collection).aggregate(pipeline).toArray();
  return row ? (row as T) : empty;
}

/** `$sum` of a predicate: how many of the matched documents satisfy it. */
export function countWhere(condition: Document): Document {
  return { $sum: { $cond: [condition, 1, 0] } };
}

/**
 * The size of an `$addToSet` field, ignoring "no value".
 *
 * `$addToSet` keeps a null, and "how many distinct users produced these events" should not count
 * "nobody" as a person - a failed login for an address with no account has no `user_id` at all.
 * Building the set is bounded by the number of *distinct* values rather than by the number of
 * documents, which is why this is affordable on `audit_logs`: many rows, few users and few IPs.
 */
export function countDistinctSet(field: string): Document {
  return {
    $size: {
      $filter: {
        input: `$${field}`,
        cond: { $and: [{ $ne: ["$$this", null] }, { $ne: ["$$this", ""] }] },
      },
    },
  };
}

/**
 * How many rows sit behind each tab, counted with that tab's own filter *substituted for* whatever
 * tab is selected. So "Failed 3" means three failed payments among the admin's other filters
 * whichever tab they are currently on, rather than collapsing to zero on every tab but one.
 */
export async function countListTabs<P extends object>(
  tabs: readonly ListTab<P>[],
  params: P,
  count: (params: P) => Promise<number>,
): Promise<ListTabCounts> {
  const entries = await Promise.all(
    tabs.map(async (tab) => [tab.value, await count(tabParams(tabs, tab, params))] as const),
  );
  return Object.fromEntries(entries);
}
