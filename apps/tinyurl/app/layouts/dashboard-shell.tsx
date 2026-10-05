import {
  AppShell,
  type IconName,
  Icons,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarNav,
  Spinner,
  ThemeToggle,
} from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigation, useRouteLoaderData } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { UserMenu, type UserMenuUser } from "~/layouts/user-menu";

type NavItem = { to: string; label: string; icon: IconName };
const NAV_GROUPS: Array<{ heading?: string; items: NavItem[] }> = [
  {
    items: [
      { to: "/links", label: "Links", icon: "Link" },
      { to: "/domains", label: "Domains", icon: "Globe2" },
    ],
  },
  {
    heading: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", icon: "ChartColumnIncreasing" },
      { to: "/campaigns", label: "Campaigns", icon: "FolderTree" },
    ],
  },
  {
    heading: "Library",
    items: [
      { to: "/folders", label: "Folders", icon: "Folder" },
      { to: "/tags", label: "Tags", icon: "Tag" },
    ],
  },
];
function isItemActive(item: NavItem, pathname: string) {
  return item.to === "/links"
    ? pathname === "/" || pathname === "/links" || pathname.startsWith("/links/")
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}
export function DashboardShell({
  user,
  children,
  className,
}: { user: UserMenuUser | null; children: ReactNode; className?: string }) {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const rootData = useRouteLoaderData("root") as { domainsEnabled?: boolean } | undefined;
  return (
    <AppShell
      collapsible="none"
      mainClassName="w-full max-w-none"
      brand={
        <Link to="/links" className="flex items-center gap-2">
          <GdgMark size="sm" />
          <span>GDG Japan Links</span>
        </Link>
      }
      navigation={
        <SidebarNav aria-label="Primary navigation">
          {NAV_GROUPS.map((group, index) => (
            <div key={group.heading ?? index} className="space-y-1">
              {group.heading && <SidebarGroupLabel>{group.heading}</SidebarGroupLabel>}
              <SidebarMenu>
                {group.items
                  .filter((item) => item.to !== "/domains" || rootData?.domainsEnabled)
                  .map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isItemActive(item, pathname)}>
                        <Link
                          aria-label={item.label}
                          to={item.to}
                          prefetch="intent"
                          aria-current={isItemActive(item, pathname) ? "page" : undefined}
                        >
                          <Icons name={item.icon} size={18} aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </div>
          ))}
        </SidebarNav>
      }
      footer={
        <div className="flex min-w-0 items-center gap-1">
          <UserMenu user={user} launcherPosition="right" />
          <div className="ml-auto">
            <ThemeToggle aria-label="Toggle theme" />
          </div>
          {navigation.state !== "idle" && <Spinner label="Loading page" />}
        </div>
      }
    >
      <div className={className}>{children}</div>
    </AppShell>
  );
}
