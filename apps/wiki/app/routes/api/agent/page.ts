import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { resolveAgentReader } from "~/features/agent-api/agent-reader.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { redactPageMarkdown } from "~/features/pages/acl-spans.server";
import { pageInSpace } from "~/features/pages/page-space.server";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { requireSpaceForIdentity } from "~/features/spaces/access.server";
import { getDb } from "~/lib/db.server";

/**
 * GET /api/agent/page?space=…&slug=… — one page for an agent reader, redacted for that
 * reader. This is the ONLY source of page bodies in answer bundles and MCP reads (Stage 05).
 * Missing, forbidden and other-space pages are all 404.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env);
  const reader = await resolveAgentReader(request, env, db, { allowJobToken: true });
  if (!reader) return Response.json({ error: "invalid_token" }, { status: 401 });
  const url = new URL(request.url);
  const spaceSlug = url.searchParams.get("space") ?? "";
  const slug = url.searchParams.get("slug") ?? "";
  if (!spaceSlug || !slug)
    return Response.json({ error: "space_and_slug_required" }, { status: 400 });
  const notFound = Response.json({ error: "not_found" }, { status: 404 });
  let space: Awaited<ReturnType<typeof requireSpaceForIdentity>>["space"];
  try {
    ({ space } = await requireSpaceForIdentity(
      db,
      reader.identity,
      spaceSlug,
      "viewer",
      reader.extraPrincipals,
    ));
  } catch {
    return notFound;
  }
  const page = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      status: schema.pages.status,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      contentJa: schema.pages.contentJa,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
    })
    .from(schema.pages)
    .where(pageInSpace(space.id, slug))
    .get();
  if (!page || page.status !== "published") return notFound;
  const { user, chapters } = reader.identity;
  const permissions = await getEffectivePagePermissions(db, page, user, chapters);
  if (!permissions.canView) return notFound;
  const content = await redactPageMarkdown(db, canonicalMarkdown(page.contentJa), user, chapters);
  const path = wikiPagePath(await getWikiCanonicalSlugPath(env, page.id), space.slug);
  return Response.json({
    space: space.slug,
    slug: page.slug,
    title: page.titleJa || page.titleEn,
    url: new URL(path, env.APP_URL).toString(),
    content,
  });
}
