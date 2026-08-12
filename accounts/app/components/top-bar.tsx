import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { cn } from "~/lib/utils";

export type TopBarUser = {
  email: string;
  image: string | null;
  isAdmin?: boolean;
  name: string;
};

export type TopBarNavItem = {
  to: string;
  label: string;
  exact?: boolean;
};

export function TopBar({
  user,
  primaryNav,
  onOpenNavigation,
  navigationOpen = false,
}: {
  user: TopBarUser | null;
  primaryNav?: TopBarNavItem[];
  onOpenNavigation?: () => void;
  navigationOpen?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur transition-[background-color,border-color,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-out-quart)] supports-[backdrop-filter]:bg-background/60 motion-reduce:transition-none">
      <div className="flex h-14 w-full items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-6">
          <Link
            to="/dashboard"
            prefetch="intent"
            className="group flex shrink-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <GdgMark
              size="sm"
              className="transition-transform duration-[var(--motion-base)] ease-[var(--ease-out-quart)] group-hover:rotate-2 group-hover:scale-105 group-active:scale-95 motion-reduce:transform-none motion-reduce:transition-none"
            />
            <span className="hidden font-medium tracking-tight transition-colors duration-[var(--motion-fast)] group-hover:text-primary sm:inline motion-reduce:transition-none">
              {t("app.name")}
            </span>
          </Link>
          {primaryNav && primaryNav.length > 0 ? (
            <nav aria-label={t("nav.navigation")} className="flex min-w-0 items-center gap-1">
              {primaryNav.map((item) => (
                <PrimaryNavLink key={item.to} item={item} />
              ))}
            </nav>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          {user ? <GdgAppLauncher /> : null}
          <UserMenu user={user} />
          {onOpenNavigation ? (
            <button
              type="button"
              onClick={onOpenNavigation}
              aria-label={t("nav.openNavigation")}
              aria-expanded={navigationOpen}
              className={cn(
                "group rounded-md p-1 text-muted-foreground transition-[color,background-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-out-quart)] hover:bg-accent hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden motion-reduce:transform-none motion-reduce:transition-none",
                navigationOpen && "bg-accent text-foreground",
              )}
            >
              <Menu
                className={cn(
                  "size-5 transition-transform duration-[var(--motion-base)] ease-[var(--ease-out-quart)] motion-reduce:transform-none motion-reduce:transition-none",
                  navigationOpen && "rotate-90",
                )}
              />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function PrimaryNavLink({ item }: { item: TopBarNavItem }) {
  const { pathname } = useLocation();
  const active = item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <Link
      to={item.to}
      prefetch="intent"
      aria-current={active ? "page" : undefined}
      className={cn(
        "truncate rounded-md px-2 py-1.5 text-sm transition-[color,background-color] duration-[var(--motion-fast)] ease-[var(--ease-out-quart)] motion-reduce:transition-none",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {item.label}
    </Link>
  );
}

function UserMenu({ user }: { user: TopBarUser | null }) {
  const { t } = useTranslation();
  if (!user) return null;

  function signOut() {
    window.location.assign("/auth/signout");
  }

  return (
    <GdgAccountMenu
      accountUrl="/dashboard"
      onSignOut={signOut}
      signOutLabel={t("auth.signOut")}
      user={user}
    />
  );
}
