import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session-context";
import { toAccountSummary } from "@/lib/schemas/account";
import { requireAccount } from "@/server/auth/guard";

/**
 * Everything behind a sign-in hangs off this layout, which is the point: the check runs once, here,
 * rather than being repeated at the top of six pages where the seventh would eventually forget it.
 *
 * `requireAccount` reads the session cookie, which makes every route underneath dynamic. They all
 * were already - each one reads `searchParams` - so nothing that used to prerender stops.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const account = await requireAccount();

  return (
    <SessionProvider account={toAccountSummary(account)}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
