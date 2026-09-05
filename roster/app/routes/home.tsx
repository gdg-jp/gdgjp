import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "roster イベント一覧" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, request);
  return { user: { name: user.name, email: user.email }, chapterSlug: chapter.chapterSlug };
}

/**
 * Placeholder dashboard. Stage 02 replaces this with the real event list +
 * create form (docs/roster/index.md §6, screen `/`) — this stage only proves
 * the auth + chapter gate works.
 */
export default function Dashboard({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 p-6 lg:p-10">
      <h1 className="text-2xl font-bold">roster イベント</h1>
      <p className="text-neutral-600">
        {loaderData.user.name} さん（{loaderData.chapterSlug}） — イベントがありません。
      </p>
    </main>
  );
}
