import { PermissionGate } from "@/components/permission-gate";

/** Product data: readable by staff roles, never by a reseller, who sees only their own customers. */
export default function UsersLayout({ children }: LayoutProps<"/users">) {
  return <PermissionGate need="users:read">{children}</PermissionGate>;
}
