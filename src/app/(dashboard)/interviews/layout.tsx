import { PermissionGate } from "@/components/permission-gate";

/** Product data: readable by staff roles, never by a reseller, who sees only their own customers. */
export default function InterviewsLayout({ children }: LayoutProps<"/interviews">) {
  return <PermissionGate need="interviews:read">{children}</PermissionGate>;
}
