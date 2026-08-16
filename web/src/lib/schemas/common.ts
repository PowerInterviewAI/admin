import { z } from "zod";

/** A 24-character hex Mongo `_id`, already stringified for the client boundary. */
export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i, "Invalid id");

/**
 * `created_at`/`updated_at` are unix-ms integers, not BSON dates - backend writes them that way.
 * Documents predating a field are common, so both are nullable with a null default.
 */
export const timestampsSchema = z.object({
  created_at: z.number().int().nullish().default(null),
  updated_at: z.number().int().nullish().default(null),
});

export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/** Minimal user identity attached to rows that only store a `user_id`. */
export const userLabelSchema = z.object({
  id: objectIdSchema,
  username: z.string(),
  email: z.string(),
});

export type UserLabel = z.infer<typeof userLabelSchema>;
