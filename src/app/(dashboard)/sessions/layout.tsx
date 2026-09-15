import { AdminGate } from "@/components/admin-gate";

/** Interview sessions carry transcripts and device detail, which guests do not get. */
export default function SessionsLayout({ children }: LayoutProps<"/sessions">) {
  return <AdminGate>{children}</AdminGate>;
}
