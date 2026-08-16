/**
 * What every server action returns. Actions do not throw across the network boundary: a thrown
 * error becomes an opaque digest in production, which is useless for telling an admin whether a
 * save failed on validation, a duplicate email, or an unreachable database.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Same contract for the few actions whose caller needs a value back - starting a campaign returns
 * the id the composer then polls. The failure arm is identical, so `if (!result.ok) toast.error`
 * reads the same at every call site.
 */
export type ActionData<T> = { ok: true; data: T } | { ok: false; error: string };

export const ok: ActionResult = { ok: true };

export function succeeded<T>(data: T): ActionData<T> {
  return { ok: true, data };
}

export function failed(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
