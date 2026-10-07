import "server-only";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Where a reseller's app sends its calls. Configurable because the public API address is a
 * deployment fact this dashboard has no other way to know; without it the snippets still show the
 * shape, with a placeholder a reseller cannot mistake for a working URL.
 */
function apiBase(): string {
  return (process.env.RESELLER_API_BASE_URL?.trim() || "https://<your-api-host>/api").replace(/\/$/, "");
}

const ENDPOINTS = [
  { method: "GET", path: "/reseller/me", what: "Your account and lifetime totals" },
  { method: "POST", path: "/reseller/users", what: "Create a customer, with optional opening credits" },
  { method: "GET", path: "/reseller/users?email=...", what: "Find your customers" },
  { method: "POST", path: "/reseller/users/{id}/credits", what: "Top up one of your customers" },
] as const;

export function IntegrationGuide() {
  const base = apiBase();

  const create = [
    `curl -X POST ${base}/reseller/users \\`,
    `  -H "X-API-Key: $PIA_API_KEY" -H "Content-Type: application/json" \\`,
    `  -d '{"username":"Jane","email":"jane@example.com","password":"a-strong-password",`,
    `       "credits":600,"reference":"order-1001","price_amount":19.99,"price_currency":"USD"}'`,
  ].join("\n");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connecting your app</CardTitle>
        <CardDescription>
          600 credits is one interview hour. Send your own order id as{" "}
          <code className="font-mono">reference</code>: a retry with the same reference returns the
          first result instead of creating or crediting twice.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="flex flex-col gap-1">
          {ENDPOINTS.map((endpoint) => (
            <li key={`${endpoint.method} ${endpoint.path}`} className="flex flex-wrap gap-x-2">
              <code className="font-mono text-xs">
                {endpoint.method} {endpoint.path}
              </code>
              <span className="text-muted-foreground">{endpoint.what}</span>
            </li>
          ))}
        </ul>
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed">
          {create}
        </pre>
        <p className="text-xs text-muted-foreground">
          The customer signs in to the Power Interview desktop app with that email and password.
          Your rate is applied to every credit you grant, and settled daily.
        </p>
      </CardContent>
    </Card>
  );
}
