import "server-only";

import { type Filter, ObjectId, type Sort } from "mongodb";
import type { z } from "zod";

import type { Page } from "@/lib/schemas/common";
import {
  type CollectionName,
  type Document,
  currentTimestampMs,
  getCollection,
  toObjectId,
} from "@/server/db";
import { AppError, describeWriteError, notFound } from "@/server/errors";

/**
 * Documents cross into React's serialization boundary, so BSON values have to become plain JSON
 * first: ObjectIds become hex strings and dates become unix ms (backend stores its own timestamps
 * as ms integers already, but `metadata` is free-form and can hold anything).
 */
export function toPlainJson(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toPlainJson(item),
      ]),
    );
  }
  return value;
}

/**
 * Validating every document on read is what keeps the two-repo schema drift honest: backend owns
 * these collections and can change a field without telling this app, and a loud parse failure
 * naming the offending document beats a page of silently blank cells.
 */
function parseDocument<T>(schema: z.ZodType<T>, doc: Document, collection: CollectionName): T {
  const result = schema.safeParse(toPlainJson(doc));
  if (!result.success) {
    throw new AppError(
      "invalid",
      `Document ${String(doc._id)} in "${collection}" does not match the expected schema: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

interface FindPageOptions<T> {
  collection: CollectionName;
  schema: z.ZodType<T>;
  filter?: Filter<Document>;
  sort?: Sort;
  offset?: number;
  limit: number;
  /**
   * Fields to exclude from the read. Only worth using for a field a list view never shows and a
   * document can carry a lot of - an email campaign's per-recipient delivery log, say. The schema
   * has to default the excluded field, since the key comes back absent rather than empty.
   */
  projection?: Document;
}

export async function findPage<T>({
  collection,
  schema,
  filter = {},
  sort,
  offset = 0,
  limit,
  projection,
}: FindPageOptions<T>): Promise<Page<T>> {
  const coll = getCollection(collection);

  // The page and its total are independent queries; awaiting them in sequence would double the
  // round trips for no reason.
  const [docs, total] = await Promise.all([
    coll.find(filter, { sort, skip: offset, limit, projection }).toArray(),
    coll.countDocuments(filter),
  ]);

  return {
    items: docs.map((doc) => parseDocument(schema, doc, collection)),
    total,
    offset,
    limit,
  };
}

export async function findMany<T>({
  collection,
  schema,
  filter = {},
  sort,
  limit,
  projection,
}: Omit<FindPageOptions<T>, "offset">): Promise<T[]> {
  const docs = await getCollection(collection)
    .find(filter, { sort, limit, projection })
    .toArray();
  return docs.map((doc) => parseDocument(schema, doc, collection));
}

export async function findOne<T>({
  collection,
  schema,
  filter,
}: {
  collection: CollectionName;
  schema: z.ZodType<T>;
  filter: Filter<Document>;
}): Promise<T | null> {
  const doc = await getCollection(collection).findOne(filter);
  return doc ? parseDocument(schema, doc, collection) : null;
}

export async function countBy(
  collection: CollectionName,
  field: string,
  filter: Filter<Document> = {},
): Promise<Record<string, number>> {
  const docs = await getCollection(collection)
    .aggregate<{ _id: unknown; count: number }>([
      { $match: filter },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ])
    .toArray();

  return Object.fromEntries(
    docs.filter((doc) => doc._id !== null && doc._id !== undefined).map((doc) => [String(doc._id), doc.count]),
  );
}

/**
 * `$set`s the given fields and stamps `updated_at`. Nested objects are replaced wholesale, not
 * merged - `interview_config` in particular is always submitted in full for that reason.
 */
export async function updateById(
  collection: CollectionName,
  id: string,
  patch: Document,
  what: string,
): Promise<void> {
  try {
    const result = await getCollection(collection).updateOne(
      { _id: toObjectId(id) },
      { $set: { ...patch, updated_at: currentTimestampMs() } },
    );
    if (result.matchedCount === 0) {
      throw notFound(what);
    }
  } catch (error) {
    throw describeWriteError(error, what);
  }
}

export async function deleteById(
  collection: CollectionName,
  id: string,
  what: string,
): Promise<void> {
  try {
    const result = await getCollection(collection).deleteOne({ _id: toObjectId(id) });
    if (result.deletedCount === 0) {
      throw notFound(what);
    }
  } catch (error) {
    throw describeWriteError(error, what);
  }
}

/**
 * Deletes everything matching `filter` and reports how many went. Unlike `deleteById`, matching
 * nothing is a valid outcome, not a `not_found`: the callers here are clearing a set that is
 * legitimately empty most of the time.
 */
export async function deleteMany(
  collection: CollectionName,
  filter: Filter<Document>,
  what: string,
): Promise<number> {
  try {
    const result = await getCollection(collection).deleteMany(filter);
    return result.deletedCount;
  } catch (error) {
    throw describeWriteError(error, what);
  }
}

/**
 * Stamps the timestamps the way backend's `TimeStampedCRUDBase.create` does: `created_at` set,
 * `updated_at` left null until something updates the document. Writing `updated_at` here instead
 * would make a freshly inserted document sort as recently modified in every view that orders by it.
 */
export async function insertDocument(
  collection: CollectionName,
  doc: Document,
  what: string,
): Promise<void> {
  try {
    await getCollection(collection).insertOne({
      ...doc,
      created_at: currentTimestampMs(),
      updated_at: null,
    });
  } catch (error) {
    throw describeWriteError(error, what);
  }
}
