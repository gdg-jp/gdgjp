import { AppShell, Icons, ThemeToggle } from "@gdgjp/design-system";
import { GdgAccountMenu } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useRouteLoaderData } from "react-router";
import { ChapterSwitcher } from "./ChapterSwitcher";

export type ShellUser = { name: string; email: string; image: string | null };

/** What `routes/shell.tsx` loads for every signed-in page. */
type ShellData = {
  user: ShellUser;
  accountsUrl: string;
  chapters: { id: number; slug: string }[];
  chapterId: number;
};

const NAV = [
  { to: "/", label: "通知", icon: "Bell", end: true },
  { to: "/events", label: "イベント", icon: "CalendarDays", end: false, also: "/c/" },
  { to: "/contacts", label: "告知先", icon: "UsersRound", end: false },
  { to: "/settings", label: "設定", icon: "Settings", end: false },
] as const;

/** A campaign's pages (/c/…) belong to イベント. */
function isActive(item: (typeof NAV)[number], pathname: string) {
  if (item.end) return pathname === item.to;
  return (
    pathname === item.to ||
    pathname.startsWith(`${item.to}/`) ||
    ("also" in item && pathname.startsWith(item.also))
  );
}

/** Frame for every signed-in page. The user and chapter come from the shell route. */
export function AppLayout({
  user: userProp,
  accountsUrl: accountsProp,
  children,
}: { user?: ShellUser; accountsUrl?: string; children: ReactNode }) {
  const shell = useRouteLoaderData("shell") as ShellData | undefined;
  const { pathname } = useLocation();
  const user = shell?.user ?? userProp;
  const accountsUrl = shell?.accountsUrl ?? accountsProp ?? "";
  return (
    <AppShell
      brand={
        shell ? (
          <ChapterSwitcher chapters={shell.chapters} chapterId={shell.chapterId} />
        ) : (
          <NavLink to="/" className="inline-flex items-center gap-2">
            <Icons name="Radio" size={20} aria-hidden="true" />
            GDG PR
          </NavLink>
        )
      }
      navigation={
        <nav className="gdg-sidebar-nav" aria-label="メイン">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(item, pathname) ? "page" : undefined}
            >
              <Icons name={item.icon} size={18} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      }
      footer={
        user ? (
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
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
