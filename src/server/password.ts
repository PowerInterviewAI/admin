import "server-only";

import { hash } from "bcryptjs";

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
