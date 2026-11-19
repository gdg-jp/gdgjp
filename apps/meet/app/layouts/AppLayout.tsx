import { AppShell, Icons, ThemeToggle } from "@gdgjp/design-system";
import { GdgAccountMenu } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";

export type AppUser = { name: string; email: string; image: string | null };

/** Shared shell for signed-in GDG Japan Meet pages. */
export function AppLayout({
  user,
  accountsUrl,
  children,
}: {
  user: AppUser;
  accountsUrl: string;
  children: ReactNode;
}) {
  return (
    <AppShell
      collapsible="none"
      brand={
        <Link to="/" className="inline-flex items-center gap-2">
          <Icons name="Users" size={20} aria-hidden="true" />
          GDG Japan Meet
        </Link>
      }
      navigation={
        <nav className="gdg-sidebar-nav" aria-label="メイン">
          <Link to="/" aria-current="page">
            <Icons name="CalendarDays" size={18} aria-hidden="true" />
            会議一覧
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
