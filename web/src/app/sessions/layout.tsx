import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionsLayout({ children }: LayoutProps<"/sessions">) {
  return children;
}
