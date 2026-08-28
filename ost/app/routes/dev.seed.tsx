import { createEvent, getEventBySlug } from "~/lib/db";
import { normalizeSlug } from "~/lib/slug";
import type { Route } from "./+types/dev.seed";

/**
 * Local-dev / e2e helper: upsert an event so participant + admin pages resolve
 * without going through the dashboard. Hard 404 in production.
 *
 *   /dev/seed?slug=e2e&title=E2E&chapter=1:dev-chapter
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (env.ENVIRONMENT === "production") throw new Response(null, { status: 404 });

  const url = new URL(request.url);
  const slug = normalizeSlug(url.searchParams.get("slug") ?? "e2e");
  if (!slug) return Response.json({ ok: false, error: "bad slug" }, { status: 400 });
  const title = url.searchParams.get("title") ?? "E2E Event";
  const [idRaw, slugRaw] = (url.searchParams.get("chapter") ?? "1:dev-chapter").split(":");
  const chapterId = Number.parseInt(idRaw ?? "1", 10) || 1;
  const chapterSlug = slugRaw || "dev-chapter";

  const existing = await getEventBySlug(env.DB, slug);
  if (existing) return Response.json({ ok: true, slug, existed: true });

  const result = await createEvent(env.DB, {
    slug,
    title,
    chapterId,
    chapterSlug,
    createdBy: null,
  });
  return Response.json({ ok: result.ok, slug });
}

export default function DevSeed() {
  return null;
}
