import "server-only";

import { normalizeEmail } from "@/lib/schemas/account";
import { COLLECTIONS, currentTimestampMs, getCollection } from "@/server/db";
import { hashPassword } from "@/server/password";

/**
 * The built-in admin, named by the environment.
 *
 * Every other account has to be approved by an admin before it can sign in, which leaves the
 * obvious question of where the first admin comes from. The answer is here: `ADMIN_EMAIL` and
 * `ADMIN_PASSWORD` name an account that is created if absent and re-asserted as an approved admin
 * on every boot, so a dashboard pointed at an empty database always has exactly one way in, and a
 * misconfigured one can always be recovered by restarting it.
 */
export interface BootstrapConfig {
  email: string;
  password: string;
}

export type BootstrapConfigResult =
  | { ok: true; config: BootstrapConfig }
  | { ok: false; error: string };

/**
 * Reports a missing built-in admin as a first-class state rather than throwing, the same shape
 * `readEmailConfig` uses. Without it nobody can sign in and nobody can approve anybody, so the
 * sign-in page says which variables are missing instead of presenting a form that cannot succeed.
 */
export function readBootstrapConfig(): BootstrapConfigResult {
  const missing = (["ADMIN_EMAIL", "ADMIN_PASSWORD"] as const).filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missing.length > 0) {
    return {
      ok: false,
      error: `No built-in admin is configured. Set ${missing.join(" and ")} in .env.local and restart.`,
    };
  }

  return {
    ok: true,
    config: {
      email: normalizeEmail(process.env.ADMIN_EMAIL as string),
      password: process.env.ADMIN_PASSWORD as string,
    },
  };
}

/**
 * Brings the accounts collection in line with the environment. Runs once per process, behind the
 * same cached promise as the index creation - see `ensureAuthReady`.
 *
 * Three separate jobs, each of which has to be idempotent because this runs on every boot.
 */
export async function bootstrapAdminAccount(): Promise<void> {
  await backfillMissingStatus();

  const result = readBootstrapConfig();
  if (!result.ok) {
    // Not fatal: the app still renders, and the sign-in page explains itself. Throwing here would
    // turn a configuration mistake into an error boundary over a form that could have said why.
    console.error(result.error);
    return;
  }

  await ensureBootstrapAccount(result.config);
}

/**
 * Accounts written before the approval gate existed have no `status` field, and `accountSchema`
 * reads an absent one as `pending` - which would lock out everybody who already had a working
 * account the moment this shipped. They could sign in yesterday, so they are approved.
 *
 * Scoped by `$exists` rather than by a null check, so it can never touch an account an admin has
 * deliberately set to pending.
 */
async function backfillMissingStatus(): Promise<void> {
  const result = await getCollection(COLLECTIONS.adminAccounts).updateMany(
    { status: { $exists: false } },
    { $set: { status: "approved", updated_at: currentTimestampMs() } },
  );

  if (result.modifiedCount > 0) {
    console.log(
      `[auth] Approved ${result.modifiedCount} account(s) that predate the approval gate`,
    );
  }
}

async function ensureBootstrapAccount({ email, password }: BootstrapConfig): Promise<void> {
  const accounts = getCollection(COLLECTIONS.adminAccounts);
  const existing = await accounts.findOne({ email });

  if (!existing) {
    await accounts.insertOne({
      email,
      name: process.env.ADMIN_NAME?.trim() || "Administrator",
      role: "admin",
      status: "approved",
      is_bootstrap: true,
      password_hash: await hashPassword(password),
      last_login_at: null,
      created_at: currentTimestampMs(),
      updated_at: null,
    });
    console.log(`[auth] Created the built-in admin account for ${email}`);
  } else {
    /**
     * Role and status are re-asserted every boot; the password is not.
     *
     * Re-asserting the first two is the lockout guarantee - whatever state the row got into, a
     * restart makes the built-in admin an approved admin again. Re-asserting the password would
     * undo a deliberate change made on the account page the next time the process restarted,
     * which is why `ADMIN_PASSWORD` only ever seeds a new account. `ADMIN_PASSWORD_FORCE_RESET`
     * is the way back in when that password has been forgotten.
     */
    const patch: Record<string, unknown> = {
      role: "admin",
      status: "approved",
      is_bootstrap: true,
      updated_at: currentTimestampMs(),
    };

    if (process.env.ADMIN_PASSWORD_FORCE_RESET === "true") {
      patch.password_hash = await hashPassword(password);
      console.log(`[auth] Reset the built-in admin password for ${email} from ADMIN_PASSWORD`);
    }

    await accounts.updateOne({ _id: existing._id }, { $set: patch });
  }

  // `ADMIN_EMAIL` can be pointed at a different address between restarts. The flag marks which row
  // the environment currently protects, so exactly one account may carry it.
  await accounts.updateMany(
    { email: { $ne: email }, is_bootstrap: true },
    { $set: { is_bootstrap: false, updated_at: currentTimestampMs() } },
  );
}
