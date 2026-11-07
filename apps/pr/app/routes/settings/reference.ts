import { requireUserWithChapter } from "~/features/auth/access.server";
import { getReference } from "~/features/design/reference.repository.server";
import type { Route } from "./+types/reference";

/** GET /settings/references/:id — a chapter's reference design, for that chapter's members. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  const id = params.id ?? "";
  if (!/^ref-[\w-]{1,40}$/.test(id)) throw new Response(null, { status: 404 });
  const ref = await getReference(env.DB, id);
  if (!ref || !chapters.some((c) => c.chapterId === ref.chapterId))
    throw new Response(null, { status: 404 });
  const object = await env.IMAGES.get(ref.r2Key);
  if (!object) throw new Response(null, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": ref.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
