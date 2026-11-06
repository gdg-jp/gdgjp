import { parseAclSpans, validateAclSpans } from "@gdgjp/gdg-lib/acl";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import { computeAclSourceIdsJson } from "~/features/pages/acl-spans";
import { ensureOpenReviewFlag } from "~/features/spaces/review.server";
import type { getDb } from "~/lib/db.server";
import { JOB_PRIORITY } from "./shared";

type Db = ReturnType<typeof getDb>;

/** Pages over this are not sent to the agent (one job = one whole page). */
export const MAX_TRANSLATE_BYTES = 150 * 1024;
export const DEFAULT_NIGHTLY_CAP = 200;

export async function translationSourceHash(titleJa: string, contentJa: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${titleJa}\n\u0000\n${contentJa}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type TranslatePayload = { pageId: string; sourceHash: string };

async function activeTranslatePageIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ payload: schema.agentJobs.payload })
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.type, "translate"),
        inArray(schema.agentJobs.status, ["queued", "leased"]),
      ),
    )
    .all();
  return new Set(
    rows.flatMap((row) => {
      try {
        return [(JSON.parse(row.payload) as TranslatePayload).pageId];
      } catch {
        return [];
      }
    }),
  );
}

/**
 * Nightly: one translate job per page whose Japanese changed since its last runner
 * translation, in spaces with translation on (default: all). Bounded by `cap`, oldest
 * update first; the rest wait for the next night. Human-written English is never touched.
 */
export async function enqueueNightlyTranslations(
  db: Db,
  options: { cap?: number; now?: Date } = {},
): Promise<{ queued: number; skipped: number }> {
  const cap = options.cap ?? DEFAULT_NIGHTLY_CAP;
  const spaces = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(and(eq(schema.spaces.translateEnabled, true), eq(schema.spaces.lang, "ja")))
    .all();
  if (spaces.length === 0) return { queued: 0, skipped: 0 };
  const pages = await db
    .select({
      id: schema.pages.id,
      spaceId: schema.pages.spaceId,
      titleJa: schema.pages.titleJa,
      contentJa: schema.pages.contentJa,
      sourceHash: schema.pages.translationSourceHash,
      updatedAt: schema.pages.updatedAt,
    })
    .from(schema.pages)
    .where(
      and(
        inArray(
          schema.pages.spaceId,
          spaces.map((space) => space.id),
        ),
        eq(schema.pages.status, "published"),
        ne(schema.pages.translationStatusEn, "human"),
        sql`length(trim(${schema.pages.contentJa})) > 0`,
      ),
    )
    .orderBy(schema.pages.updatedAt)
    .all();
  const active = await activeTranslatePageIds(db);
  const since = new Date((options.now ?? new Date()).getTime() - 72 * 3600 * 1000);
  let queued = 0;
  let skipped = 0;
  for (const page of pages) {
    if (queued >= cap) break;
    const hash = await translationSourceHash(page.titleJa, page.contentJa);
    if (hash === page.sourceHash || active.has(page.id)) continue;
    if (new TextEncoder().encode(page.contentJa).length > MAX_TRANSLATE_BYTES) {
      await ensureOpenReviewFlag(db, {
        spaceId: page.spaceId,
        targetType: "page",
        targetId: page.id,
        kind: "translate-stuck",
        payload: { reason: "too_large" },
      });
      skipped += 1;
      continue;
    }
    const recentFailures = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.agentJobs)
      .where(
        and(
          eq(schema.agentJobs.type, "translate"),
          eq(schema.agentJobs.status, "failed"),
          gt(schema.agentJobs.createdAt, since),
          sql`json_extract(${schema.agentJobs.payload}, '$.pageId') = ${page.id}`,
        ),
      )
      .get();
    if ((recentFailures?.n ?? 0) >= 3) {
      await ensureOpenReviewFlag(db, {
        spaceId: page.spaceId,
        targetType: "page",
        targetId: page.id,
        kind: "translate-stuck",
        payload: { reason: "failed_3_days" },
      });
    }
    await db.insert(schema.agentJobs).values({
      id: crypto.randomUUID(),
      type: "translate",
      spaceId: page.spaceId,
      priority: JOB_PRIORITY.translate,
      payload: JSON.stringify({ pageId: page.id, sourceHash: hash } satisfies TranslatePayload),
    });
    queued += 1;
  }
  return { queued, skipped };
}

/** "Update the English version now" on a page (editor role, checked by the caller). */
export async function enqueueTranslateNow(db: Db, pageId: string): Promise<boolean> {
  const page = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  if (!page || page.status !== "published" || page.translationStatusEn === "human") return false;
  if ((await activeTranslatePageIds(db)).has(pageId)) return true;
  await db.insert(schema.agentJobs).values({
    id: crypto.randomUUID(),
    type: "translate",
    spaceId: page.spaceId,
    priority: JOB_PRIORITY.manual,
    payload: JSON.stringify({
      pageId,
      sourceHash: await translationSourceHash(page.titleJa, page.contentJa),
    } satisfies TranslatePayload),
  });
  return true;
}

/** Spans must survive translation one-for-one: same count, same `src` in the same order. */
export function spansMatch(contentJa: string, contentEn: string): boolean {
  const ja = parseAclSpans(contentJa).map((span) => [...span.srcIds].sort().join(","));
  const en = parseAclSpans(contentEn).map((span) => [...span.srcIds].sort().join(","));
  return ja.length === en.length && ja.every((value, index) => value === en[index]);
}

export type ApplyTranslationResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: "not_found" | "stale_source" | "acl_required" | "acl_malformed" | "human_translation";
    };

/**
 * Accept the runner's English for a page: only if the Japanese is still the one it
 * translated (else 409, retried next night) and the `<acl>` spans match — a translation
 * that drops or merges a span would show restricted text unredacted in English.
 * Writes content_en / title_en only; content_ja and metadata are untouched.
 */
export async function applyTranslation(
  db: Db,
  input: { pageId: string; sourceHash: string; titleEn: string; contentEn: string },
): Promise<ApplyTranslationResult> {
  const page = await db.select().from(schema.pages).where(eq(schema.pages.id, input.pageId)).get();
  if (!page || page.status !== "published") return { ok: false, status: 404, error: "not_found" };
  if (page.translationStatusEn === "human") {
    return { ok: false, status: 409, error: "human_translation" };
  }
  const current = await translationSourceHash(page.titleJa, page.contentJa);
  if (current !== input.sourceHash) return { ok: false, status: 409, error: "stale_source" };
  if (!validateAclSpans(input.contentEn).ok)
    return { ok: false, status: 400, error: "acl_malformed" };
  if (!spansMatch(page.contentJa, input.contentEn)) {
    return { ok: false, status: 400, error: "acl_required" };
  }
  await db
    .update(schema.pages)
    .set({
      titleEn: input.titleEn.slice(0, 500),
      contentEn: input.contentEn,
      translationStatusEn: "ai",
      translationSourceHash: current,
      aclSourceIds: computeAclSourceIdsJson(page.contentJa, input.contentEn),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.pages.id, page.id), eq(schema.pages.contentJa, page.contentJa)));
  return { ok: true };
}
