"use client";

import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The providers every route needs, signed in or not. Split out of `AppShell` when the sign-in and
 * sign-up pages arrived: those render outside the dashboard chrome but still need the theme (the
 * palette is unreachable without the provider) and the toaster (a failed sign-in reports through
 * it). `AppShell` is now only the sidebar and the header, and hangs below the authenticated half.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
