import { PermissionGate } from "@/components/permission-gate";

/** Who may sign in to this dashboard is an admin's business, not a reader's. */
export default function AccessLayout({ children }: LayoutProps<"/access">) {
  return <PermissionGate need="access:manage">{children}</PermissionGate>;
}
