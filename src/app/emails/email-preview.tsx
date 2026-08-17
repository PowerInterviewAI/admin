"use client";

import { Monitor, Smartphone } from "lucide-react";
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
}

export function EmailPreview({ html, subject, fromName, fromAddress }: EmailPreviewProps) {
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

/** Long enough that a burst of typing produces one reparse, short enough to feel live. */
const WRITE_DEBOUNCE_MS = 300;

/**
 * Renders the email in an isolated document.
 *
 * `srcdoc` is assigned imperatively rather than passed as a React prop, which is what lets the
 * assignment be debounced without holding the document in state. An earlier version drove this
 * with `document.open()/write()/close()` to preserve scroll; that tears down and rebuilds the
 * frame's whole document on every update, and doing it repeatedly through an editing session is
 * the single most expensive thing this page can do. Scroll is preserved here instead by stashing
 * the offset before the swap and restoring it on `load`.
 *
 * `sandbox="allow-same-origin"` is only there to keep `contentDocument` readable for that scroll
 * restore. `allow-scripts` is deliberately withheld, so the raw author-written campaign body
 * cannot execute anything.
 */
function PreviewFrame({ html, width }: { html: string; width: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hasRendered = useRef(false);
  const scrollTop = useRef(0);

  /**
   * Debounced, not deferred: `useDeferredValue` lowers the priority of work but still performs it
   * for every intermediate value, and parsing a document is synchronous work that cannot yield.
   * The cleanup cancels a pending swap, so a burst of typing reparses once, after it stops. The
   * first render is immediate so the preview is not blank while the debounce elapses on mount.
   */
  useEffect(() => {
    const apply = () => {
      const frame = frameRef.current;
      if (!frame) return;

      scrollTop.current = frame.contentDocument?.documentElement.scrollTop ?? 0;
      frame.srcdoc = html;
      hasRendered.current = true;
    };

    if (!hasRendered.current) {
      apply();
      return;
    }

    const timer = setTimeout(apply, WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
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
      )}
    />
  );
}
