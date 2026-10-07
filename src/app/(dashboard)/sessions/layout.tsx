import { PermissionGate } from "@/components/permission-gate";

/** Interview sessions carry transcripts and device detail, which guests do not get. */
export default function SessionsLayout({ children }: LayoutProps<"/sessions">) {
  return <PermissionGate need="sessions:read">{children}</PermissionGate>;
}
