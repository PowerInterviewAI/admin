import { PermissionGate } from "@/components/permission-gate";

// Applies to the server actions of every page under `/emails`, and so to the campaign run they
// schedule with `after`. At one recipient a second that is roughly 200 recipients per run; a longer
// campaign shows as interrupted at the limit and Retry sends the rest.
export const maxDuration = 300;

/** Covers `/emails/history` too: the gate is on the segment, not on the page. */
export default function EmailsLayout({ children }: LayoutProps<"/emails">) {
  return <PermissionGate need="emails:send">{children}</PermissionGate>;
}
