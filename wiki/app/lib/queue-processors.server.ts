import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { indexPageEmbeddings } from "~/features/ai-search/embedding.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import {
  FORMAT_VERSION,
  type TranslationSegmentStore,
  translatePage,
  translationSourceHash,
} from "~/features/translation/translation.server";

const TRANSLATION_LEASE_SECONDS = 15 * 60;
const TRANSLATION_DISPATCH_LIMIT = 200;
const TRANSLATION_MAX_ATTEMPTS = 5;
const TRANSLATION_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

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

export class TranslationBudgetExceededError extends Error {
  constructor(message = "Translation AI Gateway daily spend limit reached.") {
    super(message);
    this.name = "TranslationBudgetExceededError";
  }
}

function isBudgetLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:429|spend limit|budget|quota)/i.test(message);
}

function nextUtcAllowance(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5) / 1000,
  );
}

function createSegmentStore(env: Env, modelId: string): TranslationSegmentStore {
  return {
    async getMany(cacheKeys) {
      const cached = new Map<string, string>();
      for (let offset = 0; offset < cacheKeys.length; offset += 90) {
        const chunk = cacheKeys.slice(offset, offset + 90);
        if (chunk.length === 0) continue;
        const rows = await env.DB.prepare(
          `SELECT cache_key AS cacheKey, translated_text AS translatedText
           FROM translation_segments WHERE cache_key IN (${chunk.map(() => "?").join(",")})`,
        )
          .bind(...chunk)
          .all<{ cacheKey: string; translatedText: string }>();
        for (const row of rows.results) cached.set(row.cacheKey, row.translatedText);
      }
      return cached;
    },
    async put(cacheKey, translatedText) {
      await env.DB.prepare(
        `INSERT INTO translation_segments
          (cache_key, translated_text, model_id, format_version, created_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(cache_key) DO UPDATE SET
           translated_text = excluded.translated_text`,
      )
        .bind(cacheKey, translatedText, modelId, FORMAT_VERSION)
        .run();
    },
  };
}

function createWorkersAiTranslator(env: Env, modelId: string) {
  return async (text: string, cacheKey: string): Promise<string> => {
    try {
      const response = await env.AI.run(
        modelId as "@cf/meta/m2m100-1.2b",
        { text, source_lang: "ja", target_lang: "en" },
        {
          gateway: {
            id: env.TRANSLATION_AI_GATEWAY_ID,
            cacheKey: `wiki-translation:${cacheKey}`,
            cacheTtl: TRANSLATION_CACHE_TTL_SECONDS,
            // Restricted Wiki prose must not be retained in persistent Gateway request logs.
            collectLog: false,
          },
        },
      );
      if (!("translated_text" in response) || !response.translated_text?.trim()) {
        throw new Error("Workers AI returned an empty translation.");
      }
      return response.translated_text;
    } catch (error) {
      if (isBudgetLimitError(error)) throw new TranslationBudgetExceededError();
      throw error;
    }
  };
}

