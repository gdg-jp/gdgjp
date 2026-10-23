import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";

export type TopBarUser = { name: string; email: string; image: string | null };

/** Header: brand (or a page title) on the left, the shared GDG app launcher and account menu on the right. */
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
      <GdgAppLauncher ariaLabel="アプリ一覧" />
      <GdgAccountMenu
        accountUrl={`${accountsUrl}/dashboard`}
        onSignOut={() => window.location.assign("/auth/signout")}
        signOutLabel="ログアウト"
        user={user}
      />
    </header>
  );
}
