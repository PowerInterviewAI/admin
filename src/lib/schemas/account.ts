import { z } from "zod";

import { objectIdSchema, timestampsSchema } from "@/lib/schemas/common";

/**
 * Who can sign in to this dashboard. Deliberately not `userRoleSchema` from `schemas/user.ts`:
 * that enum describes a customer of the product (`user`, `trial_user`, `admin`) and lives in
 * backend's database, while this one describes an operator of the admin tool. The two never meet -
 * an `admin_accounts` row is not a `users` row, and a product user named "admin" grants nothing
 * here. Keeping the enums apart is what stops a future backend role from silently becoming a
 * permission in this app.
 */
export const accountRoleSchema = z.enum(["admin", "guest", "reseller"]);

export type AccountRole = z.infer<typeof accountRoleSchema>;
export const ACCOUNT_ROLES = accountRoleSchema.options;

/** What each role may do lives in `src/lib/rbac.ts`; these only describe it to a person. */
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  admin: "Admin",
  guest: "Guest",
  reseller: "Reseller",
};

export const ACCOUNT_ROLE_DESCRIPTIONS: Record<AccountRole, string> = {
  admin: "Reads everything, and can edit, delete, set passwords, send email, and manage resellers.",
  guest:
    "Reads the dashboard, users, interviews, and payments. Sessions, audit logs, email, resellers, " +
    "and this page are admin-only, and every write is refused on the server as well as in the UI.",
  reseller:
    "An outside partner. Sees only their reseller portal: their API key, the customers they " +
    "created, and what they sold. No product data, and no other customers.",
};

/** The two-word version, for the account menu where the full description does not fit. */
export const ACCOUNT_ROLE_SUMMARIES: Record<AccountRole, string> = {
  admin: "Full access",
  guest: "Read-only, some pages hidden",
  reseller: "Reseller portal only",
};

/**
 * Whether an account may sign in at all, which is a separate question from what it may do once in.
 *
 * Signing up gets you `pending` and nothing else: no session, no dashboard, no read access. An
 * admin moves you to `approved`, and can move you back. Two axes rather than a fourth role value
 * because "may this person in" and "may they write" are decided by different people at different
 * times - an admin approving a colleague is not also choosing whether they can delete users.
 *
 * `rejected` doubles as suspension. There is no separate state for "was approved, now is not":
 * the effect is identical (no sign-in, live sessions revoked) and a second word for it would only
 * invite the two drifting apart.
 */
export const accountStatusSchema = z.enum(["pending", "approved", "rejected"]);

export type AccountStatus = z.infer<typeof accountStatusSchema>;
export const ACCOUNT_STATUSES = accountStatusSchema.options;

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export const ACCOUNT_STATUS_DESCRIPTIONS: Record<AccountStatus, string> = {
  pending: "Signed up, waiting on an admin. Cannot sign in yet.",
  approved: "Can sign in.",
  rejected: "Refused or revoked. Cannot sign in, and every session was ended.",
};

/**
 * `password_hash` has no field here, the same rule `userSchema` follows: zod strips unknown keys,
 * so the hash is dropped the moment a document is parsed and cannot reach a client even by
 * accident. `findAccountCredentials` reads it straight off the driver instead, and is the only
 * thing in the app that sees it.
 *
 * `role` and `status` are `.catch()`ed rather than strict, and both catch to the *least*
 * privileged value: a row carrying a word this build has never heard of degrades to a pending
 * guest rather than throwing, so a half-finished migration cannot hand anybody access. The
 * default on `status` covers the rows written before the approval gate existed - see
 * `ensureAuthReady`, which is what decides they are approved rather than this schema.
 */
export const accountSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  email: z.string(),
  name: z.string().default(""),
  role: accountRoleSchema.catch("guest"),
  status: accountStatusSchema.catch("pending").default("pending"),
  last_login_at: z.number().int().nullish().default(null),
  /**
   * True for the account named by `ADMIN_EMAIL`. Stamped on the document at bootstrap rather than
   * recomputed from the environment on read, so the access panel and the actions that protect it
   * agree even if the variable is changed while the app is running.
   */
  // Transformed rather than `.default()`ed: a `.nullish()` default still lets an explicit null
  // through, and every consumer here wants a plain boolean to branch on.
  is_bootstrap: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
});

