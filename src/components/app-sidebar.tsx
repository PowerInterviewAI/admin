"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Mail,
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
import { isAdminOnlyPath } from "@/lib/auth-routes";

interface NavEntry {
  href: string;
  label: string;
  icon: React.ComponentType;
}

const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/sessions", label: "Sessions", icon: Monitor },
  { href: "/emails", label: "Email", icon: Mail },
  { href: "/audit-logs", label: "Audit Logs", icon: ScrollText },
];

/**
 * Separated from the entity routes because these are about this dashboard rather than about the
 * product: every item above reads backend's data, and these two read who is allowed to.
 */
const ADMIN_NAV_ITEMS: NavEntry[] = [
  { href: "/access", label: "Access", icon: ShieldCheck },
  { href: "/account", label: "Your account", icon: UserRound },
];

export function AppSidebar({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();
  const isAdmin = useSession().role === "admin";

  // A guest gets no entry for a page the gate would refuse. Listing them disabled was the other
  // option and it reads worse: the sidebar is a map of where you can go, and five of the six
  // entries above are places this account genuinely can.
  const visible = (item: NavEntry) => isAdmin || !isAdminOnlyPath(item.href);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-sm">
            PI
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">Power Interview AI</span>
            <span className="text-xs text-muted-foreground">Admin</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter(visible).map((item) => (
                <NavItem key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>This dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_NAV_ITEMS.filter(visible).map((item) => (
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
