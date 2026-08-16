import { z } from "zod";

import { objectIdSchema, timestampsSchema } from "@/lib/schemas/common";

export const userRoleSchema = z.enum(["user", "trial_user", "admin"]);
export const userStatusSchema = z.enum(["active", "inactive"]);

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;

export const USER_ROLES = userRoleSchema.options;
export const USER_STATUSES = userStatusSchema.options;

/** A user's interview setup (full name, profile/CV, context). */
export const interviewConfigSchema = z.object({
  full_name: z.string().default(""),
  profile_data: z.string().default(""),
  context: z.string().default(""),
});

export type InterviewConfig = z.infer<typeof interviewConfigSchema>;

export const EMPTY_INTERVIEW_CONFIG: InterviewConfig = {
  full_name: "",
  profile_data: "",
  context: "",
};

/**
 * `password_hash` is absent rather than masked. The old API serialized it as `null`; leaving the
 * field out of the schema strips it at parse time, so the hash cannot reach a client even by
 * accident, and the type stops advertising a field that is never populated.
 */
export const userSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  username: z.string().default(""),
  email: z.string().default(""),
  role: userRoleSchema.catch("user"),
  status: userStatusSchema.catch("inactive"),
  credits: z.number().int().default(0),
  interview_config: interviewConfigSchema.nullish().default(null),
});

export type User = z.infer<typeof userSchema>;

/**
 * A user row carries its payment and session counts. The old API served them from a separate
 * `GET /users/{id}`; resolving them for the whole page in one aggregation removes a per-row
 * round trip and lets the edit sheet open from row data alone.
 */
export const userRowSchema = userSchema.extend({
  payment_count: z.number().int().default(0),
  session_count: z.number().int().default(0),
});

export type UserRow = z.infer<typeof userRowSchema>;

/**
 * What the edit sheet submits. The id travels as a separate argument to the server action, so
 * unlike the old PATCH body there is no id field here to omit or mismatch.
 */
export const userPatchSchema = z.object({
  username: z.string().min(1, "Username is required"),
  email: z.email("Enter a valid email"),
  role: userRoleSchema,
  status: userStatusSchema,
  credits: z.number().int().min(0, "Credits cannot be negative"),
  interview_config: interviewConfigSchema,
});

export type UserPatch = z.infer<typeof userPatchSchema>;
