/**
 * What every server action returns. Actions do not throw across the network boundary: a thrown
 * error becomes an opaque digest in production, which is useless for telling an admin whether a
 * save failed on validation, a duplicate email, or an unreachable database.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

export const ok: ActionResult = { ok: true };

export function failed(error: string): ActionResult {
  return { ok: false, error };
}
