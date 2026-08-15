import type { Metadata } from "next";

export const metadata: Metadata = { title: "Users" };

export default function UsersLayout({ children }: LayoutProps<"/users">) {
  return children;
}
