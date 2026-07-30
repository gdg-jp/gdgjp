import type { AuthUser } from "@gdgjp/gdg-lib";
import { GdgAccountMenu, GdgAppLauncher, GdgThemeToggle } from "@gdgjp/gdg-lib/ui";
import { ChevronDown, SquarePen } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Form, Link, NavLink, useLocation } from "react-router";
import { chapterName } from "~/lib/utils";

type Chapter = { chapterId: number; chapterSlug: string; role: string };
export function AppShell({
  children,
  user,
  chapter,
  chapters,
  showFab = true,
}: {
  children: React.ReactNode;
  user: AuthUser;
  chapter: Chapter;
  chapters: Chapter[];
  showFab?: boolean;
}) {
  const { pathname } = useLocation();
  return (
    <div className="mx-auto min-h-dvh max-w-md bg-background pb-20 md:border-x">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/90 px-3 backdrop-blur">
        <Link to="/posts" className="flex items-center gap-2 font-bold">
          <img src="/app-icon.png" alt="" width={28} height={28} className="size-7 rounded-full" />
          SNS Manager
        </Link>
        <div className="flex items-center gap-1">
          <GdgThemeToggle ariaLabel="テーマを切り替え" />
          <GdgAppLauncher ariaLabel="アプリ一覧" />
          <GdgAccountMenu
            accountUrl="https://accounts.gdgs.jp/dashboard"
            onSignOut={() => window.location.assign("/auth/signout")}
            user={user}
            trigger={
              <button
                type="button"
                aria-label={`チャプターを選択: GDG ${chapterName(chapter.chapterSlug)}`}
                className="inline-flex h-8 max-w-36 items-center gap-1 rounded-md border border-input bg-background px-2 text-sm font-medium shadow-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="truncate">GDG {chapterName(chapter.chapterSlug)}</span>
                <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
              </button>
            }
          >
            <ChapterMenu chapter={chapter} chapters={chapters} />
          </GdgAccountMenu>
        </div>
      </header>
      <main>{children}</main>
      {showFab && pathname !== "/schedule" ? (
        <Link
          to="/schedule"
          aria-label="投稿を予約する"
          className="fixed right-[max(1rem,calc((100vw-28rem)/2+1rem))] bottom-20 z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-95"
        >
          <SquarePen className="size-7" aria-hidden="true" />
        </Link>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-16 max-w-md border-t bg-background">
        <NavItem to="/posts" label="Posts" />
        <NavItem to="/schedule" label="Schedule" />
        <NavItem to="/settings" label="Settings" />
      </nav>
    </div>
  );
}

function ChapterMenu({ chapter, chapters }: { chapter: Chapter; chapters: Chapter[] }) {
  return (
    <div className="px-1">
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Chapter</p>
      {chapters.map((item) => {
        const isCurrent = item.chapterId === chapter.chapterId;
        return (
          <Form method="post" action="/api/chapter" key={item.chapterId}>
            <input type="hidden" name="chapterId" value={item.chapterId} />
            <DropdownMenuPrimitive.Item asChild>
              <button
                type="submit"
                className="flex w-full items-center rounded-xl px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent focus:bg-accent"
                aria-current={isCurrent ? "true" : undefined}
              >
                GDG {chapterName(item.chapterSlug)}
              </button>
            </DropdownMenuPrimitive.Item>
          </Form>
        );
      })}
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
