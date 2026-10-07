import { PermissionGate } from "@/components/permission-gate";

/** Product data: readable by every role holding `users:read` (admin, guest, reseller). */
export default function UsersLayout({ children }: LayoutProps<"/users">) {
  return <PermissionGate need="users:read">{children}</PermissionGate>;
}
