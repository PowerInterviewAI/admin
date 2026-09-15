import { AdminGate } from "@/components/admin-gate";

/** The record of who did what, with IP addresses: admins only. */
export default function AuditLogsLayout({ children }: LayoutProps<"/audit-logs">) {
  return <AdminGate>{children}</AdminGate>;
}
