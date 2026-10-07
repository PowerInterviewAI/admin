import { cn } from "@/lib/utils";

/** The "happening now" marker beside a running interview or an online account. */
export function LiveDot({ pulse = false, className }: { pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
      )}
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
    </span>
  );
}
