import { PermissionGate } from "@/components/permission-gate";

/** Every customer's payments and what they paid: admins only. */
export default function PaymentsLayout({ children }: LayoutProps<"/payments">) {
  return <PermissionGate need="payments:read">{children}</PermissionGate>;
}
