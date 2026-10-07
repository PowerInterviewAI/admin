import { PermissionGate } from "@/components/permission-gate";

/** Covers `/emails/history` too: the gate is on the segment, not on the page. */
export default function EmailsLayout({ children }: LayoutProps<"/emails">) {
  return <PermissionGate need="emails:send">{children}</PermissionGate>;
}
