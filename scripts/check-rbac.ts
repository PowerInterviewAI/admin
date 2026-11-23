/**
 * Pins the role table in `src/lib/rbac.ts` against the access each role is meant to have.
 *
 * There is no test runner in this app, and the failure this guards against is silent: a permission
 * dropped from `guest` hides a page nobody notices is gone. Run with `pnpm check:rbac`; exits non-zero on drift.
 */
import assert from "node:assert/strict";

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROUTE_PERMISSIONS,
  canAccessPath,
  homePathFor,
} from "../src/lib/rbac";
import { ACCOUNT_ROLES, type AccountRole } from "../src/lib/schemas/account";

const ROUTES = [
  "/",
  "/users",
  "/interviews",
  "/payments",
  "/sessions",
  "/emails",
  "/emails/history",
  "/audit-logs",
  "/access",
  "/account",
] as const;

const EXPECTED: Record<AccountRole, readonly string[]> = {
  admin: ROUTES,
  // The dashboard's aggregate figures and the caller's own account. Users, interviews and payments
  // are admin-only, like sessions, audit logs, email, and access.
  guest: ["/", "/account"],
};

let failures = 0;
function check(name: string, run: () => void): void {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const role of ACCOUNT_ROLES) {
  check(`${role} opens exactly the routes it should`, () => {
    const actual = ROUTES.filter((route) => canAccessPath(role, route));
    assert.deepEqual([...actual].sort(), [...EXPECTED[role]].sort());
  });

  check(`${role}'s home is a page it can open`, () => {
    const home = homePathFor(role);
    assert.ok(canAccessPath(role, home), `${home} is refused to ${role}`);
  });

  check(`${role} holds only declared permissions`, () => {
    for (const permission of ROLE_PERMISSIONS[role]) assert.ok(PERMISSIONS.includes(permission));
  });
}

check("users, interviews and payments belong to admins alone", () => {
  for (const role of ACCOUNT_ROLES) {
    if (role === "admin") continue;
    for (const route of ["/users", "/interviews", "/payments"]) {
      assert.equal(canAccessPath(role, route), false, `${role} opens ${route}`);
    }
    for (const permission of ["users:read", "interviews:read", "payments:read"] as const) {
      assert.equal(ROLE_PERMISSIONS[role].has(permission), false, `${role} holds ${permission}`);
    }
  }
});

check("every route rule names a real permission", () => {
  for (const rule of ROUTE_PERMISSIONS) assert.ok(PERMISSIONS.includes(rule.permission), rule.path);
});

check("/ is matched exactly, not as a prefix of everything", () => {
  assert.equal(canAccessPath("guest", "/"), true);
  assert.equal(canAccessPath("guest", "/sessions"), false);
});

if (failures > 0) {
  console.error(`\n${failures} RBAC check(s) failed`);
  process.exit(1);
}
console.log("\nRBAC table matches the intended access");
