"use server";

import { type ActionData, type ActionResult, failed, ok, succeeded } from "@/lib/action-result";
import {
  type AccountSummary,
  normalizeEmail,
  signInSchema,
  signUpSchema,
  toAccountSummary,
} from "@/lib/schemas/account";
import {
  createAccount,
  ensureAuthReady,
  findAccountCredentials,
  getAccountById,
  touchLastLogin,
} from "@/server/auth/accounts";
import { readBootstrapConfig } from "@/server/auth/bootstrap";
import { createSession, destroyCurrentSession, getCurrentAccount } from "@/server/auth/session";
import { clearAttempts, recordFailedAttempt, retryAfterMinutes } from "@/server/auth/throttle";
import { AppError } from "@/server/errors";
import { verifyPassword } from "@/server/password";

/**
 * Signing up gets you an account and nothing else.
 *
 * No session is created, because there is nothing yet to hold a session over: a `pending` account
 * cannot read a single page. Signing someone in and then showing them a wall would be a worse lie
 * than telling them plainly that an admin has to let them in, and it would mean carrying a whole
 * second signed-in-but-not-allowed layout for a state that lasts until somebody clicks approve.
 *
 * The first-account-becomes-admin rule this replaced is gone. The admin now comes from
 * `ADMIN_EMAIL`/`ADMIN_PASSWORD` (see `bootstrap.ts`), so there is no longer a window in which
 * signing up quickly gets you more than read access.
 */
export async function signUp(input: unknown): Promise<ActionData<{ email: string }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  const { name, email, password } = parsed.data;

  try {
    await ensureAuthReady();
    await createAccount({ email, name, password, role: "guest", status: "pending" });

    return succeeded({ email: normalizeEmail(email) });
  } catch (error) {
    if (error instanceof AppError) {
      // The unique index on `email` is what catches a duplicate, including one that raced past any
      // check; `describeWriteError` has already turned it into a conflict by here.
      return failed(
        error.code === "conflict" ? "An account already uses that email address" : error.message,
      );
    }
    return failed("Could not create this account");
  }
}

/**
 * One message for a wrong password and for an address with no account, on purpose: telling the two
 * apart turns this form into a way to find out who has an account here. `verifyPassword` spends
 * the same bcrypt work in both cases so the response time does not give it away either.
 */
const SIGN_IN_REJECTION = "That email and password do not match an account";

/**
 * These two are only ever reached by someone who has already proved the password, so they are not
 * an enumeration oracle - and telling a real owner "you are waiting on an admin" rather than "your
 * password is wrong" is the difference between waiting and retyping a correct password all day.
 */
const PENDING_REJECTION =
  "Your account is waiting for an admin to approve it. You will be able to sign in once they do.";
const REJECTED_REJECTION = "Your access to this dashboard has been revoked. Ask an admin about it.";

export async function signIn(input: unknown): Promise<ActionData<AccountSummary>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  const email = normalizeEmail(parsed.data.email);

  const locked = retryAfterMinutes(email);
  if (locked > 0) {
    return failed(
      `Too many sign-in attempts for that email. Try again in ${locked} minute${locked === 1 ? "" : "s"}.`,
    );
  }

  try {
    await ensureAuthReady();

    const credentials = await findAccountCredentials(email);
    const valid = await verifyPassword(parsed.data.password, credentials?.passwordHash);

    if (!credentials || !valid) {
      recordFailedAttempt(email);
      return failed(SIGN_IN_REJECTION);
    }

    // The password was right, so this is not a guess to count against the throttle - the account
    // just is not allowed in. Counting it would lock a waiting user out of the form that is
    // telling them to wait.
    clearAttempts(email);

    if (credentials.status === "pending") return failed(PENDING_REJECTION);
    if (credentials.status === "rejected") return failed(REJECTED_REJECTION);

    await createSession(credentials.id);
    await touchLastLogin(credentials.id);

    const account = await getAccountById(credentials.id);
    if (!account) throw new AppError("unavailable", "That account could not be read");

    return succeeded(toAccountSummary(account));
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not sign in");
  }
}

export async function signOut(): Promise<ActionResult> {
  try {
    await destroyCurrentSession();
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not sign out");
  }
  return ok;
}

/**
 * Whether a built-in admin is configured at all. Read by the sign-in page, which says so plainly:
 * without one nobody can sign in and nobody can approve anybody, and a form that cannot succeed
 * should explain itself rather than just rejecting whatever is typed into it.
 */
export async function readBootstrapState(): Promise<{ configured: boolean; error: string | null }> {
  const result = readBootstrapConfig();
  return result.ok ? { configured: true, error: null } : { configured: false, error: result.error };
}

/** Refreshes the signed-in identity the client holds, after changing your own name or password. */
export async function readCurrentAccount(): Promise<ActionData<AccountSummary | null>> {
  try {
    const account = await getCurrentAccount();
    return succeeded(account ? toAccountSummary(account) : null);
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not read your account");
  }
}
