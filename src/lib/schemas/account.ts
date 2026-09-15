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
export const accountRoleSchema = z.enum(["admin", "guest"]);

export type AccountRole = z.infer<typeof accountRoleSchema>;
export const ACCOUNT_ROLES = accountRoleSchema.options;

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  admin: "Admin",
  guest: "Guest",
};

export const ACCOUNT_ROLE_DESCRIPTIONS: Record<AccountRole, string> = {
  admin: "Reads everything, and can edit, delete, set passwords, and send email.",
  guest: "Reads everything. Every write is refused, on the server as well as in the UI.",
};

/**
 * `password_hash` has no field here, the same rule `userSchema` follows: zod strips unknown keys,
 * so the hash is dropped the moment a document is parsed and cannot reach a client even by
 * accident. `findAccountCredentials` reads it straight off the driver instead, and is the only
 * thing in the app that sees it.
 *
 * `role` is `.catch()`ed rather than strict: a row carrying a role this build has never heard of
 * degrades to the *least* privileged one rather than throwing, so a half-finished migration
 * cannot hand anybody write access.
 */
export const accountSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  email: z.string(),
  name: z.string().default(""),
  role: accountRoleSchema.catch("guest"),
  last_login_at: z.number().int().nullish().default(null),
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
}

export function toAccountSummary(account: Account): AccountSummary {
  return {
    id: account._id,
    email: account.email,
    name: account.name,
    role: account.role,
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

/** What an admin fills in to create an account for someone else, from the access panel. */
export const accountCreateSchema = z.object({
  name: z.string().min(1, "Enter a name").max(80, "That name is too long"),
  email: z.email("Enter a valid email"),
  role: accountRoleSchema,
  password: passwordField,
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountRoleUpdateSchema = z.object({ role: accountRoleSchema });

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
