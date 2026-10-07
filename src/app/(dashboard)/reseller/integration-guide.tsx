import "server-only";

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_API_BASE = "https://api.powerinterviewai.com/api";

/**
 * The production API unless `RESELLER_API_BASE_URL` points somewhere else (a staging backend, say).
 * A value that is not a URL falls back to production rather than linking somewhere that cannot work.
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
 * The backend's API reference, opened at its Reseller section. ReDoc is served at `/redoc` on the
 * API's own origin, so the link follows `apiBase()` and a staging override moves it too.
 */
function referenceUrl(): string {
  return `${new URL(apiBase()).origin}/redoc#tag/Reseller`;
}

/**
 * Everything an integrator needs - endpoints, fields, examples, errors - is in the backend's API
 * reference, which is generated from the code and so cannot go out of date. This card points there
 * rather than keeping a second, shorter copy that would.
 */
export function IntegrationGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connecting your app</CardTitle>
        <CardDescription>
          Create customers and add credits from your own app, authenticating with your API key. The
          API reference lists every endpoint with request and response examples.
        </CardDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 justify-self-start"
          nativeButton={false}
          render={<a href={referenceUrl()} target="_blank" rel="noopener noreferrer" />}
        >
          API reference
          <ExternalLink data-icon="inline-end" />
        </Button>
      </CardHeader>
    </Card>
  );
}
