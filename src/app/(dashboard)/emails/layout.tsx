import { AdminGate } from "@/components/admin-gate";

/** Covers `/emails/history` too: the gate is on the segment, not on the page. */
export default function EmailsLayout({ children }: LayoutProps<"/emails">) {
  return <AdminGate>{children}</AdminGate>;
}
