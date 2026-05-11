import { BarChart3, LinkIcon, Menu, Tag as TagIcon, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { ThemeToggle } from "~/components/theme-toggle";
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
    items: [{ to: "/links", label: "Links", icon: LinkIcon }],
  },
  {
    heading: "Insights",
    items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
  {
    heading: "Library",
    items: [{ to: "/tags", label: "Tags", icon: TagIcon }],
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
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/40 md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <GdgMark size="sm" />
        <span className="font-medium tracking-tight">GDG Japan Links</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <p className="px-2 pb-2 pt-1 text-base font-semibold tracking-tight">Short Links</p>
        <div className="space-y-4">
          {NAV_GROUPS.map((group, idx) => (
            <div key={group.heading ?? `group-${idx}`}>
              {group.heading ? (
                <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarLink key={item.to} item={item} active={isItemActive(item, pathname)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="flex items-center justify-between border-t px-3 py-2">
        <UserMenu user={user} />
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

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label="Navigation menu"
          className="fixed inset-y-0 left-0 z-50 w-72 bg-background shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex h-14 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <GdgMark size="sm" />
              <span className="font-medium tracking-tight">GDG Japan Links</span>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <nav className="overflow-y-auto p-3">
            <p className="px-2 pb-2 pt-1 text-base font-semibold tracking-tight">Short Links</p>
            <div className="space-y-4">
              {NAV_GROUPS.map((group, idx) => (
                <div key={group.heading ?? `group-${idx}`}>
                  {group.heading ? (
                    <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {group.heading}
                    </p>
                  ) : null}
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <SidebarLink
                        key={item.to}
                        item={item}
                        active={isItemActive(item, pathname)}
                        onClick={onClose}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MobileBar({ user }: { user: UserMenuUser | null }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:hidden">
        <Link to="/links" prefetch="intent" className="flex items-center gap-2">
          <GdgMark size="sm" />
          <span className="font-medium tracking-tight">GDG Japan Links</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <UserMenu user={user} />
        </div>
      </header>
      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
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
  return (
    <div className="min-h-dvh bg-background text-foreground md:flex">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar user={user} />
        <main className={cn("flex-1 px-4 py-6 md:px-8 md:py-8", className)}>{children}</main>
      </div>
    </div>
  );
}
