"use client";

import { Monitor, Smartphone, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EmailBodyWarning } from "@/lib/email/body";
import { PREVIEW_RECIPIENT_NAME } from "@/lib/email/template";
import { cn } from "@/lib/utils";

type Viewport = "desktop" | "mobile";

/** The card inside the email caps at 560px, so 640 shows it with its background gutter intact. */
const VIEWPORT_WIDTH: Record<Viewport, number> = {
  desktop: 640,
  mobile: 390,
};

interface EmailPreviewProps {
  html: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  /** What this frame renders more kindly than a real client will. See `lib/email/body.ts`. */
  warnings: EmailBodyWarning[];
}

export function EmailPreview({
  html,
  subject,
  fromName,
  fromAddress,
  warnings,
}: EmailPreviewProps) {
  const [viewport, setViewport] = useState<Viewport>("desktop");

  return (
    <Card className="gap-0">
      <CardHeader className="border-b pb-4">
        <CardTitle>Preview</CardTitle>
        <CardDescription>
          Rendered through the same layout the product&apos;s transactional mail uses.
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            <ViewportButton
              viewport="desktop"
              current={viewport}
              onSelect={setViewport}
              label="Desktop width"
            >
              <Monitor />
            </ViewportButton>
            <ViewportButton
              viewport="mobile"
              current={viewport}
              onSelect={setViewport}
              label="Mobile width"
            >
              <Smartphone />
            </ViewportButton>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-0 pt-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-(--card-spacing) text-xs">
          <dt className="text-muted-foreground">From</dt>
          <dd className="truncate">
            {fromName} <span className="text-muted-foreground">&lt;{fromAddress}&gt;</span>
          </dd>
          <dt className="text-muted-foreground">To</dt>
          <dd className="truncate text-muted-foreground">
            Each recipient, addressed as {PREVIEW_RECIPIENT_NAME} here
          </dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="truncate font-medium">{subject || "No subject yet"}</dd>
        </dl>

        {warnings.length > 0 && (
          <div className="mx-(--card-spacing) flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-2 text-xs font-medium">
              <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
              This frame is more forgiving than an inbox
            </p>
            <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {warnings.map((warning) => (
                <li key={warning.code} className="flex gap-2">
                  <span aria-hidden className="text-amber-600">
                    &bull;
                  </span>
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-center overflow-x-auto border-t bg-muted/40 p-4">
          <PreviewFrame html={html} width={VIEWPORT_WIDTH[viewport]} />
        </div>
      </CardContent>
    </Card>
  );
}

function ViewportButton({
  viewport,
  current,
  onSelect,
  label,
  children,
}: {
  viewport: Viewport;
  current: Viewport;
  onSelect: (viewport: Viewport) => void;
  label: string;
  children: React.ReactNode;
}) {
  const isActive = current === viewport;
  return (
    <Button
      variant={isActive ? "secondary" : "ghost"}
      size="icon"
      aria-label={label}
      aria-pressed={isActive}
      onClick={() => onSelect(viewport)}
    >
      {children}
    </Button>
  );
}

/**
 * Renders the email in an isolated document.
 *
 * `srcdoc` is assigned imperatively rather than passed as a React prop, so the swap is not tied to
 * React's own commit of this element. An earlier version drove this with
 * `document.open()/write()/close()` to preserve scroll; that tears down and rebuilds the frame's
 * whole document on every update, and doing it repeatedly through an editing session is the single
 * most expensive thing this page can do. Scroll is preserved here instead by stashing the offset
 * before the swap and restoring it on `load`.
 *
 * There is deliberately no debounce here. `html` is derived from a snapshot the composer already
 * debounces, so every value that reaches this component is the end of a typing burst; a second
 * timer added up to another `PREVIEW_DEBOUNCE_MS` of lag per edit and dropped nothing.
 *
 * `sandbox="allow-same-origin"` is only there to keep `contentDocument` readable for that scroll
 * restore. `allow-scripts` is deliberately withheld, so the raw author-written campaign body
 * cannot execute anything.
 */
export function PreviewFrame({
  html,
  width,
  className,
}: {
  html: string;
  width: number;
  /** Height override, for the shorter frame the campaign detail dialog has room for. */
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    scrollTop.current = frame.contentDocument?.documentElement.scrollTop ?? 0;
    frame.srcdoc = html;
  }, [html]);

  return (
    <iframe
      ref={frameRef}
      title="Email preview"
      sandbox="allow-same-origin"
      style={{ width }}
      // Reads the frame off the event rather than off `frameRef`: React Compiler rejects writing
      // through a ref that an effect above also reads.
      onLoad={(event) => {
        const doc = event.currentTarget.contentDocument;
        if (doc) doc.documentElement.scrollTop = scrollTop.current;
      }}
      className={cn(
        "h-144 max-w-full shrink-0 rounded-md border bg-white transition-[width] duration-200",
        className,
      )}
    />
  );
}
