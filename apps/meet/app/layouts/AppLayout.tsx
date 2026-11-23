import { AppShell, Icons, ThemeToggle } from "@gdgjp/design-system";
import { GdgAccountMenu } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { GoogleWorkspaceLogo } from "~/components/GoogleWorkspaceLogo";

export type AppUser = {
  name: string;
  email: string;
  image: string | null;
  isAdmin?: boolean;
};

export function AppLayout({
  user,
  accountsUrl,
  children,
}: {
  user: AppUser;
  accountsUrl: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  return (
    <AppShell
      collapsible="none"
      brand={
        <Link to="/" className="inline-flex items-center gap-2">
          <GoogleWorkspaceLogo brand="meet" size={20} />
          GDG Japan Meet
        </Link>
      }
      navigation={
        <nav className="gdg-sidebar-nav" aria-label="メイン">
          <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>
            <Icons name="CalendarDays" size={18} aria-hidden="true" />
            会議一覧
          </Link>
          {user.isAdmin && (
            <Link
              to="/admin/google"
              aria-current={pathname.startsWith("/admin/google") ? "page" : undefined}
            >
              <Icons name="Settings" size={18} aria-hidden="true" />
              Google 接続設定
            </Link>
          )}
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
