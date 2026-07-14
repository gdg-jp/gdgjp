import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";

export type TopBarUser = {
  email: string;
  image: string | null;
  name: string;
};

export function TopBar({ user }: { user: TopBarUser | null }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/dashboard" prefetch="intent" className="flex items-center gap-3">
          <GdgMark size="sm" />
          <span className="font-medium tracking-tight">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          {user ? <GdgAppLauncher /> : null}
          <UserMenu user={user} />
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
