import "server-only";

import { compare, hash } from "bcryptjs";

/**
 * Backend hashes through `CryptContext(schemes=["bcrypt"])` (`app/services/auth_service.py`) and
 * takes passlib's defaults, which are the `$2b$` ident at cost 12. bcryptjs emits `$2b$` too, so a
 * hash written from here verifies in-process there and `needs_update()` reports false, meaning
 * backend will not decide the hash is stale and try to rehash it on the next login.
 *
 * Lowering the cost would still verify, but it would leave admin-set passwords measurably weaker
 * than the ones backend writes on signup, which is not a difference anything downstream can see.
 */
const BCRYPT_COST = 12;

/** Roughly a few hundred milliseconds of CPU by design; never call it before validating the input. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

/**
 * A real bcrypt hash, of a random string nobody holds. `verifyPassword` compares against it when
 * the named account does not exist, so a sign-in attempt on an unknown email costs the same few
 * hundred milliseconds as one on a real account. Returning early instead would make the response
 * time an oracle for which addresses have accounts, which is the one thing a sign-in form should
 * not leak - its error message deliberately does not distinguish the two cases either.
 */
const ABSENT_ACCOUNT_HASH = "$2b$12$dWq1pVLxcP9VhU7SbSAh1ugrQ7LCDPfU3Xbr00Pn.vhbsEor11yNO";

/** False for a wrong password and for an account that has none, in the same amount of time. */
export async function verifyPassword(
  password: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!passwordHash) {
    await compare(password, ABSENT_ACCOUNT_HASH);
    return false;
  }
  return compare(password, passwordHash);
}
