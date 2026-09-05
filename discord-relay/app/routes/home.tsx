import { Header } from "~/components/header";
import { requireChapterAccess } from "~/lib/access.server";
import { getChapterDisplayNames } from "~/lib/chapters.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "ダッシュボード — Discord Relay" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireChapterAccess(env, request);
  const chapterIds = access.chapters.map((c) => c.chapterId);
  if (!chapterIds.includes(access.chapter.chapterId)) {
    chapterIds.push(access.chapter.chapterId);
  }
  const chapterNameMap = await getChapterDisplayNames(env.DB, chapterIds);
  const chapterNames = Object.fromEntries(chapterNameMap.entries());

  return {
    user: {
      name: access.user.name,
      email: access.user.email,
      image: access.user.image,
    },
    chapter: access.chapter,
    chapters: access.chapters,
    chapterNames,
    accountsUrl: env.ACCOUNTS_URL,
    isAdmin: access.isAdmin,
    crossChapter: access.crossChapter,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, chapter, chapters, chapterNames, accountsUrl, isAdmin, crossChapter } = loaderData;
  const currentName = chapterNames[chapter.chapterId] || chapter.chapterSlug;

  return (
    <div className="min-h-dvh bg-surface">
      <Header
        accountsUrl={accountsUrl}
        user={user}
        currentChapter={chapter}
        chapters={chapters}
        chapterNames={chapterNames}
      />

      <main className="mx-auto max-w-5xl p-6">
        <div className="space-y-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-neutral-900">Discord Relay Control Plane</h2>
            <p className="mt-1 text-sm text-neutral-600">
              ステージ 01: 認証・チャプター境界・監査ログの骨格が整備されています。
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  選択中のチャプター
                </span>
                <div className="mt-1 text-lg font-bold text-neutral-900">{currentName}</div>
                <div className="text-xs text-neutral-500">
                  Slug: {chapter.chapterSlug} (ID: {chapter.chapterId})
                </div>
                <div className="mt-2 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                  ロール: {chapter.role}
                </div>
                {crossChapter && (
                  <div className="mt-2 text-xs font-medium text-amber-700">
                    ※ 管理者横断アクセス中（監査ログに記録済み）
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  所属チャプター一覧 ({chapters.length})
                </span>
                <ul className="mt-2 divide-y divide-neutral-200 text-sm">
                  {chapters.map((ch) => (
                    <li key={ch.chapterId} className="flex items-center justify-between py-1.5">
                      <span className="font-medium text-neutral-800">
                        {chapterNames[ch.chapterId] || ch.chapterSlug}
                      </span>
                      <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700">
                        {ch.role}
                      </span>
                    </li>
                  ))}
                  {chapters.length === 0 && isAdmin && (
                    <li className="py-1 text-xs text-neutral-500">
                      所属チャプターなし（管理者権限で横断アクセス中）
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
