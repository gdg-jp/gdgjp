import { AppShell, Icons, ThemeToggle } from "@gdgjp/design-system";
import { GdgAccountMenu } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";
import { NavLink } from "react-router";

export type ShellUser = { name: string; email: string; image: string | null };

const NAV = [
  { to: "/", label: "キャンペーン", icon: "LayoutGrid", end: true },
  { to: "/me", label: "自分のタスク", icon: "ListTodo", end: false },
  { to: "/contacts", label: "告知先", icon: "UsersRound", end: false },
  { to: "/admin/runner", label: "Runner", icon: "Bot", end: false },
] as const;

/** Frame for every signed-in page. */
export function AppLayout({
  user,
  accountsUrl,
  children,
}: { user: ShellUser; accountsUrl: string; children: ReactNode }) {
  return (
    <AppShell
      brand={
        <NavLink to="/" className="inline-flex items-center gap-2">
          <Icons name="Radio" size={20} aria-hidden="true" />
          GDG PR
        </NavLink>
      }
      navigation={
        <nav className="gdg-sidebar-nav" aria-label="メイン">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icons name={item.icon} size={18} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
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
