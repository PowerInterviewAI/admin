import { PermissionGate } from "@/components/permission-gate";

/** Product data: readable by every role holding `interviews:read` (admin, guest, reseller). */
export default function InterviewsLayout({ children }: LayoutProps<"/interviews">) {
  return <PermissionGate need="interviews:read">{children}</PermissionGate>;
}
