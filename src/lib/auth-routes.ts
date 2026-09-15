/**
 * The handful of auth facts that both the proxy and the server need.
 *
 * Deliberately free of `server-only` and of any database import: `proxy.ts` runs before a route is
 * rendered and pulling `src/server/**` into it would drag the Mongo client into a module that is
 * meant to do nothing but read a cookie.
 */
export const SESSION_COOKIE = "pia_admin_session";

/** Reachable without signing in. Everything else redirects here. */
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

export const PUBLIC_PATHS: ReadonlySet<string> = new Set([SIGN_IN_PATH, SIGN_UP_PATH]);

/** Where the sign-in form sends you after a successful sign-in, when nothing else was asked for. */
export const AFTER_SIGN_IN_PATH = "/";

/**
 * `?next=` carries where you were headed when the proxy turned you away, and it arrives from the
 * URL bar, so it is an open-redirect hole until something checks it. Only a path on this origin is
 * allowed: no scheme, and no leading `//`, which a browser reads as a protocol-relative URL to
 * another host.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return AFTER_SIGN_IN_PATH;
  if (PUBLIC_PATHS.has(next.split("?")[0] ?? "")) return AFTER_SIGN_IN_PATH;
  return next;
}

/**
 * Routes an approved guest may not open at all, as opposed to may not write to.
 *
 * Read access stops being enough on these four: `/access` decides who may sign in, `/emails` sends
 * mail to real customers from this product's address, `/sessions` shows interview transcripts and
 * device detail, and `/audit-logs` is the record of what everyone did, IP addresses included. A
 * guest reading them is not the harmless half of read-only.
 *
 * Prefix-matched, so `/emails` covers `/emails/history` and any route added under it later. This
 * list is where the sidebar, the account menu, and the per-segment gates all read the rule from;
 * it carries no database import so a client component can ask the same question the server does.
 */
export const ADMIN_ONLY_PATHS: readonly string[] = [
  "/access",
  "/emails",
  "/sessions",
  "/audit-logs",
];

export function isAdminOnlyPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? "";
  return ADMIN_ONLY_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
