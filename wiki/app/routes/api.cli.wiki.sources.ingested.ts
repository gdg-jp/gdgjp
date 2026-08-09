import { eq } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { parseWikiHumanDocumentId } from "~/lib/cli-wiki-human.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { canAccessSource } from "~/lib/sources.server";
import type { components } from "../../openapi/types.generated";

type IngestedResult = components["schemas"]["IngestedResult"];

const Body = z.object({
  documents: z
    .array(
      z.object({
        documentId: z.string().min(1),
        contentHash: z.string().min(1),
      }),
    )
    .min(1),
});

/** POST /api/cli/wiki/sources/ingested — record ingested document hashes. */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );

  const db = getDb(env);
  const chapterIds = identity.chapters.map((chapter) => String(chapter.chapterId));
  for (const document of parsed.data.documents) {
    const pageId = parseWikiHumanDocumentId(document.documentId);
    if (pageId) {
      const page = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).get();
      if (!page || page.origin !== "human" || page.status !== "published") {
        return Response.json({ error: "not_found", id: document.documentId }, { status: 404 });
      }
      const permission = await getEffectivePagePermissions(
        db,
        page,
        identity.user,
        identity.chapters,
      );
      if (!permission.canView) {
        return Response.json({ error: "forbidden", id: document.documentId }, { status: 403 });
      }
      continue;
    }

    const sourceDocument = await db
      .select({
        contentHash: schema.sourceDocuments.contentHash,
        sourceId: schema.sourceDocuments.sourceId,
      })
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.id, document.documentId))
      .get();
    if (!sourceDocument) {
      return Response.json({ error: "not_found", id: document.documentId }, { status: 404 });
    }
    if (sourceDocument.contentHash !== document.contentHash) {
      return Response.json({ error: "stale_content", id: document.documentId }, { status: 409 });
    }
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceDocument.sourceId))
      .get();
    if (!source || source.status !== "ready") {
      return Response.json({ error: "not_found", id: document.documentId }, { status: 404 });
    }
    if (!canAccessSource(source, identity.user, chapterIds)) {
      return Response.json({ error: "forbidden", id: document.documentId }, { status: 403 });
    }
  }

  const statements = parsed.data.documents.map((doc) =>
    env.DB.prepare(
      `INSERT INTO source_document_ingestions (document_id, content_hash, ingested_by, ingested_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(document_id) DO UPDATE SET
         content_hash = excluded.content_hash,
         ingested_by = excluded.ingested_by,
         ingested_at = excluded.ingested_at`,
    ).bind(doc.documentId, doc.contentHash, identity.user.id),
  );

  await env.DB.batch(statements);

  const result: IngestedResult = { ok: true };
  return Response.json(result);
}
