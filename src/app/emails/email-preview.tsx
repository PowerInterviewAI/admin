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
 * Writes the rendered email into the frame's document rather than passing it as `srcDoc`.
 *
 * `srcDoc` reloads the frame on every change, which throws away the reader's scroll position -
 * unusable while editing the bottom of a long email. Writing the document directly lets the scroll
 * offset be restored across renders.
 *
 * `sandbox="allow-same-origin"` is what makes `contentDocument` reachable; without it the frame
 * gets an opaque origin and the write is impossible. Scripts stay blocked either way, since
 * `allow-scripts` is not granted - which also means the campaign body cannot execute anything,
 * even though it is raw author-written HTML.
 */
function PreviewFrame({ html, width }: { html: string; width: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hasWritten = useRef(false);

  /**
   * Tearing down and reparsing a whole HTML document is by far the most expensive thing on this
   * page, and running it per keystroke froze the editor. It is debounced rather than deferred:
   * `useDeferredValue` only lowers the priority of the work, it still performs it for every
   * intermediate value, and this particular work is synchronous DOM parsing that cannot yield.
   *
   * The cleanup cancels a pending write, so a burst of typing reparses once at the end of it. The
   * first write is immediate, so the preview is not blank for the debounce interval on mount.
   */
  useEffect(() => {
    const write = () => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;

      const scrollTop = doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
      doc.open();
      doc.write(html);
      doc.close();
      doc.documentElement.scrollTop = scrollTop;
      hasWritten.current = true;
    };

    if (!hasWritten.current) {
      write();
      return;
    }

    const timer = setTimeout(write, WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html]);

  return (
    <iframe
      ref={frameRef}
      title="Email preview"
      sandbox="allow-same-origin"
      style={{ width }}
      className={cn(
        "h-144 max-w-full shrink-0 rounded-md border bg-white transition-[width] duration-200",
      )}
    />
  );
}
