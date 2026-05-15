import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { generateSlug } from "~/lib/ingestion-pipeline.server";
import { sendOrRunTranslation } from "~/lib/queue-processors.server";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CommitOperationSchema = z.object({
  type: z.enum(["create", "update"]),
  tempId: z.string().optional(),
  pageId: z.string().optional(),
  title: z.string().min(1),
  tiptapJson: z.string(),
  summaryJa: z.string(),
  pageType: z.string(),
  pageMetadata: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).max(5).default([]),
  suggestedParentId: z.string().nullable().optional(),
  suggestedSlug: z.string().optional(),
  actionabilityScore: z.number(),
});

const CommitBodySchema = z.object({
  publishStatus: z.enum(["draft", "published"]),
  operations: z.array(CommitOperationSchema).min(1),
  sources: z.array(z.object({ url: z.string(), title: z.string() })).default([]),
});

type CommitBody = z.infer<typeof CommitBodySchema>;

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");
  const db = drizzle(env.DB, { schema });

  // Verify session ownership
  const session = await db
    .select({
      userId: schema.ingestionSessions.userId,
      inputsJson: schema.ingestionSessions.inputsJson,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) throw new Response("Not found", { status: 404 });
  if (session.userId !== user.id) throw new Response("Forbidden", { status: 403 });

  const parseResult = CommitBodySchema.safeParse(await request.json());
  if (!parseResult.success) {
    return new Response(parseResult.error.message, { status: 400 });
  }
  const body: CommitBody = parseResult.data;

  // Members can only save as draft
  const userRole = user.role as string;
  const canPublish = userRole === "lead" || userRole === "admin";
  const publishStatus = canPublish ? body.publishStatus : "draft";

  const pageIds: string[] = [];
  const translationPageIds: string[] = [];

  // Pre-validate tag slugs against the canonical tags table to avoid FK constraint failures.
  // AI-suggested tags that don't exist in the taxonomy are silently dropped.
  const allTagSlugs = [...new Set(body.operations.flatMap((op) => op.tags ?? []))];
  let validTagSlugs = new Set<string>();
  if (allTagSlugs.length > 0) {
    const rows = await db
      .select({ slug: schema.tags.slug })
      .from(schema.tags)
      .where(inArray(schema.tags.slug, allTagSlugs))
      .all();
    validTagSlugs = new Set(rows.map((r) => r.slug));
  }

  // Pre-allocate real page IDs for all create ops so tempId → realId resolution works
  // for parent-child relationships within the same plan.
  const tempIdMap: Record<string, string> = {};
  for (const op of body.operations) {
    if (op.type === "create") {
      if (!op.tempId) {
        return new Response("All create operations must include a tempId", { status: 400 });
      }
      tempIdMap[op.tempId] = nanoid();
    }
  }

  // Execute atomically using D1 batch
  const statements = [];

  for (const op of body.operations) {
    if (op.type === "create") {
      // tempId is validated above for all create ops
      const pageId = tempIdMap[op.tempId as string];
      pageIds.push(pageId);

      // Generate a unique slug by checking for collisions
      let slug = op.suggestedSlug
        ? generateSlug(op.suggestedSlug)
        : generateSlug(op.title) || nanoid(8);
      const collision = await db
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(eq(schema.pages.slug, slug))
        .get();
      if (collision) slug = `${slug}-${nanoid(6)}`;

      const metadata = JSON.stringify(op.pageMetadata ?? {});

      // Resolve suggestedParentId: tempId → real page ID, or pass through as existing page ID
      const parentId =
        op.suggestedParentId != null
          ? (tempIdMap[op.suggestedParentId] ?? op.suggestedParentId)
          : null;

      statements.push(
        env.DB.prepare(
          `INSERT INTO pages (id, title_ja, slug, content_ja, summary_ja, page_type, page_metadata,
            parent_id, ingestion_session_id, actionability_score, author_id, last_edited_by,
            status, chapter_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
        ).bind(
          pageId,
          op.title,
          slug,
          op.tiptapJson,
          op.summaryJa,
          op.pageType,
          metadata,
          parentId,
          params.sessionId,
          op.actionabilityScore,
          user.id,
          user.id,
          publishStatus,
          user.chapterId ?? null,
        ),
      );

      // Insert tags (only slugs that exist in the canonical tags table)
      for (const tagSlug of (op.tags ?? []).filter((s) => validTagSlugs.has(s))) {
        statements.push(
          env.DB.prepare("INSERT OR IGNORE INTO page_tags (page_id, tag_slug) VALUES (?, ?)").bind(
            pageId,
            tagSlug,
          ),
        );
      }

      // Auto-insert author as owner in page_access
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO page_access (id, page_id, email, user_id, page_role, granted_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'owner', ?, unixepoch(), unixepoch())`,
        ).bind(nanoid(), pageId, user.email, user.id, user.id),
      );

      translationPageIds.push(pageId);
    } else if (op.type === "update" && op.pageId) {
      pageIds.push(op.pageId);

      // Fetch existing content for version snapshot
      const existing = await db
        .select({
          contentJa: schema.pages.contentJa,
          contentEn: schema.pages.contentEn,
          titleJa: schema.pages.titleJa,
          titleEn: schema.pages.titleEn,
        })
        .from(schema.pages)
        .where(eq(schema.pages.id, op.pageId))
        .get();

      if (existing) {
        const versionId = nanoid();
        // Save version snapshot
        statements.push(
          env.DB.prepare(
            `INSERT INTO page_versions (id, page_id, content_ja, content_en, title_ja, title_en, edited_by, saved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
          ).bind(
            versionId,
            op.pageId,
            existing.contentJa,
            existing.contentEn,
            existing.titleJa,
            existing.titleEn,
            user.id,
          ),
        );
      }

      // Apply patch
      statements.push(
        env.DB.prepare(
          `UPDATE pages SET content_ja = ?, title_ja = ?, summary_ja = ?, status = ?,
            ingestion_session_id = ?, last_edited_by = ?, updated_at = unixepoch()
           WHERE id = ?`,
        ).bind(
          op.tiptapJson,
          op.title,
          op.summaryJa,
          publishStatus,
          params.sessionId,
          user.id,
          op.pageId,
        ),
      );

      translationPageIds.push(op.pageId);
    }
  }

  // Insert page sources for all affected pages
  if (body.sources.length > 0) {
    for (const pageId of pageIds) {
      for (const src of body.sources) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO page_sources (id, page_id, url, title, created_at) VALUES (?, ?, ?, ?, unixepoch())",
          ).bind(nanoid(), pageId, src.url, src.title),
        );
      }
    }
  }

  // Build r2key → mimeType map from session inputs for accurate MIME types
  const r2KeyMimeMap: Record<string, string> = {};
  let sessionImageKeys: string[] = [];
  let sessionPdfKeys: string[] = [];
  try {
    const parsedInputs = JSON.parse(session.inputsJson ?? "{}") as {
      imageKeys?: string[];
      pdfKeys?: string[];
    };
    sessionImageKeys = parsedInputs.imageKeys ?? [];
    sessionPdfKeys = parsedInputs.pdfKeys ?? [];
    for (const key of sessionImageKeys) {
      const obj = await env.BUCKET.head(key);
      if (obj?.httpMetadata?.contentType) {
        r2KeyMimeMap[key] = obj.httpMetadata.contentType;
      }
    }
  } catch {
    // best-effort; fall back to image/jpeg below
  }

  // Scan each op's tiptapJson for ingestion image references and create page_attachments.
  // Track (pageId → Set<r2Key>) to avoid duplicate inserts when saving all uploaded files below.
  const insertedAttachments = new Map<string, Set<string>>();
  for (const op of body.operations) {
    const pageId = op.type === "create" ? tempIdMap[op.tempId as string] : (op.pageId as string);
    if (!pageId || !op.tiptapJson) continue;

    if (!insertedAttachments.has(pageId)) insertedAttachments.set(pageId, new Set());
    // biome-ignore lint/style/noNonNullAssertion: set above
    const pageInserted = insertedAttachments.get(pageId)!;

    const imgRegex = /"src":"\/api\/images\/(ingestion\/[^"]+)"/g;
    const seenKeys = new Set<string>();
    for (const match of op.tiptapJson.matchAll(imgRegex)) {
      const r2Key = match[1];
      if (seenKeys.has(r2Key)) continue;
      seenKeys.add(r2Key);
      pageInserted.add(r2Key);
      const fileName = r2Key.split("/").at(-1) ?? r2Key;
      const mimeType = r2KeyMimeMap[r2Key] ?? "image/jpeg";
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO page_attachments (id, page_id, r2_key, file_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())",
        ).bind(nanoid(), pageId, r2Key, fileName, mimeType),
      );
    }
  }

  // Save all uploaded images as attachments on every page in this commit
  for (const pageId of pageIds) {
    const pageInserted = insertedAttachments.get(pageId) ?? new Set<string>();
    for (const r2Key of sessionImageKeys) {
      if (pageInserted.has(r2Key)) continue;
      const fileName = r2Key.split("/").at(-1) ?? r2Key;
      const mimeType = r2KeyMimeMap[r2Key] ?? "image/jpeg";
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO page_attachments (id, page_id, r2_key, file_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())",
        ).bind(nanoid(), pageId, r2Key, fileName, mimeType),
      );
    }
  }

  // Save uploaded PDFs as page sources (shown in the Sources section on the wiki page)
  for (const pageId of pageIds) {
    for (const r2Key of sessionPdfKeys) {
      const fileName = r2Key.split("/").at(-1) ?? r2Key;
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO page_sources (id, page_id, url, title, created_at) VALUES (?, ?, ?, ?, unixepoch())",
        ).bind(nanoid(), pageId, `/api/images/${r2Key}`, fileName),
      );
    }
  }

  // Archive session
  statements.push(
    env.DB.prepare(
      `UPDATE ingestion_sessions SET status = 'archived', updated_at = unixepoch() WHERE id = ?`,
    ).bind(params.sessionId),
  );

  // Run all statements atomically — send translation jobs only after success
  await env.DB.batch(statements);

  const { ctx } = context.cloudflare;
  for (const pid of translationPageIds) {
    await sendOrRunTranslation(env, ctx, pid);
  }

  return Response.json({ pageIds });
}
