import { inArray } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import {
  pageAclClearance,
  validatePageAclForSync,
  validateReadSourcesTagged,
} from "~/lib/acl-spans.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { canonicalMarkdown } from "~/lib/content-format";
import { mapInChunks } from "~/lib/d1-chunk.server";
import { getDb } from "~/lib/db.server";

const Access = z.object({
  subjectType: z.enum(["email", "chapter"]),
  subjectKey: z.string().min(1),
});
const Source = z.object({
  sourceId: z.string().min(1).optional(),
});
const PagePayload = z.object({
  id: z.string().min(1).max(128).nullable().optional(),
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string(),
  summary: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  visibility: z.enum(["restricted", "unlisted", "public", "organizer", "member"]),
  access: z.array(Access).default([]),
  sources: z.array(Source).default([]),
});
const Body = z.object({
  lang: z.enum(["ja", "en"]).default("ja"),
  pages: z.array(PagePayload).default([]),
  readSourceIds: z.array(z.string().min(1)).default([]),
});

type Finding = { slug: string; error: string; sourceId?: string };

/**
 * POST /api/cli/wiki/validate-acl
 * Dry-run ACL checks used by `gdg wiki verify-acl` and Cursor ingest hooks.
 * Never writes to D1.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { lang, pages, readSourceIds } = parsed.data;
  const db = getDb(env);
  const findings: Finding[] = [];

  const pageIds = pages
    .map((page) => page.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const storedById = new Map<string, { contentJa: string | null; contentEn: string | null }>();
  const rows = await mapInChunks(pageIds, (chunk) =>
    db
      .select({
        id: schema.pages.id,
        contentJa: schema.pages.contentJa,
        contentEn: schema.pages.contentEn,
      })
      .from(schema.pages)
      .where(inArray(schema.pages.id, chunk))
      .all(),
  );
  for (const row of rows) {
    storedById.set(row.id, {
      contentJa: row.contentJa,
      contentEn: row.contentEn,
    });
  }

  for (const page of pages) {
    const content = canonicalMarkdown(page.content);
    const stored = page.id ? storedById.get(page.id) : undefined;
    if (stored) {
      const canEditSpans = await pageAclClearance(
        db,
        [stored.contentJa, stored.contentEn],
        identity.user,
        identity.chapters,
      );
      if (!canEditSpans) {
        findings.push({
          slug: page.slug,
          error: "redacted_page_not_editable",
        });
        continue;
      }
    }

    const locale = {
      title: page.title,
      summary: page.summary,
      content,
      tags: page.tags,
    };
    const aclValidation = await validatePageAclForSync(
      db,
      lang === "en" ? { en: locale } : { ja: locale },
      {
        pageVisibility: page.visibility,
        pageAccess: page.access,
        citedSourceIds: page.sources
          .map((source) => source.sourceId)
          .filter(
            (sourceId): sourceId is string => typeof sourceId === "string" && sourceId.length > 0,
          ),
        storedContentJa: stored?.contentJa,
        storedContentEn: stored?.contentEn,
        contentJa: lang === "ja" ? content : undefined,
        contentEn: lang === "en" ? content : undefined,
      },
      identity.user,
      identity.chapters,
    );
    if (!aclValidation.ok) {
      findings.push({
        slug: page.slug,
        error: aclValidation.error,
        ...(aclValidation.sourceId ? { sourceId: aclValidation.sourceId } : {}),
      });
    }
  }

  const runValidation = await validateReadSourcesTagged(
    db,
    pages.map((page) => ({
      slug: page.slug,
      visibility: page.visibility,
      access: page.access,
      content: canonicalMarkdown(page.content),
    })),
    readSourceIds,
    identity.user,
    identity.chapters,
  );
  if (!runValidation.ok) {
    findings.push({
      slug: pages[0]?.slug ?? "",
      error: runValidation.error,
      ...(runValidation.sourceId ? { sourceId: runValidation.sourceId } : {}),
    });
  }

  if (findings.length > 0) {
    return Response.json({ ok: false, findings });
  }
  return Response.json({ ok: true });
}
