import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit Logs" };

export default function AuditLogsLayout({ children }: LayoutProps<"/audit-logs">) {
  return children;
}
