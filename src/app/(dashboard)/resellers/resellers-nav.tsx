"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LinkPending } from "@/components/navigation-progress";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/resellers", label: "Overview" },
  { href: "/resellers/history", label: "Sales history" },
  { href: "/resellers/settlements", label: "Settlements" },
] as const;

/** Three pages over the same partners, so they read as one section rather than three routes. */
export function ResellersNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Reseller sections" className="mb-4 flex gap-1 border-b">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {section.label}
            <LinkPending />
          </Link>
        );
      })}
    </nav>
  );
}
