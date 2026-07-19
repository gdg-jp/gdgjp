import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";

export type TopBarUser = {
  email: string;
  image: string | null;
  isAdmin?: boolean;
  name: string;
};

export function TopBar({
  user,
  onOpenNavigation,
  navigationOpen = false,
}: {
  user: TopBarUser | null;
  onOpenNavigation?: () => void;
  navigationOpen?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 w-full items-center justify-between px-4">
        <Link to="/dashboard" prefetch="intent" className="flex items-center gap-3">
          <GdgMark size="sm" />
          <span className="font-medium tracking-tight">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-2">
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
              className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden motion-reduce:transition-none"
            >
              <Menu className="size-5" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
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
