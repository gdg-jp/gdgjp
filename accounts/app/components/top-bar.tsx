import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Icons,
} from "@gdgjp/ui";
import { cn } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";

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
  showBrand = true,
}: {
  user: TopBarUser | null;
  primaryNav?: TopBarNavItem[];
  showBrand?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-16 w-full items-center justify-between gap-3 px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3 md:gap-6">
        {showBrand ? (
          <Link
            to="/dashboard"
            prefetch="intent"
            className="group flex shrink-0 items-center gap-3 rounded-md outline-none"
          >
            <GdgMark size="sm" />
            <span className="hidden font-medium tracking-tight sm:inline">{t("app.name")}</span>
          </Link>
        ) : null}
        {primaryNav && primaryNav.length > 0 ? (
          <nav aria-label={t("nav.navigation")} className="flex min-w-0 items-center gap-1">
            {primaryNav.map((item) => (
              <PrimaryNavLink key={item.to} item={item} />
            ))}
          </nav>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <LocaleSwitcher />
        <ThemeToggle />
        {user ? <AppLauncher /> : null}
        <UserMenu user={user} />
      </div>
    </div>
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
        "truncate rounded-md px-2 py-1.5 text-sm",
        active ? "bg-selected font-medium text-foreground" : "text-muted hover:bg-selected",
      )}
    >
      {item.label}
    </Link>
  );
}

function AppLauncher() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" aria-label={t("nav.appLauncher")}>
          <Icons name="LayoutGrid" size={18} aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-4">
        <div className="grid grid-cols-3 gap-3">
          {GDG_APP_LINKS.map((app) => (
            <DropdownMenuItem
              key={app.url}
              asChild
              className="aspect-square flex-col justify-center gap-2 px-1 py-2 text-center"
            >
              <a href={app.url} target="_blank" rel="noreferrer">
                <img
                  src={app.iconUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 object-contain"
                />
                <span className="w-full truncate font-medium">{app.label}</span>
              </a>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: TopBarUser | null }) {
  const { t } = useTranslation();
  if (!user) return null;

  function signOut() {
    window.location.assign("/auth/signout");
  }

  const title = user.name || user.email;
  const initials = (title.match(/\p{L}/gu) ?? []).slice(0, 2).join("").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          aria-label={t("auth.manageAccount")}
          title={title}
          className="p-1"
        >
          <Avatar
            src={user.image ?? undefined}
            alt={title}
            fallback={initials || "?"}
            className="size-8"
          />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate font-medium">{title}</span>
          {user.name ? (
            <span className="block truncate text-sm text-muted">{user.email}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard" prefetch="intent">
            <Icons name="Settings" size={16} aria-hidden="true" />
            {t("auth.manageAccount")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <Icons name="Logout" size={16} aria-hidden="true" />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
