"use client";

import { AccountMenu } from "@/components/account-menu";
import { AppSidebar } from "@/components/app-sidebar";
import { useIsNavigating } from "@/components/navigation-progress";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
/**
 * The authenticated chrome. Mounted by the dashboard layout, below `SessionProvider`, so everything
 * inside it can ask who is signed in - the header says so, and the mutation controls scattered
 * through the pages ask whether that account may write.
 */
export function AppShell({
  children,
  pendingCount,
}: {
  children: React.ReactNode;
  pendingCount: number;
}) {
  const isNavigating = useIsNavigating();

  return (
    <SidebarProvider>
      <AppSidebar pendingCount={pendingCount} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="hidden text-sm text-muted-foreground sm:inline">
            Admin dashboard - reads and writes backend&apos;s MongoDB directly
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>
        {/* `aria-busy` is also the hook `.stale-dim` hangs off in `globals.css`: the regions that
            show data fade while it is set, and the controls beside them do not. */}
        <main className="flex-1 overflow-auto p-6" aria-busy={isNavigating}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
