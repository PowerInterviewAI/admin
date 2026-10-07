/**
 * Pins the role table in `src/lib/rbac.ts` against the access each role is meant to have.
 *
 * There is no test runner in this app, and the failure this guards against is silent: a permission
 * dropped from `guest` hides a page nobody notices is gone, and one added to `reseller` hands an
 * outside party the product's customer list. Run with `pnpm check:rbac`; exits non-zero on drift.
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
  "/resellers",
  "/resellers/history",
  "/resellers/settlements",
  "/reseller",
] as const;

const EXPECTED: Record<AccountRole, readonly string[]> = {
  admin: ROUTES.filter((route) => route !== "/reseller"),
  // Exactly the guest access from before RBAC: everything but the four admin-only areas, and none
  // of the reseller pages that did not exist yet.
  guest: ["/", "/users", "/interviews", "/payments", "/account"],
  reseller: ["/account", "/reseller"],
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

check("a reseller lands on the portal", () => assert.equal(homePathFor("reseller"), "/reseller"));

check("no reseller holds a write on product data", () => {
  for (const permission of ROLE_PERMISSIONS.reseller) {
    assert.ok(!/^(users|payments|sessions|interviews|audit_logs|access|emails|resellers):/.test(permission), permission);
  }
});

check("every route rule names a real permission", () => {
  for (const rule of ROUTE_PERMISSIONS) assert.ok(PERMISSIONS.includes(rule.permission), rule.path);
});

check("/reseller and /resellers are different segments", () => {
  assert.equal(canAccessPath("reseller", "/resellers"), false);
  assert.equal(canAccessPath("reseller", "/resellers/history"), false);
  assert.equal(canAccessPath("admin", "/reseller"), false);
  assert.equal(canAccessPath("reseller", "/reseller?page=2"), true);
});

check("/ is matched exactly, not as a prefix of everything", () => {
  assert.equal(canAccessPath("reseller", "/"), false);
  assert.equal(canAccessPath("reseller", "/reseller"), true);
});

if (failures > 0) {
  console.error(`\n${failures} RBAC check(s) failed`);
  process.exit(1);
}
console.log("\nRBAC table matches the intended access");
