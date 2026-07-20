import { asc, eq, like, or } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { createAuth } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import {
  getEffectivePagePermissions,
  getPageAccessList,
  normalizeEmail,
} from "~/lib/page-access.server";

type AccountChapter = { id: string; slug: string; name: string; kind: "gdg" | "gdgoc" };

async function loadChapterCandidates(env: Env, query: string): Promise<AccountChapter[]> {
  const url = new URL("/api/chapters/directory", env.ACCOUNTS_URL);
  if (query) url.searchParams.set("q", query);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`accounts chapter directory returned ${response.status}`);
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { chapters?: unknown }).chapters)
  ) {
    throw new Error("accounts chapter directory returned an invalid payload");
  }
  return (payload as { chapters: unknown[] }).chapters.flatMap((chapter) => {
    if (!chapter || typeof chapter !== "object") return [];
    const value = chapter as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      typeof value.slug !== "string" ||
      typeof value.name !== "string" ||
      (value.kind !== "gdg" && value.kind !== "gdgoc")
    ) {
      return [];
    }
    return [{ id: value.id, slug: value.slug, name: value.name, kind: value.kind }];
  });
}

/** GET /api/share-candidates?pageId=...&q=... */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId");
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const db = getDb(env);
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

    let chapterIds: number[] = [];
    try {
      const claims = await createAuth(env).getFreshClaims(request);
      chapterIds = claims.chapters.map((chapter) => chapter.chapterId);
    } catch {
      // Chapter-derived sharing is fail-closed while direct email grants continue working.
    }
    const permissions = await getEffectivePagePermissions(db, page, user, chapterIds);
    if (!permissions.canManageSharing) return new Response("Forbidden", { status: 403 });
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
    pageId ? getPageAccessList(db, pageId) : Promise.resolve([]),
    loadChapterCandidates(env, query).catch((error) => {
      // Keep direct-email sharing usable when the accounts directory is
      // temporarily unavailable. Chapter suggestions simply fail closed.
      console.error("Unable to load Chapter sharing candidates", error);
      return [];
    }),
  ]);
  const assigned = new Set(existing.map((entry) => `${entry.subjectType}:${entry.subjectKey}`));
  const candidates = [
    ...users
      .filter((candidate) => !assigned.has(`email:${normalizeEmail(candidate.email)}`))
      .map((candidate) => ({
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
    ...chaptersResult
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
      })),
  ].slice(0, 20);

  return Response.json({ candidates });
}
