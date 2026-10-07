import { PermissionGate } from "@/components/permission-gate";

import { ResellersNav } from "./resellers-nav";

/**
 * Every reseller's sales, and what each owes. Admins only: it is the whole partner book, and
 * covers `/resellers/history` and `/resellers/settlements` from the segment.
 */
export default function ResellersLayout({ children }: LayoutProps<"/resellers">) {
  return (
    <PermissionGate need="resellers:read">
      <ResellersNav />
      {children}
    </PermissionGate>
  );
}