export type Account = z.infer<typeof accountSchema>;

/** An account plus how many live sign-ins it currently has, resolved for the whole page at once. */
export const accountRowSchema = accountSchema.extend({
  session_count: z.number().int().default(0),
});

export type AccountRow = z.infer<typeof accountRowSchema>;

/**
 * What crosses to the browser about whoever is signed in. A DTO rather than the document: the
 * client needs an identity to show and a role to gate controls on, and nothing else about the
 * account is any of its business.
 */
export interface AccountSummary {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  status: AccountStatus;
  isBootstrap: boolean;
}

export function toAccountSummary(account: Account): AccountSummary {
  return {
    id: account._id,
    email: account.email,
    name: account.name,
    role: account.role,
    status: account.status,
    isBootstrap: account.is_bootstrap,
  };
}

/**
 * bcrypt hashes at most the first 72 bytes and silently ignores the rest, so a longer password
 * would authenticate on its truncated prefix with nothing anywhere saying so. Same floor and
 * ceiling `userPasswordSchema` applies to the passwords this app writes into backend's users.
 */
const BCRYPT_MAX_PASSWORD_BYTES = 72;

const passwordField = z
  .string()
  .min(8, "Use at least 8 characters")
  .refine(
    (value) => new TextEncoder().encode(value).length <= BCRYPT_MAX_PASSWORD_BYTES,
    `Passwords longer than ${BCRYPT_MAX_PASSWORD_BYTES} bytes are truncated by bcrypt`,
  );

/**
 * Case and surrounding space are not part of an email address as far as signing in is concerned,
 * so both are normalised before anything compares or stores one. Done here rather than as a zod
 * `.trim().toLowerCase()` because `zodResolver` requires a schema whose input and output types
 * match, and because the same normalisation has to apply to the sign-in lookup, where the address
 * never passes through a form schema at all.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    name: z.string().min(1, "Enter your name").max(80, "That name is too long"),
    email: z.email("Enter a valid email"),
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((values) => values.password === values.confirm_password, {
    message: "The two passwords do not match",
    path: ["confirm_password"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * What an admin fills in to create an account for someone else, from the access panel. There is no
 * status field: an admin typing someone's password in is the approval, so these are created
 * `approved` rather than made to wait for a second click from the person who just made them.
 */
export const accountCreateSchema = z.object({
  name: z.string().min(1, "Enter a name").max(80, "That name is too long"),
  email: z.email("Enter a valid email"),
  role: accountRoleSchema,
  password: passwordField,
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountRoleUpdateSchema = z.object({ role: accountRoleSchema });

export const accountStatusUpdateSchema = z.object({ status: accountStatusSchema });

/** What the account page submits to rename yourself. Email is not editable: it is the login. */
export const accountProfileSchema = z.object({
  name: z.string().min(1, "Enter a name").max(80, "That name is too long"),
});

export type AccountProfile = z.infer<typeof accountProfileSchema>;

/**
 * Changing your *own* password, from the account page.
 *
 * Unlike `accountPasswordSchema` below this demands the current one. An admin resetting someone
 * else's password has no current password to supply, but you always have your own - and requiring
 * it is what stops a borrowed or hijacked session from locking the real owner out of their
 * account in one step.
 */
export const ownPasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((values) => values.password === values.confirm_password, {
    message: "The two passwords do not match",
    path: ["confirm_password"],
  })
  .refine((values) => values.password !== values.current_password, {
    message: "That is already your password",
    path: ["password"],
  });

export type OwnPassword = z.infer<typeof ownPasswordSchema>;

/**
 * No current-password field, for the same reason `userPasswordSchema` has none: an admin resetting
 * someone else's password has no such thing to supply. Changing your own password goes through the
 * same form - the account menu opens the dialog pointed at yourself.
 */
export const accountPasswordSchema = z
  .object({
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((values) => values.password === values.confirm_password, {
    message: "The two passwords do not match",
    path: ["confirm_password"],
  });

export type AccountPassword = z.infer<typeof accountPasswordSchema>;
