import type { IconName } from "@gdgjp/ui";
import {
  AppShell,
  Icons,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@gdgjp/ui";
import { cn } from "@gdgjp/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { TopBar, type TopBarNavItem, type TopBarUser } from "~/components/top-bar";
import { isOrganizerPlus } from "~/lib/permissions";

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  exact?: boolean;
};

export type AccountMembership = {
  chapter: { name: string; slug: string };
  role: "organizer" | "member";
  status: "pending" | "active";
};

function Navigation({
  user,
  memberships,
}: {
  user: TopBarUser | null;
  memberships: AccountMembership[];
}) {
  const { t } = useTranslation();
  const items: NavItem[] = [
    { to: "/chapters", label: t("nav.chapters"), icon: "Blocks", exact: true },
  ];
  const canUseDeveloperTools = memberships.some((membership) => membership.status === "active");
  if (canUseDeveloperTools) {
    items.push({ to: "/developers/apps", label: t("nav.developerApps"), icon: "Key" });
  }
  const organizerItems = memberships
    .filter((membership) => membership.status === "active" && membership.role === "organizer")
    .map<NavItem>((membership) => ({
      to: `/chapters/${membership.chapter.slug}/organize`,
      label: membership.chapter.name,
      icon: "Settings",
    }));
  if (user?.isAdmin) {
    items.push(
      { to: "/admin/users", label: t("nav.users"), icon: "Users" },
      { to: "/admin/chapters", label: t("nav.manageChapters"), icon: "Blocks" },
      { to: "/admin/requests", label: t("nav.joinRequests"), icon: "ClipboardCheck" },
    );
  }

  return (
    <nav aria-label={t("nav.navigation")} className="flex-1 overflow-y-auto p-3">
      <SidebarMenu>
        {items.map((item) => (
          <NavigationLink key={item.to} item={item} />
        ))}
      </SidebarMenu>
      {organizerItems.length > 0 ? (
        <section aria-label={t("nav.chapters")} className="mt-5">
          <SidebarGroupLabel>{t("nav.chapters")}</SidebarGroupLabel>
          <SidebarMenu>
            {organizerItems.map((item) => (
              <NavigationLink key={item.to} item={item} />
            ))}
          </SidebarMenu>
        </section>
      ) : null}
    </nav>
  );
}

function NavigationLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const active = item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <Link to={item.to} prefetch="intent" aria-current={active ? "page" : undefined}>
          <Icons name={item.icon} size={18} aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function Brand() {
  const { t } = useTranslation();
  return (
    <Link
      to="/dashboard"
      prefetch="intent"
      aria-label={t("nav.homeAria")}
      className="flex items-center gap-2"
    >
      <GdgMark size="sm" />
      <span className="font-medium tracking-tight">{t("app.name")}</span>
    </Link>
  );
}

function memberPrimaryNav(
  memberships: AccountMembership[],
  t: (key: string) => string,
): TopBarNavItem[] {
  const items: TopBarNavItem[] = [{ to: "/chapters", label: t("nav.chapters"), exact: true }];
  if (memberships.some((membership) => membership.status === "active")) {
    items.push({ to: "/developers/apps", label: t("nav.developerApps") });
  }
  return items;
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
  const busy = navigation.state !== "idle";
  const organizerChrome = user ? isOrganizerPlus(user, memberships) : false;
  const primaryNav = organizerChrome ? undefined : memberPrimaryNav(memberships, t);
  const content = (
    <>
      {busy ? (
        <>
          <output className="gdg-sr-only">{t("common.loading")}</output>
          <div
            aria-hidden="true"
            className="dashboard-navigation-progress fixed inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/20"
          >
            <div className="navigation-progress h-full w-2/5 rounded-full bg-primary motion-reduce:w-full" />
          </div>
        </>
      ) : null}
      {children}
    </>
  );

  if (organizerChrome) {
    return (
      <AppShell
        brand={<Brand />}
        navigation={<Navigation user={user} memberships={memberships} />}
        header={<TopBar user={user} showBrand={false} />}
        navigationLabel={t("nav.navigation")}
        navigationDescription={t("nav.navigationDescription")}
        closeNavigationLabel={t("nav.closeNavigation")}
        skipLinkLabel={t("nav.skipToContent")}
        collapsible="icon"
      >
        <div aria-busy={busy || undefined} className={cn("min-w-0", className)}>
          {content}
        </div>
      </AppShell>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {busy ? (
        <>
          <output className="gdg-sr-only">{t("common.loading")}</output>
          <div
            aria-hidden="true"
            className="dashboard-navigation-progress fixed inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/20"
          >
            <div className="navigation-progress h-full w-2/5 rounded-full bg-primary motion-reduce:w-full" />
          </div>
        </>
      ) : null}
      <header className="dashboard-top-bar sticky top-0 z-30 bg-surface">
        <TopBar user={user} primaryNav={primaryNav} />
      </header>
      <main
        aria-busy={busy || undefined}
        className={cn("min-w-0 px-4 py-4 md:px-6 md:py-5", className)}
      >
        {children}
      </main>
    </div>
  );
}
