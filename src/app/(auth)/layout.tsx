import Image from "next/image";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The signed-out chrome: no sidebar, nothing that would need a session to render. It sits beside
 * `(dashboard)` rather than inside it precisely so that nothing here can accidentally depend on an
 * account - the sign-in form is the one page that has to work without one.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt=""
            width={32}
            height={32}
            loading="eager"
            className="size-8 shrink-0"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Power Interview AI</span>
            <span className="text-xs text-muted-foreground">Admin</span>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
