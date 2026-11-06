import { and, eq, inArray } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRunner } from "~/features/jobs/runner-routes.server";
import type { SynthesizePayload } from "~/features/jobs/shared";
import { getDb } from "~/lib/db.server";

/**
 * GET /api/runner/jobs/:id/context — what the runner needs to write JOB.md: the space, the
 * job's sources (id, kind, visibility, title) and documents (id, path, size), and requests.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const db = getDb(env);
  const job = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, params.id ?? ""))
    .get();
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });
  const space = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.id, job.spaceId))
    .get();
  const payload = JSON.parse(job.payload) as SynthesizePayload;
  const sourceIds = payload.sourceIds ?? [];
  const sources =
    sourceIds.length === 0
      ? []
      : await db
          .select({
            id: schema.sources.id,
            kind: schema.sources.kind,
            title: schema.sources.title,
            visibility: schema.sources.visibility,
            chapterId: schema.sources.chapterId,
            url: schema.sources.url,
          })
          .from(schema.sources)
          .where(
            and(inArray(schema.sources.id, sourceIds), eq(schema.sources.spaceId, job.spaceId)),
          )
          .all();
  const documentIds = payload.documentIds ?? [];
  const documents: Array<Record<string, unknown>> = [];
  for (let i = 0; i < documentIds.length; i += 50) {
    documents.push(
      ...(await db
        .select({
          id: schema.sourceDocuments.id,
          sourceId: schema.sourceDocuments.sourceId,
          path: schema.sourceDocuments.path,
          title: schema.sourceDocuments.title,
          mediaType: schema.sourceDocuments.mediaType,
          contentHash: schema.sourceDocuments.contentHash,
          integratedHash: schema.sourceDocuments.integratedHash,
          r2Key: schema.sourceDocuments.r2Key,
        })
        .from(schema.sourceDocuments)
        .where(inArray(schema.sourceDocuments.id, documentIds.slice(i, i + 50)))
        .all()),
    );
  }
  const sized = await Promise.all(
    documents.map(async ({ r2Key, ...doc }) => ({
      ...doc,
      bytes: (await env.BUCKET.head(String(r2Key)))?.size ?? null,
      isNew: !doc.integratedHash,
    })),
  );
  return Response.json({
    job: { id: job.id, type: job.type, attempts: job.attempts },
    space: space ? { id: space.id, slug: space.slug, name: space.name, lang: space.lang } : null,
    sources,
    documents: sized,
    requests: payload.requests ?? [],
  });
}
