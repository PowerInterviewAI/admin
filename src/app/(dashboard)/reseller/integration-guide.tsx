import "server-only";

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_API_BASE = "https://api.powerinterviewai.com/api";

/**
 * Where a reseller's app sends its calls: the production API unless `RESELLER_API_BASE_URL` points
 * somewhere else (a staging backend, say). A value that is not a URL falls back to production
 * rather than printing a snippet that cannot work.
 */
function apiBase(): string {
  const configured = process.env.RESELLER_API_BASE_URL?.trim();
  if (configured) {
    try {
      new URL(configured);
      return configured.replace(/\/$/, "");
    } catch {
      // Fall through to the default.
    }
  }
  return DEFAULT_API_BASE;
}

/**
 * The backend's interactive API reference, opened at its Reseller section. It is served at `/docs`
 * on the API's own origin, so it follows `apiBase()` and a staging override moves both together.
 */
function docsUrl(base: string): string {
  return `${new URL(base).origin}/docs#/Reseller`;
}

const ENDPOINTS = [
  { method: "GET", path: "/reseller/me", what: "Your account and lifetime totals" },
  { method: "POST", path: "/reseller/users", what: "Create a customer, with optional opening credits" },
  { method: "GET", path: "/reseller/users?email=...", what: "Find your customers" },
  { method: "POST", path: "/reseller/users/{id}/credits", what: "Top up one of your customers" },
] as const;

export function IntegrationGuide() {
  const base = apiBase();
  const docs = docsUrl(base);

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
        <Button
          variant="outline"
          size="sm"
          className="mt-2 justify-self-start"
          nativeButton={false}
          render={<a href={docs} target="_blank" rel="noopener noreferrer" />}
        >
          API reference
          <ExternalLink data-icon="inline-end" />
        </Button>
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
