import { Outlet } from "react-router";
import { AppShell } from "~/components/AppShell";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { listEventsForChapters } from "~/features/events/events.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/admin";

/** Shared authenticated chrome. Child routes continue to own event authorization. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const events = await listEventsForChapters(
    getDb(env),
    chapters.map((chapter) => chapter.chapterId),
  );

  return {
    user: { name: user.name, email: user.email, image: user.image ?? null },
    chapters: chapters.map((chapter) => ({
      id: chapter.chapterId,
      slug: chapter.chapterSlug,
    })),
    events: events.map((event) => ({
      id: event.id,
      chapterId: event.chapterId,
      name: event.name,
      date: event.date,
      status: event.status,
    })),
    accountsUrl: env.ACCOUNTS_URL,
  };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell {...loaderData}>
      <Outlet />
    </AppShell>
  );
}
