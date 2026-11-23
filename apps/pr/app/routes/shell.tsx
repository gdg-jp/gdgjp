import { Outlet } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import type { Route } from "./+types/shell";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, request);
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: chapters.map((c) => ({ id: c.chapterId, slug: c.chapterSlug })),
    chapterId: chapter.chapterId,
  };
}

export default function Shell() {
  return <Outlet />;
}
