"use client";

import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Handshake,
  KeyRound,
  Mail,
  Mic,
  Monitor,
  ScrollText,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { usePendingNavigation } from "@/components/navigation-progress";
import { useSession } from "@/components/session-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { canAccessPath } from "@/lib/rbac";

interface NavEntry {
  href: string;
  label: string;
  icon: React.ComponentType;
}

const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/interviews", label: "Interviews", icon: Mic },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/sessions", label: "Sessions", icon: Monitor },
  { href: "/emails", label: "Email", icon: Mail },
  { href: "/audit-logs", label: "Audit Logs", icon: ScrollText },
  { href: "/resellers", label: "Resellers", icon: Handshake },
];

/**
 * Separated from the entity routes because these are about this dashboard rather than about the
 * product: every item above reads backend's data, and these two read who is allowed to.
 */
const ADMIN_NAV_ITEMS: NavEntry[] = [
  { href: "/reseller", label: "Reseller API", icon: KeyRound },
  { href: "/access", label: "Access", icon: ShieldCheck },
  { href: "/account", label: "Your account", icon: UserRound },
];

export function AppSidebar({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();
  const { role } = useSession();

  // No entry for a page the gate would refuse. Listing them disabled was the other option and it
  // reads worse: the sidebar is a map of where you can go, not a list of where you cannot.
  const visible = (item: NavEntry) => canAccessPath(role, item.href);
  const overview = NAV_ITEMS.filter(visible);
  const dashboard = ADMIN_NAV_ITEMS.filter(visible);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-3 transition-[padding] duration-200 ease-linear group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt=""
            width={32}
            height={32}
            loading="eager"
            className="size-8 shrink-0"
          />
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">Power Interview AI</span>
            <span className="text-xs text-muted-foreground">Admin</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* A role with no product-wide pages would otherwise get an empty "Overview" heading
            promising content that is not there. */}
        {overview.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Overview</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {overview.map((item) => (
                  <NavItem key={item.href} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>This dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dashboard.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  // Sign-ups wait on a human, and nothing else in the app would ever mention them.
                  // The badge is the only thing that turns "somebody requested access" into
                  // something an admin finds without going looking for it.
                  badge={item.href === "/access" && pendingCount > 0 ? pendingCount : undefined}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

/**
 * The clicked entry's icon turns into a spinner until the route answers. It has to be its own
 * component: `useLinkStatus` reports for the `<Link>` it is rendered inside, and `NavItem` is
 * outside it. The spinner takes the icon's place and size, so nothing in the row moves.
 */
function NavIcon({ icon: Icon }: { icon: React.ComponentType }) {
  const { pending } = useLinkStatus();
  usePendingNavigation(pending);

  return pending ? <Spinner /> : <Icon />;
}

function NavItem({
  item,
  pathname,
  badge,
}: {
  item: NavEntry;
  pathname: string;
  badge?: number;
}) {
  // "/" would otherwise prefix-match every route and stay lit on all of them.
  const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link href={item.href} />} isActive={isActive} tooltip={item.label}>
        <NavIcon icon={item.icon} />
        <span>{item.label}</span>
      </SidebarMenuButton>
      {badge !== undefined && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}
