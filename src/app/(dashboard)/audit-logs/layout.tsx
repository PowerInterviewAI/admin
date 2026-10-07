import { PermissionGate } from "@/components/permission-gate";

/** The record of who did what, with IP addresses: admins only. */
export default function AuditLogsLayout({ children }: LayoutProps<"/audit-logs">) {
  return <PermissionGate need="audit_logs:read">{children}</PermissionGate>;
}
