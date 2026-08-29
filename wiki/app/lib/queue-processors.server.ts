import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { indexPageEmbeddings } from "~/features/ai-search/embedding.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { translatePageWithEnv } from "~/features/translation/translation.server";

type Db = ReturnType<typeof drizzle>;

/** Wrangler vars are strings; only the literal `"true"` enables auto-translation. */
export function isAutoTranslateEnabled(env: { AUTO_TRANSLATE: string }): boolean {
  return String(env.AUTO_TRANSLATE) === "true";
}

export function isTranslationQueueBody(body: unknown): body is { pageId: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { pageId?: unknown }).pageId === "string"
  );
}

export function isGoogleDocumentImportQueueBody(
  body: unknown,
): body is { type: "google_document_import"; jobId: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: unknown }).type === "google_document_import" &&
    typeof (body as { jobId?: unknown }).jobId === "string"
  );
}

export function isSourceFetchQueueBody(
  body: unknown,
): body is { type: "source_fetch"; sourceId: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: unknown }).type === "source_fetch" &&
    typeof (body as { sourceId?: unknown }).sourceId === "string"
  );
}

export async function processTranslationMessage(
  env: Env,
  db: Db,
  body: { pageId: string },
): Promise<void> {
  if (!isAutoTranslateEnabled(env)) {
    console.log("[translation] skipped (AUTO_TRANSLATE != true)", body.pageId);
    return;
  }
  const page = await db
    .select({
      contentJa: schema.pages.contentJa,
      titleJa: schema.pages.titleJa,
      summaryJa: schema.pages.summaryJa,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, body.pageId))
    .get();
  if (!page) return;
  const translated = await translatePageWithEnv(env, page);
  await db
    .update(schema.pages)
    .set({
      ...translated,
      // Defend the storage contract if a model ignores the Markdown-only prompt.
      contentEn: canonicalMarkdown(translated.contentEn),
      translationStatusEn: "ai",
      updatedAt: new Date(),
    })
    .where(eq(schema.pages.id, body.pageId));
  try {
    await indexPageEmbeddings(env, db, body.pageId);
  } catch (error) {
    console.error("embedding-pipeline: failed after translation", body.pageId, error);
  }
}

export async function sendOrRunTranslation(
  env: Env,
  context: ExecutionContext,
  pageId: string,
): Promise<void> {
  if (!isAutoTranslateEnabled(env)) {
    console.log("[translation] enqueue skipped (AUTO_TRANSLATE != true)", pageId);
    return;
  }
  // Wrangler's production vars generate `ENVIRONMENT` as a literal type, but
  // local development overrides it through `.dev.vars` at runtime.
  const environment: string = env.ENVIRONMENT;
  if (environment !== "development") await env.TRANSLATION_QUEUE.send({ pageId });
  else context.waitUntil(processTranslationMessage(env, drizzle(env.DB, { schema }), { pageId }));
}
