import { AppShell, Icons, ThemeToggle } from "@gdgjp/design-system";
import { GdgAccountMenu } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";

export type AdminUser = { name: string; email: string; image: string | null };

/** Frame for the signed-in pages: project list and project admin. */
export function AdminLayout({
  user,
  accountsUrl,
  children,
}: {
  user: AdminUser;
  accountsUrl: string;
  children: ReactNode;
}) {
  return (
    <AppShell
      // One navigation item: nothing to collapse (same as tinyurl).
      collapsible="none"
      brand={
        <Link to="/" className="inline-flex items-center gap-2">
          <Icons name="LoaderPinwheel" size={20} aria-hidden="true" />
          GDG Roulette
        </Link>
      }
      navigation={
        <nav className="gdg-sidebar-nav" aria-label="メイン">
          <Link to="/" aria-current="page">
            <Icons name="LayoutGrid" size={18} aria-hidden="true" />
            プロジェクト
          </Link>
        </nav>
      }
      footer={
        <div className="flex min-w-0 items-center gap-1">
          <GdgAccountMenu
            accountUrl={`${accountsUrl}/dashboard`}
            onSignOut={() => window.location.assign("/auth/signout")}
            signOutLabel="ログアウト"
            user={user}
          />
          <div className="ml-auto">
            <ThemeToggle aria-label="テーマを切り替える" />
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