async function releaseTranslationJob(
  env: Env,
  pageId: string,
  options: { error: string; deferUntil?: number; terminal?: boolean },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE translation_jobs SET
       status = ?, lease_until = NULL, next_attempt_at = ?, last_error = ?
     WHERE page_id = ? AND status = 'processing'`,
  )
    .bind(
      options.terminal ? "failed" : "pending",
      options.deferUntil ?? null,
      options.error,
      pageId,
    )
    .run();
}

export async function processTranslationMessage(env: Env, body: { pageId: string }): Promise<void> {
  if (!isAutoTranslateEnabled(env)) {
    console.log("[translation] skipped (AUTO_TRANSLATE != true)", body.pageId);
    // A message can already be in Queue when the kill switch changes. Preserve it as pending
    // instead of acknowledging it in the forever-undispatchable `queued` state.
    await env.DB.prepare(
      "UPDATE translation_jobs SET status = 'pending' WHERE page_id = ? AND status = 'queued'",
    )
      .bind(body.pageId)
      .run();
    return;
  }

  const claim = await env.DB.prepare(
    `UPDATE translation_jobs SET
       status = 'processing', started_at = unixepoch(),
       lease_until = unixepoch() + ?, attempts = attempts + 1, last_error = NULL
     WHERE page_id = ? AND (
       status = 'queued' OR (status = 'processing' AND lease_until <= unixepoch())
     )
     RETURNING attempts`,
  )
    .bind(TRANSLATION_LEASE_SECONDS, body.pageId)
    .first<{ attempts: number }>();
  if (!claim) return;

  try {
    const page = await env.DB.prepare(
      `SELECT title_ja AS titleJa, summary_ja AS summaryJa, content_ja AS contentJa,
              translation_status_en AS translationStatusEn
       FROM pages WHERE id = ?`,
    )
      .bind(body.pageId)
      .first<{
        titleJa: string;
        summaryJa: string;
        contentJa: string;
        translationStatusEn: string;
      }>();
    if (!page || page.translationStatusEn === "human") {
      await env.DB.prepare(
        `UPDATE translation_jobs SET status = 'completed', completed_at = unixepoch(),
           lease_until = NULL, next_attempt_at = NULL
         WHERE page_id = ? AND status = 'processing'`,
      )
        .bind(body.pageId)
        .run();
      return;
    }

    const input = { ...page, contentJa: canonicalMarkdown(page.contentJa) };
    const sourceHash = await translationSourceHash(input);
    await env.DB.prepare(
      "UPDATE translation_jobs SET source_hash = ? WHERE page_id = ? AND status = 'processing'",
    )
      .bind(sourceHash, body.pageId)
      .run();

    const modelId = env.TRANSLATION_MODEL_ID.trim() || "@cf/meta/m2m100-1.2b";
    const translated = await translatePage(input, {
      modelId,
      translator: createWorkersAiTranslator(env, modelId),
      store: createSegmentStore(env, modelId),
    });

    const update = await env.DB.prepare(
      `UPDATE pages SET
         title_en = ?, summary_en = ?, content_en = ?, translation_status_en = 'ai',
         updated_at = unixepoch()
       WHERE id = ? AND title_ja = ? AND summary_ja = ? AND content_ja = ?
         AND translation_status_en <> 'human'`,
    )
      .bind(
        translated.titleEn,
        translated.summaryEn,
        canonicalMarkdown(translated.contentEn),
        body.pageId,
        page.titleJa,
        page.summaryJa,
        page.contentJa,
      )
      .run();

    if (update.meta.changes === 0) {
      await env.DB.prepare(
        `UPDATE translation_jobs SET status = 'pending', source_hash = NULL,
           requested_at = unixepoch(), lease_until = NULL, next_attempt_at = NULL
         WHERE page_id = ? AND status = 'processing' AND source_hash = ?`,
      )
        .bind(body.pageId, sourceHash)
        .run();
      return;
    }

    await env.DB.prepare(
      `UPDATE translation_jobs SET
         status = 'completed', completed_at = unixepoch(), lease_until = NULL,
         next_attempt_at = NULL, cache_hits = ?, cache_misses = ?, last_error = NULL
       WHERE page_id = ? AND status = 'processing' AND source_hash = ?`,
    )
      .bind(translated.stats.cacheHits, translated.stats.cacheMisses, body.pageId, sourceHash)
      .run();

    try {
      await indexPageEmbeddings(env, drizzle(env.DB, { schema }), body.pageId);
    } catch (error) {
      console.error("embedding-pipeline: failed after translation", body.pageId, error);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TranslationBudgetExceededError) {
      await releaseTranslationJob(env, body.pageId, {
        error: message,
        deferUntil: nextUtcAllowance(),
      });
      return;
    }
    await releaseTranslationJob(env, body.pageId, {
      error: message.slice(0, 2_000),
      terminal: claim.attempts >= TRANSLATION_MAX_ATTEMPTS,
    });
    throw error;
  }
}

/** Dispatches one coalesced job per page; unprocessed work remains durable in D1. */
export async function enqueuePendingTranslations(env: Env): Promise<number> {
  if (!isAutoTranslateEnabled(env)) return 0;
  const rows = await env.DB.prepare(
    `SELECT page_id AS pageId FROM translation_jobs
     WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= unixepoch()))
        OR (status = 'processing' AND lease_until <= unixepoch())
     ORDER BY requested_at ASC LIMIT ?`,
  )
    .bind(TRANSLATION_DISPATCH_LIMIT)
    .all<{ pageId: string }>();
  let dispatched = 0;
  for (const { pageId } of rows.results) {
    const queued = await env.DB.prepare(
      `UPDATE translation_jobs SET status = 'queued', lease_until = NULL
       WHERE page_id = ? AND (
         (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= unixepoch()))
         OR (status = 'processing' AND lease_until <= unixepoch())
       )`,
    )
      .bind(pageId)
      .run();
    if (queued.meta.changes === 0) continue;
    try {
      await env.TRANSLATION_QUEUE.send({ pageId });
      dispatched += 1;
    } catch (error) {
      await env.DB.prepare(
        "UPDATE translation_jobs SET status = 'pending' WHERE page_id = ? AND status = 'queued'",
      )
        .bind(pageId)
        .run();
      throw error;
    }
  }
  return dispatched;
}
