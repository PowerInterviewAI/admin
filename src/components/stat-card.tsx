import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { LinkPending } from "@/components/navigation-progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  /** The filtered list behind the number. Omit for a guest when the list is admin-only. */
  href?: string;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, hint, href, className }: StatCardProps) {
  const card = (
    <Card
      className={cn(
        href && "h-full transition-colors group-hover/stat:bg-muted/40 group-hover/stat:ring-foreground/20",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        {href && (
          <span className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground group-hover/stat:text-foreground">
            View list
            <ChevronRight className="size-3" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (!href) return card;

  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}. View list`}
      className="group/stat block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {card}
      <LinkPending />
    </Link>
  );
}
