import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * A link from one record to the rows that reference it. Every list view already filters by
 * `user_id`, so linking into that is what turns "12 payments" from a number into somewhere to go.
 *
 * `nativeButton={false}` is required whenever a `Button` renders an anchor: `useButton` asserts in
 * a dev-only effect that a component claiming native button semantics actually rendered a
 * `<button>`, and an anchor trips it on every visit to the page.
 */
export function RelatedLink({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href} />}>
      {label}
      <ExternalLink data-icon="inline-end" />
    </Button>
  );
}
