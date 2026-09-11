import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/features/auth/utils.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env: Env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const pageId = new URL(request.url).searchParams.get("pageId");
  if (!pageId) return Response.json({ error: "missing_page" }, { status: 400 });
  const page = await env.DB.prepare(
    "SELECT author_id, origin, page_type, status FROM pages WHERE id = ?",
  )
    .bind(pageId)
    .first<{ author_id: string; origin: string; page_type: string | null; status: string }>();
  if (!page || page.status !== "published")
    return Response.json({ error: "not_found" }, { status: 404 });
  if (
    (!user.isAdmin && page.author_id !== user.id) ||
    page.page_type === "wiki-index" ||
    page.page_type === "wiki-log"
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await env.DB.prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM pages WHERE id = ?
    UNION SELECT p.id FROM pages p JOIN descendants d ON p.parent_id = d.id
  ) SELECT id, title_ja AS titleJa, title_en AS titleEn, slug FROM pages
    WHERE status = 'published' AND id NOT IN (SELECT id FROM descendants)
    AND (page_type IS NULL OR page_type NOT IN ('wiki-index', 'wiki-log'))
    AND (? = 1 OR author_id = ?) AND (? != 'agent' OR origin != 'human')
    ORDER BY title_ja, id`)
    .bind(pageId, user.isAdmin ? 1 : 0, user.id, page.origin)
    .all<{ id: string; titleJa: string; titleEn: string; slug: string }>();
  return Response.json({ targets: result.results });
}
