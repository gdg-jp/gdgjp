import { Blocks, ClipboardList, Code2, Settings2, Users, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ComponentType, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { TopBar, type TopBarUser } from "~/components/top-bar";
import { cn } from "~/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
};

export type AccountMembership = {
  chapter: { name: string; slug: string };
  role: "organizer" | "member";
  status: "pending" | "active";
};

function NavigationLink({
  item,
  onClick,
}: {
  item: NavItem;
  onClick?: () => void;
}) {
  const { pathname } = useLocation();
  const Icon = item.icon;
  const active = item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <Link
      to={item.to}
      onClick={onClick}
      prefetch="intent"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-foreground [&_svg]:text-primary"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

function Navigation({
  user,
  memberships,
  onNavigate,
}: {
  user: TopBarUser | null;
  memberships: AccountMembership[];
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const items: NavItem[] = [
    { to: "/chapters", label: t("nav.chapters"), icon: Blocks, exact: true },
  ];
  const canUseDeveloperTools = memberships.some((membership) => membership.status === "active");
  if (canUseDeveloperTools) {
    items.push({ to: "/developers/apps", label: t("nav.developerApps"), icon: Code2 });
  }
  const organizerItems = memberships
    .filter((membership) => membership.status === "active" && membership.role === "organizer")
    .map<NavItem>((membership) => ({
      to: `/chapters/${membership.chapter.slug}/organize`,
      label: membership.chapter.name,
      icon: Settings2,
    }));
  if (user?.isAdmin) {
    items.push(
      { to: "/admin/users", label: t("nav.users"), icon: Users },
      { to: "/admin/chapters", label: t("nav.manageChapters"), icon: Blocks },
      { to: "/admin/requests", label: t("nav.joinRequests"), icon: ClipboardList },
    );
  }

  return (
    <nav aria-label={t("nav.navigation")} className="flex-1 overflow-y-auto p-3">
      <div className="space-y-5">
        <div className="space-y-0.5">
          {items.map((item) => (
            <NavigationLink key={item.to} item={item} onClick={onNavigate} />
          ))}
        </div>
        {organizerItems.length > 0 ? (
          <section aria-label={t("nav.chapters")}>
            <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("nav.chapters")}
            </p>
            <div className="space-y-0.5">
              {organizerItems.map((item) => (
                <NavigationLink key={item.to} item={item} onClick={onNavigate} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </nav>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/dashboard"
      onClick={onNavigate}
      prefetch="intent"
      aria-label={t("nav.homeAria")}
      className="flex items-center gap-2"
    >
      <GdgMark size="sm" />
      <span className="font-medium tracking-tight">{t("app.name")}</span>
    </Link>
  );
}

function Sidebar({
  user,
  memberships,
}: { user: TopBarUser | null; memberships: AccountMembership[] }) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/40 md:sticky md:top-14 md:flex md:h-[calc(100dvh-3.5rem)] md:flex-col">
      <Navigation user={user} memberships={memberships} />
    </aside>
  );
}

function MobileDrawer({
  user,
  memberships,
  open,
  onClose,
}: {
  user: TopBarUser | null;
  memberships: AccountMembership[];
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label={t("nav.navigation")}
          className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-background shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left focus:outline-none motion-reduce:animate-none motion-reduce:transition-none"
        >
          <DialogPrimitive.Title className="sr-only">{t("nav.navigation")}</DialogPrimitive.Title>
          <div className="flex h-14 items-center justify-between border-b px-4">
            <Brand onNavigate={onClose} />
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label={t("nav.closeNavigation")}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <X className="size-5" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <Navigation user={user} memberships={memberships} onNavigate={onClose} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DashboardShell({
  user,
  memberships,
  children,
  className,
}: {
  user: TopBarUser | null;
  memberships: AccountMembership[];
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [navOpen, setNavOpen] = useState(false);
  const busy = navigation.state !== "idle";
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {busy ? (
        <>
          <output className="sr-only">{t("common.loading")}</output>
          <div
            aria-hidden="true"
            className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/20"
          >
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary motion-reduce:w-full" />
          </div>
        </>
      ) : null}
      <TopBar user={user} navigationOpen={navOpen} onOpenNavigation={() => setNavOpen(true)} />
      <MobileDrawer
        user={user}
        memberships={memberships}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar user={user} memberships={memberships} />
        <main className={cn("min-w-0 flex-1 px-4 py-4 md:px-6 md:py-5", className)}>
          {children}
        </main>
      </div>
    </div>
  );
}
