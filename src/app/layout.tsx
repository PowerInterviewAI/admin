import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { AppProviders } from "@/components/app-providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Dashboard | Power Interview AI Admin",
    template: "%s | Power Interview AI Admin",
  },
  description: "Admin dashboard for Power Interview AI",
};

/**
 * Only the document and the providers. The sidebar and header moved into `(dashboard)/layout.tsx`
 * when sign-in arrived: those routes render outside the chrome, and a shell that had to be told
 * which pathname it was on to decide whether to draw itself would be the wrong shape for what is
 * really two different layouts.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
