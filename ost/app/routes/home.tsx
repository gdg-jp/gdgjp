import { AnimatePresence, motion } from "motion/react";
import { Form, Link, useNavigation } from "react-router";
import { Header } from "~/components/header";
import { requireUserWithChapter } from "~/lib/auth-redirect.server";
import { createEvent, listEventsForChapters } from "~/lib/db";
import { listItem, tapSubtle, transitions } from "~/lib/motion";
import { normalizeSlug } from "~/lib/slug";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "OST イベント一覧" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const events = await listEventsForChapters(
    env.DB,
    chapters.map((c) => c.chapterId),
  );
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters,
    events,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const form = await request.formData();

  const title = String(form.get("title") ?? "").trim();
  const slug = normalizeSlug(form.get("slug"));
  const chapterId = Number.parseInt(String(form.get("chapterId") ?? ""), 10);
  const chapter = chapters.find((c) => c.chapterId === chapterId);

  if (!title) return { error: "イベント名を入力してください。" };
  if (!slug) {
    return { error: "URL には英小文字・数字・ハイフンのみ使えます（1〜40文字、予約語は不可）。" };
  }
  if (!chapter) return { error: "チャプターを選択してください。" };

  const result = await createEvent(env.DB, {
    slug,
    title,
    chapterId: chapter.chapterId,
    chapterSlug: chapter.chapterSlug,
    createdBy: user.id,
  });
  if (!result.ok) {
    return { error: `URL「${slug}」は既に使われています。` };
  }
  return { created: result.event.slug };
}

export default function Dashboard({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, chapters, events } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 lg:p-10">
      <Header title="OST イベント" accountsUrl={accountsUrl} user={user} />

      <section className="space-y-4 rounded-[2rem] border-2 border-black bg-white p-6 sm:p-8">
        <h2 className="text-xl font-bold">新しいイベントを作成</h2>
        <Form method="post" className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">イベント名</span>
            <input
              name="title"
              required
              maxLength={120}
              placeholder="DevFest Tokyo 2026"
              className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">URL（ost.gdgs.jp/◯◯◯）</span>
            <input
              name="slug"
              required
              pattern="[a-z0-9-]{1,40}"
              placeholder="devfest-tokyo-2026"
              className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">チャプター</span>
            <select
              name="chapterId"
              required
              defaultValue={chapters[0]?.chapterId}
              className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            >
              {chapters.map((c) => (
                <option key={c.chapterId} value={c.chapterId}>
                  {c.chapterSlug}
                </option>
              ))}
            </select>
          </label>

          <AnimatePresence mode="wait">
            {actionData && "error" in actionData && actionData.error ? (
              <motion.p
                key="error"
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={transitions.fade}
                className="text-sm font-medium text-gdg-red"
              >
                {actionData.error}
              </motion.p>
            ) : actionData && "created" in actionData && actionData.created ? (
              <motion.p
                key="created"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={transitions.fade}
                className="text-sm font-medium text-gdg-green"
              >
                作成しました。
                <Link className="underline" to={`/${actionData.created}/edit`}>
                  {actionData.created} を設定する
                </Link>
              </motion.p>
            ) : null}
          </AnimatePresence>

          <motion.button
            {...tapSubtle}
            type="submit"
            disabled={submitting}
            className="rounded-full border-2 border-black bg-gdg-blue px-6 py-2.5 font-bold text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {submitting ? "作成中…" : "作成する"}
          </motion.button>
        </Form>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">イベント</h2>
        {events.length === 0 ? (
          <p className="text-neutral-600">まだイベントがありません。</p>
        ) : (
          <ul className="space-y-3">
            {events.map((e, i) => (
              <motion.li
                key={e.slug}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...transitions.fade, delay: Math.min(i * 0.04, 0.3) }}
                className="rounded-2xl border-2 border-black bg-white p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-bold">{e.title}</span>
                  <span className="text-sm text-neutral-500">{e.chapterSlug}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm font-medium">
                  <Link className="text-gdg-blue underline" to={`/${e.slug}`}>
                    参加者ページ
                  </Link>
                  <Link className="text-gdg-blue underline" to={`/${e.slug}/screen`}>
                    スクリーン
                  </Link>
                  <Link className="text-gdg-blue underline" to={`/${e.slug}/tables`}>
                    机の割り当て
                  </Link>
                  <Link className="text-gdg-blue underline" to={`/${e.slug}/edit`}>
                    設定
                  </Link>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
