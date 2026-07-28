import type { AuthUser } from "@gdgjp/gdg-lib";
import { Grid3X3, Moon, Sun, UserRound } from "lucide-react";
import { Form, Link, NavLink } from "react-router";
import { useTheme } from "~/lib/theme";
import { chapterName } from "~/lib/utils";

type Chapter = { chapterId: number; chapterSlug: string; role: string };
export function AppShell({
  children,
  user,
  chapter,
  chapters,
}: { children: React.ReactNode; user: AuthUser; chapter: Chapter; chapters: Chapter[] }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="mx-auto min-h-dvh max-w-md border-x bg-background pb-20">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/90 px-3 backdrop-blur">
        <Link to="/posts" className="flex items-center gap-2 font-bold">
          <img src="/app-icon.png" alt="" width={28} height={28} className="size-7 rounded-full" />
          SNS Manager
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="テーマを切り替え"
            onClick={toggle}
            className="rounded-full p-2 hover:bg-muted"
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          <a
            href="https://gdgs.jp"
            className="rounded-full p-2 hover:bg-muted"
            aria-label="アプリ一覧"
          >
            <Grid3X3 className="size-5" />
          </a>
          <details className="relative">
            <summary className="flex list-none cursor-pointer items-center gap-1 rounded-full px-2 py-1 hover:bg-muted">
              <span className="max-w-20 truncate text-sm font-semibold">
                GDG {chapterName(chapter.chapterSlug)}
              </span>
              <UserRound className="size-5" />
            </summary>
            <div className="absolute right-0 top-10 z-30 w-72 rounded-xl border bg-card p-2 shadow-xl">
              {chapters.map((item) => (
                <Form method="post" action="/api/chapter" key={item.chapterId}>
                  <input type="hidden" name="chapterId" value={item.chapterId} />
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-muted"
                  >
                    GDG {chapterName(item.chapterSlug)}
                  </button>
                </Form>
              ))}
              <hr className="my-2" />
              <div className="flex gap-2 px-3 py-2">
                <UserRound className="size-8" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <hr className="my-2" />
              <a
                className="block rounded-lg px-3 py-2 text-sm hover:bg-muted"
                href="https://accounts.gdgs.jp/dashboard"
              >
                Manage your accounts
              </a>
              <hr className="my-2" />
              <a className="block rounded-lg px-3 py-2 text-sm hover:bg-muted" href="/auth/signout">
                Sign out
              </a>
            </div>
          </details>
        </div>
      </header>
      <main>{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-16 max-w-md border-t bg-background">
        <NavItem to="/posts" label="Posts" />
        <NavItem to="/schedule" label="Schedule" />
        <NavItem to="/settings" label="Settings" />
      </nav>
    </div>
  );
}
function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-1 items-center justify-center text-sm font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`
      }
    >
      {label}
    </NavLink>
  );
}
