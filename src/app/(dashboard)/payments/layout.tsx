import { PermissionGate } from "@/components/permission-gate";

/** Product data: readable by staff roles, never by a reseller, who sees only their own customers. */
export default function PaymentsLayout({ children }: LayoutProps<"/payments">) {
  return <PermissionGate need="payments:read">{children}</PermissionGate>;
}
