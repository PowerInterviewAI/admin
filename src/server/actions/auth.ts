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
  countAccounts,
  createAccount,
  ensureAuthIndexes,
  findAccountCredentials,
  getAccountById,
  touchLastLogin,
} from "@/server/auth/accounts";
import { createSession, destroyCurrentSession, getCurrentAccount } from "@/server/auth/session";
import { clearAttempts, recordFailedAttempt, retryAfterMinutes } from "@/server/auth/throttle";
import { AppError } from "@/server/errors";
import { verifyPassword } from "@/server/password";

/**
 * Creating the first account makes you the admin; every account after it is a guest.
 *
 * Someone has to be able to administer a dashboard that starts with nobody in it, and the
 * alternatives are worse: a bootstrap password in the environment is a credential sitting in a
 * file, and a setup script is a step that gets skipped. The window this opens closes on its own -
 * once one account exists, signing up gets you read-only access and an admin has to promote you
 * from the access panel.
 *
 * It is a race in principle: two people submitting the very first sign-up at once could both read
 * a count of zero and both become admins. Two admins on a local tool at first-run is not a
 * privilege escalation worth serialising a collection over, and both of them wanted in.
 */
export async function signUp(input: unknown): Promise<ActionData<AccountSummary>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  const { name, email, password } = parsed.data;

  try {
    await ensureAuthIndexes();

    const role = (await countAccounts()) === 0 ? "admin" : "guest";
    const accountId = await createAccount({ email, name, password, role });

    // Signing up signs you in. The alternative - bouncing to the sign-in form to type the same
    // password again - is a step that exists only because the code was easier to write that way.
    await createSession(accountId);
    await touchLastLogin(accountId);

    const account = await getAccountById(accountId);
    if (!account) throw new AppError("unavailable", "The account was created but could not be read");

    return succeeded(toAccountSummary(account));
  } catch (error) {
    if (error instanceof AppError) {
      // The unique index on `email` is what catches a duplicate, including one that raced past the
      // check above; `describeWriteError` has already turned it into a conflict by here.
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
    await ensureAuthIndexes();

    const credentials = await findAccountCredentials(email);
    const valid = await verifyPassword(parsed.data.password, credentials?.passwordHash);

    if (!credentials || !valid) {
      recordFailedAttempt(email);
      return failed(SIGN_IN_REJECTION);
    }

    clearAttempts(email);

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

/** Whether signing up will produce the admin. Read by the sign-up page to say so before you type. */
export async function isFirstAccount(): Promise<boolean> {
  try {
    return (await countAccounts()) === 0;
  } catch {
    // The page renders either way; being wrong about the copy is not worth an error boundary.
    return false;
  }
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
