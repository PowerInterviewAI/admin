import { PermissionGate } from "@/components/permission-gate";

/** Product data: readable by every role holding `payments:read` (admin, guest, reseller). */
export default function PaymentsLayout({ children }: LayoutProps<"/payments">) {
  return <PermissionGate need="payments:read">{children}</PermissionGate>;
}
