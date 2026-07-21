import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { indexPageEmbeddings } from "~/features/ai-search/embedding.server";
import { translatePageWithEnv } from "~/features/translation/translation.server";

type Db = ReturnType<typeof drizzle>;

export function isTranslationQueueBody(body: unknown): body is { pageId: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { pageId?: unknown }).pageId === "string"
  );
}

export async function processTranslationMessage(
  env: Env,
  db: Db,
  body: { pageId: string },
): Promise<void> {
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
    .set({ ...translated, translationStatusEn: "ai", updatedAt: new Date() })
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
  if (env.ENVIRONMENT !== "development") await env.TRANSLATION_QUEUE.send({ pageId });
  else context.waitUntil(processTranslationMessage(env, drizzle(env.DB, { schema }), { pageId }));
}
