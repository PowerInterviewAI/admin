import { PermissionGate } from "@/components/permission-gate";

/** Who was interviewing, when and for how long: admins only. */
export default function InterviewsLayout({ children }: LayoutProps<"/interviews">) {
  return <PermissionGate need="interviews:read">{children}</PermissionGate>;
}
