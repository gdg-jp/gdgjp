import { createEvent, getEventBySlug } from "~/features/events/events.server";
import { normalizeSlug } from "~/features/events/slug";
import type { Route } from "./+types/dev.seed";

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
