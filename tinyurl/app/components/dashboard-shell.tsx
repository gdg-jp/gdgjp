import {
  BarChart3,
  Folder,
  FolderTree,
  Globe2,
  LinkIcon,
  MoreHorizontal,
  Tag as TagIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigation, useRouteLoaderData } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { ThemeToggle } from "~/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { UserMenu, type UserMenuUser } from "~/components/user-menu";
import { cn } from "~/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LinkIcon;
};

type NavGroup = {
  heading?: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: "/links", label: "Links", icon: LinkIcon },
      { to: "/domains", label: "Domains", icon: Globe2 },
    ],
  },
  {
    heading: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/campaigns", label: "Campaigns", icon: FolderTree },
    ],
  },
  {
    heading: "Library",
    items: [
      { to: "/folders", label: "Folders", icon: Folder },
      { to: "/tags", label: "Tags", icon: TagIcon },
    ],
  },
];

function SidebarLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      prefetch="intent"
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-foreground font-medium [&_svg]:text-primary"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

function Sidebar({ user }: { user: UserMenuUser | null }) {
  const { pathname } = useLocation();
  const rootData = useRouteLoaderData("root") as { domainsEnabled?: boolean } | undefined;
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/40 md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <GdgMark size="sm" />
        <span className="font-medium tracking-tight">GDG Japan Links</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-4">
          {NAV_GROUPS.map((group, idx) => (
            <div key={group.heading ?? `group-${idx}`}>
              {group.heading ? (
                <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items
                  .filter((item) => item.to !== "/domains" || rootData?.domainsEnabled)
                  .map((item) => (
                    <SidebarLink key={item.to} item={item} active={isItemActive(item, pathname)} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="flex items-center justify-between border-t px-3 py-2">
        <UserMenu user={user} launcherPosition="right" />
        <ThemeToggle />
      </div>
    </aside>
  );
}

function isItemActive(item: NavItem, pathname: string) {
  return item.to === "/links"
    ? pathname === "/" || pathname === "/links" || pathname.startsWith("/links/")
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

const MOBILE_NAV_ITEMS: NavItem[] = [
  { to: "/links", label: "Links", icon: LinkIcon },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/campaigns", label: "Campaigns", icon: FolderTree },
];

const MOBILE_MORE_ITEMS: NavItem[] = [
  { to: "/domains", label: "Domains", icon: Globe2 },
  { to: "/folders", label: "Folders", icon: Folder },
  { to: "/tags", label: "Tags", icon: TagIcon },
];

function MobileBottomNav() {
  const { pathname } = useLocation();
  const rootData = useRouteLoaderData("root") as { domainsEnabled?: boolean } | undefined;
  const moreActive = MOBILE_MORE_ITEMS.some((item) => isItemActive(item, pathname));

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-start border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur md:hidden"
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(item, pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            prefetch="intent"
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More navigation options"
            className={cn(
              "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MoreHorizontal className="size-5" />
            More
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="mb-1 min-w-36">
          {MOBILE_MORE_ITEMS.filter(
            (item) => item.to !== "/domains" || rootData?.domainsEnabled,
          ).map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem key={item.to} asChild>
                <Link to={item.to} prefetch="intent">
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

function MobileBar({ user }: { user: UserMenuUser | null }) {
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:hidden">
        <Link to="/links" prefetch="intent" className="flex items-center gap-2">
          <GdgMark size="sm" />
          <span className="font-medium tracking-tight">GDG Japan Links</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </header>
      <MobileBottomNav />
    </>
  );
}

export function DashboardShell({
  user,
  children,
  className,
}: {
  user: UserMenuUser | null;
  children: ReactNode;
  className?: string;
}) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="min-h-dvh bg-background text-foreground md:flex">
      {busy ? (
        <>
          <output className="sr-only">Loading page</output>
          <div
            aria-hidden="true"
            className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/20"
          >
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary motion-reduce:w-full" />
          </div>
        </>
      ) : null}
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar user={user} />
        <main className={cn("flex-1 px-4 py-6 pb-24 md:px-8 md:py-8", className)}>{children}</main>
      </div>
    </div>
  );
}
