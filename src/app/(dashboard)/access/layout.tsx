import { AdminGate } from "@/components/admin-gate";

/** Who may sign in to this dashboard is an admin's business, not a reader's. */
export default function AccessLayout({ children }: LayoutProps<"/access">) {
  return <AdminGate>{children}</AdminGate>;
}
