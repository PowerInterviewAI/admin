import { z } from "zod";

import { objectIdSchema, timestampsSchema } from "@/lib/schemas/common";
import { INTERVIEW_KINDS } from "@/lib/schemas/interview";

export const userRoleSchema = z.enum(["user", "trial_user", "admin"]);
export const userStatusSchema = z.enum(["active", "inactive"]);

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;

export const USER_ROLES = userRoleSchema.options;
export const USER_STATUSES = userStatusSchema.options;

/**
 * A user's interview setup (full name, profile/CV, context).
 *
 * Two variants with the same output type: the form schema demands all three fields, because the
 * sheet always submits all three, while the stored variant fills gaps left by documents written
 * before a field existed. Keeping the defaults out of the form schema matters to
 * `zodResolver`, which requires a schema whose input and output types are identical.
 */
const interviewConfigFields = {
  full_name: z.string(),
  profile_data: z.string(),
  context: z.string(),
};

export const interviewConfigSchema = z.object(interviewConfigFields);

const storedInterviewConfigSchema = z.object({
  full_name: interviewConfigFields.full_name.default(""),
  profile_data: interviewConfigFields.profile_data.default(""),
  context: interviewConfigFields.context.default(""),
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
  interview_config: storedInterviewConfigSchema.nullish().default(null),
});

export type User = z.infer<typeof userSchema>;

/**
 * Set when the account has a client app signed in right now, with the interview running in it if
 * any. Decided on the server against one clock per page, like a session's activity badge.
 */
export const userPresenceSchema = z.object({
  last_seen_at: z.number(),
  interview: z.object({ kind: z.enum(INTERVIEW_KINDS), started_at: z.number() }).nullable(),
});

export type UserPresence = z.infer<typeof userPresenceSchema>;

/**
 * A user row carries its payment and session counts. The old API served them from a separate
 * `GET /users/{id}`; resolving them for the whole page in one aggregation removes a per-row
 * round trip and lets the edit sheet open from row data alone.
 */
export const userRowSchema = userSchema.extend({
  payment_count: z.number().int().default(0),
  session_count: z.number().int().default(0),
  presence: userPresenceSchema.nullable().default(null),
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

/**
 * bcrypt hashes at most the first 72 bytes of a password and silently ignores the rest, on both
 * sides of this stack. A longer password would still authenticate, on its truncated prefix, and
 * nothing anywhere would say so - rejecting it here is the only place that can.
 */
const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * What the set-password dialog submits. There is no current-password field: backend's
 * `POST /api/users/me/change-password` demands one because the user is proving it is their own
 * account, and an admin overwriting someone else's password has no such thing to supply.
 *
 * The eight-character floor is this app's own: no schema in backend or the desktop client sets a
 * minimum, so nothing here is being duplicated, and a tool whose whole job is writing someone's
 * credential should not be the easiest way to give an account a one-character password.
 */
export const userPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .refine(
        (value) => new TextEncoder().encode(value).length <= BCRYPT_MAX_PASSWORD_BYTES,
        `Passwords longer than ${BCRYPT_MAX_PASSWORD_BYTES} bytes are truncated by bcrypt`,
      ),
    confirm_password: z.string(),
  })
  .refine((values) => values.password === values.confirm_password, {
    message: "The two passwords do not match",
    path: ["confirm_password"],
  });

export type UserPassword = z.infer<typeof userPasswordSchema>;
