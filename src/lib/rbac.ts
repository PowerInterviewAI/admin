import { z } from "zod";

import type { AccountRole } from "@/lib/schemas/account";

/**
 * Role-based access control: what each role may do, in one place.
 *
 * Every guard, segment gate, nav entry and button asks for a *permission*, never for a role by
 * name. That is what makes a role a row in `ROLE_PERMISSIONS` rather than a word scattered through
 * the app: adding one is a change here, and a check that says `role === "admin"` somewhere else is
 * a bug waiting for the next role.
 *
 * Client-safe on purpose - no `server-only`, no database - for the same reason `auth-routes.ts` is:
 * the sidebar and the buttons ask the same question the server does, from the same table. Nothing
 * the client concludes from it is a control; `denyUnless` and `PermissionGate` are.
 */
export const permissionSchema = z.enum([
  "dashboard:read",
  "users:read",
  "users:write",
  "interviews:read",
  "payments:read",
  "payments:write",
  "sessions:read",
  "sessions:write",
  "audit_logs:read",
  "emails:send",
  "access:manage",
]);

export type Permission = z.infer<typeof permissionSchema>;
export const PERMISSIONS = permissionSchema.options;

/**
 * What a guest may read: the dashboard's aggregate figures and nothing underneath them. Users,
 * interviews and payments are admin-only - they name customers, their balances and their money - and
 * so are sessions, audit logs and email, which carry transcripts, IP addresses and inboxes.
 */
const GUEST_READS: readonly Permission[] = ["dashboard:read"];

export const ROLE_PERMISSIONS: Record<AccountRole, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS),
  guest: new Set(GUEST_READS),
};

export function hasPermission(role: AccountRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

interface RouteRule {
  path: string;
  permission: Permission;
  /** `/` would otherwise prefix-match every route in the app. */
  exact?: boolean;
}

/**
 * Which permission opens which route. Prefix-matched on a segment boundary, so `/emails` covers
 * `/emails/history`.
 *
 * A path with no rule (`/account`) is open to every signed-in account: it only ever shows the
 * caller their own sign-in.
 */
export const ROUTE_PERMISSIONS: readonly RouteRule[] = [
  { path: "/", permission: "dashboard:read", exact: true },
  { path: "/users", permission: "users:read" },
  { path: "/interviews", permission: "interviews:read" },
  { path: "/payments", permission: "payments:read" },
  { path: "/sessions", permission: "sessions:read" },
  { path: "/emails", permission: "emails:send" },
  { path: "/audit-logs", permission: "audit_logs:read" },
  { path: "/access", permission: "access:manage" },
];

export function requiredPermission(pathname: string): Permission | null {
  const path = pathname.split("?")[0] ?? "";
  const rule = ROUTE_PERMISSIONS.find((candidate) =>
    candidate.exact
      ? path === candidate.path
      : path === candidate.path || path.startsWith(`${candidate.path}/`),
  );
  return rule?.permission ?? null;
}

export function canAccessPath(role: AccountRole, pathname: string): boolean {
  const permission = requiredPermission(pathname);
  return permission === null || hasPermission(role, permission);
}

/**
 * Where a role lands when it opens `/` and cannot read the dashboard. Signing in sends everybody to
 * `/`, so this is what turns that into the role's first page rather than a refusal on arrival.
 */
export function homePathFor(role: AccountRole): string {
  const home = ROUTE_PERMISSIONS.find((rule) => hasPermission(role, rule.permission));
  return home?.path ?? "/account";
}
