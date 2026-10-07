import { PermissionGate } from "@/components/permission-gate";

/**
 * A reseller's own portal. Only a reseller holds `reseller:portal`: an admin has no key to manage
 * and sees every reseller from `/resellers` instead.
 */
export default function ResellerLayout({ children }: LayoutProps<"/reseller">) {
  return <PermissionGate need="reseller:portal">{children}</PermissionGate>;
}
