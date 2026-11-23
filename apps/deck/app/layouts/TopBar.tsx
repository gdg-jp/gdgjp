import { GdgAccountMenu, GdgAppLauncher, gdgAppLinks } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";

export type TopBarUser = { name: string; email: string; image: string | null };

export function TopBar({
  user,
  accountsUrl,
  children,
}: {
  user: TopBarUser;
  accountsUrl: string;
  children?: ReactNode;
}) {
  return (
    <header className="dk-topbar">
      {children ?? (
        <a href="/" className="dk-brand">
          deck.gdgs.jp
        </a>
      )}
      <span className="dk-spacer" />
      <GdgAppLauncher apps={gdgAppLinks(accountsUrl)} ariaLabel="アプリ一覧" />
      <GdgAccountMenu
        accountUrl={`${accountsUrl}/dashboard`}
        onSignOut={() => window.location.assign("/auth/signout")}
        signOutLabel="ログアウト"
        user={user}
      />
    </header>
  );
}
