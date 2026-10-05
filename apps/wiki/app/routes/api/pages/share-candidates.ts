import { asc, eq, like, or } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { createAuth } from "~/features/auth/auth.server";
import { requireUser } from "~/features/auth/utils.server";
import {
  getEffectivePagePermissions,
  getPageAccessList,
  normalizeEmail,
} from "~/features/pages/access.server";
import { loadChapterDirectory } from "~/lib/chapter-directory.server";
import { getDb } from "~/lib/db.server";

/** GET /api/share-candidates?pageId=...&q=...&authorOnly=1 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId");
  const authorOnly = url.searchParams.get("authorOnly") === "1";
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const db = getDb(env);
  if (authorOnly && !pageId) return new Response("Missing pageId", { status: 400 });
  if (pageId) {
    const page = await db
      .select({
        id: schema.pages.id,
        authorId: schema.pages.authorId,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .get();
    if (!page) return new Response("Not Found", { status: 404 });

    if (authorOnly) {
      if (!user.isAdmin) return new Response("Forbidden", { status: 403 });
    } else {
      let chapters: Array<{ chapterId: string; role: string }> = [];
      try {
        const claims = await createAuth(env).getFreshClaims(request);
        chapters = claims.chapters.map((chapter) => ({
          chapterId: String(chapter.chapterId),
          role: chapter.role,
        }));
      } catch {
        // Chapter-derived sharing is fail-closed while direct email grants continue working.
      }
      const permissions = await getEffectivePagePermissions(db, page, user, chapters);
      if (!permissions.canManageSharing) return new Response("Forbidden", { status: 403 });
    }
  }

  const pattern = `%${query}%`;
  const [users, existing, chaptersResult] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
      })
      .from(schema.user)
      .where(
        query ? or(like(schema.user.name, pattern), like(schema.user.email, pattern)) : undefined,
      )
      .orderBy(asc(schema.user.name), asc(schema.user.email))
      .limit(12),
    pageId && !authorOnly ? getPageAccessList(db, pageId) : Promise.resolve([]),
    authorOnly
      ? Promise.resolve([])
      : loadChapterDirectory(env, query).catch((error) => {
          // Keep direct-email sharing usable when the accounts directory is
          // temporarily unavailable. Chapter suggestions simply fail closed.
          console.error("Unable to load Chapter sharing candidates", error);
          return [];
        }),
  ]);
  const assigned = new Set(existing.map((entry) => `${entry.subjectType}:${entry.subjectKey}`));
  const chapterCandidates = authorOnly
    ? []
    : chaptersResult
        .filter((chapter) => !assigned.has(`chapter:${chapter.id}`))
        .slice(0, 12)
        .map((chapter) => ({
          type: "chapter" as const,
          key: chapter.id,
          label: chapter.name,
          secondary: chapter.slug,
          subjectType: "chapter" as const,
          subjectKey: chapter.id,
          subjectLabel: chapter.name,
          secondaryText: chapter.slug,
          chapterKind: chapter.kind,
        }));
  const candidates = [
    ...users
      .filter(
        (candidate) => authorOnly || !assigned.has(`email:${normalizeEmail(candidate.email)}`),
      )
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        type: "email" as const,
        key: normalizeEmail(candidate.email),
        label: candidate.name,
        secondary: candidate.email,
        subjectType: "email" as const,
        subjectKey: normalizeEmail(candidate.email),
        subjectLabel: candidate.name,
        userId: candidate.id,
        image: candidate.image,
        secondaryText: candidate.email,
      })),
    ...chapterCandidates,
  ].slice(0, 20);

  return Response.json({ candidates });
}
