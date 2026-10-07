import { PermissionGate } from "@/components/permission-gate";

/** Every customer, their balance and their interview profile: admins only. */
export default function UsersLayout({ children }: LayoutProps<"/users">) {
  return <PermissionGate need="users:read">{children}</PermissionGate>;
}
