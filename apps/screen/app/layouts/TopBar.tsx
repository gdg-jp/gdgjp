import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";

export type TopBarUser = { name: string; email: string; image: string | null };

/** Operator header: brand on the left, the shared GDG app launcher and account menu on the right. */
export function TopBar({ user, accountsUrl }: { user: TopBarUser; accountsUrl: string }) {
  return (
    <header className="sc-topbar">
      <span className="sc-brand">screen.gdgs.jp</span>
      <span className="sc-spacer" />
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
