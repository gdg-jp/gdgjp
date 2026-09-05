import { GdgAccountMenu, GdgAppLauncher } from "@gdgjp/gdg-lib/ui";
import type { UserChapter } from "~/lib/access.server";

export type HeaderProps = {
  title?: string;
  accountsUrl: string;
  user: {
    name: string;
    email: string;
    image: string | null;
  };
  currentChapter: UserChapter;
  chapters: UserChapter[];
  chapterNames?: Record<number, string>;
};

export function Header({
  title = "Discord Relay",
  accountsUrl,
  user,
  currentChapter,
  chapters,
  chapterNames = {},
}: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-4">
        <a href="/" className="text-xl font-bold text-neutral-900 hover:opacity-80">
          {title}
        </a>

        {/* SCR-602: Chapter Selector */}
        {chapters.length > 0 && (
          <form method="post" action="/api/chapter" className="flex items-center gap-2">
            <label htmlFor="chapter-select" className="sr-only">
              チャプター選択
            </label>
            <select
              id="chapter-select"
              name="chapterId"
              value={currentChapter.chapterId}
              onChange={(e) => e.target.form?.submit()}
              className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100 focus:border-blue-500 focus:outline-none"
            >
              {chapters.map((ch) => (
                <option key={ch.chapterId} value={ch.chapterId}>
                  {chapterNames[ch.chapterId] || ch.chapterSlug}
                </option>
              ))}
            </select>
          </form>
        )}
      </div>

      <div className="flex items-center gap-2">
        <GdgAppLauncher />
        <GdgAccountMenu
          accountUrl={`${accountsUrl}/dashboard`}
          onSignOut={() => window.location.assign("/auth/signout")}
          signOutLabel="ログアウト"
          user={{ name: user.name, email: user.email, image: user.image }}
        />
      </div>
    </header>
  );
}
