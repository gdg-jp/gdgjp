import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { resolveGoogleDocsInternalLinks } from "~/features/google/docs-markdown.server";
import { getDb } from "~/lib/db.server";
import {
  ROOT_NODE_ID,
  errorDetails,
  getExistingImport,
  loadSource,
  logImport,
  persistImages,
  uniqueSlug,
} from "./import-internals.server";

export type GoogleDocumentImportJob = {
  id: string;
  documentId: string;
  status: string;
  totalNodes: number;
  completedNodes: number;
  totalImages: number;
  completedImages: number;
  warningCount: number;
  errorMessage: string | null;
};

export async function enqueueGoogleDocumentImport(
  env: Env,
  documentId: string,
  user: { id: string; isAdmin: boolean },
): Promise<{ jobId: string }> {
  const existingImport = await getExistingImport(env, documentId, user.id, user.isAdmin);
  const db = getDb(env);
  const current = await db
    .select()
    .from(schema.googleDocumentImportJobs)
    .where(eq(schema.googleDocumentImportJobs.documentId, documentId))
    .get();
  if (current && (current.status === "queued" || current.status === "running")) {
    return { jobId: current.id };
  }

  const jobId = nanoid();
  await env.DB.prepare(
    "INSERT INTO google_document_import_jobs (id,document_id,requested_by,status,total_nodes,completed_nodes,total_images,completed_images,warning_count,error_message,created_at,updated_at) VALUES (?,?,?,'queued',0,0,0,0,0,NULL,unixepoch(),unixepoch()) ON CONFLICT(document_id) DO UPDATE SET id=excluded.id,requested_by=excluded.requested_by,status='queued',total_nodes=0,completed_nodes=0,total_images=0,completed_images=0,warning_count=0,error_message=NULL,updated_at=unixepoch()",
  )
    .bind(jobId, documentId, user.id)
    .run();
  // Retain the authorization check above even when no provenance exists yet.
  void existingImport;
  await env.GOOGLE_DOCUMENT_IMPORT_QUEUE.send({ type: "google_document_import", jobId });
  return { jobId };
}

export async function getGoogleDocumentImportJob(
  env: Env,
  jobId: string,
  user: { id: string; isAdmin: boolean },
): Promise<GoogleDocumentImportJob | null> {
  const job = await getDb(env)
    .select()
    .from(schema.googleDocumentImportJobs)
    .where(eq(schema.googleDocumentImportJobs.id, jobId))
    .get();
  if (!job) return null;
  if (job.requestedBy !== user.id && !user.isAdmin) throw new Error("Forbidden");
  return job;
}

/** Processes one queue job. Pages are made visible before their images are downloaded. */
export async function processGoogleDocumentImport(env: Env, jobId: string): Promise<void> {
  const db = getDb(env);
  const job = await db
    .select()
    .from(schema.googleDocumentImportJobs)
    .where(eq(schema.googleDocumentImportJobs.id, jobId))
    .get();
  if (!job) return;

  try {
    await env.DB.prepare(
      "UPDATE google_document_import_jobs SET status='running',error_message=NULL,updated_at=unixepoch() WHERE id=?",
    )
      .bind(jobId)
      .run();
    const [source, existing] = await Promise.all([
      loadSource(env, job.documentId, job.requestedBy),
      getExistingImport(env, job.documentId, job.requestedBy, true),
    ]);
    const totalImages = source.nodes.reduce((count, node) => count + node.node.images.length, 0);
    await env.DB.prepare(
      "UPDATE google_document_import_jobs SET total_nodes=?,total_images=?,updated_at=unixepoch() WHERE id=?",
    )
      .bind(source.nodes.length, totalImages, jobId)
      .run();

    const existingBySource = new Map(existing.nodes.map((node) => [node.sourceNodeId, node]));
    const pageIdBySource = new Map<string, string>();
    const slugBySource = new Map<string, string>();
    const reserved = new Set<string>();
    let completedImages = 0;
    let warnings = 0;

    // Allocate all target pages before rendering any node so cross-tab links do
    // not depend on queue traversal order.
    for (const node of source.nodes) {
      const current = existingBySource.get(node.sourceNodeId);
      const pageId = current?.pageId ?? nanoid();
      if (current) {
        const page = await db
          .select({ slug: schema.pages.slug })
          .from(schema.pages)
          .where(eq(schema.pages.id, pageId))
          .get();
        if (!page) throw new Error("A previously imported Wiki page no longer exists");
        slugBySource.set(node.sourceNodeId, page.slug);
      } else {
        slugBySource.set(node.sourceNodeId, await uniqueSlug(env, node.node.title, reserved));
      }
      pageIdBySource.set(node.sourceNodeId, pageId);
    }
    // Legacy single-tab heading/bookmark links omit tabId. They target the root page.
    slugBySource.set("", slugBySource.get(ROOT_NODE_ID) as string);

    for (const node of source.nodes) {
      const current = existingBySource.get(node.sourceNodeId);
      const pageId = pageIdBySource.get(node.sourceNodeId) as string;
      const parentId = node.parentSourceNodeId ? pageIdBySource.get(node.parentSourceNodeId) : null;
      if (node.parentSourceNodeId && !parentId)
        throw new Error("Google Document tab parent is missing");
      const slug = slugBySource.get(node.sourceNodeId) as string;

      // Persist a skeleton first. This is intentionally a small transaction so
      // the sidebar can reveal root/tabs while later nodes and images arrive.
      const statements: D1PreparedStatement[] = [];
      if (current) {
        statements.push(
          env.DB.prepare(
            "UPDATE pages SET title_ja=?,parent_id=?,acl_synced_with_parent=CASE WHEN ? IS NULL THEN 1 ELSE 0 END,sort_order=?,status='published',updated_at=unixepoch() WHERE id=?",
          ).bind(node.node.title, parentId ?? null, parentId ?? null, node.sortOrder, pageId),
        );
      } else {
        statements.push(
          env.DB.prepare(
            "INSERT INTO pages (id,title_ja,slug,content_ja,parent_id,acl_synced_with_parent,sort_order,status,visibility,general_role,author_id,last_edited_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'published','restricted','viewer',?,?,unixepoch(),unixepoch())",
          ).bind(
            pageId,
            node.node.title,
            slug,
            "",
            parentId ?? null,
            parentId === null ? 1 : 0,
            node.sortOrder,
            job.requestedBy,
            job.requestedBy,
          ),
        );
      }
      if (node.sourceNodeId === ROOT_NODE_ID) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO google_document_imports (document_id,root_page_id,imported_by,status,last_imported_at,created_at,updated_at) VALUES (?,?,?,'syncing',unixepoch(),unixepoch(),unixepoch()) ON CONFLICT(document_id) DO UPDATE SET root_page_id=excluded.root_page_id,status='syncing',error_message=NULL,last_imported_at=unixepoch(),updated_at=unixepoch()",
          ).bind(job.documentId, pageId, job.requestedBy),
        );
      }
      statements.push(
        env.DB.prepare(
          "INSERT INTO google_document_import_nodes (document_id,source_node_id,page_id,source_parent_node_id,source_kind,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',unixepoch(),unixepoch()) ON CONFLICT(document_id,source_node_id) DO UPDATE SET page_id=excluded.page_id,source_parent_node_id=excluded.source_parent_node_id,source_kind=excluded.source_kind,sort_order=excluded.sort_order,status='active',updated_at=unixepoch()",
        ).bind(
          job.documentId,
          node.sourceNodeId,
          pageId,
          node.parentSourceNodeId,
          node.sourceKind,
          node.sortOrder,
        ),
      );
      await env.DB.batch(statements);

      const linkResult = resolveGoogleDocsInternalLinks(
        node.node.markdown,
        slugBySource,
        job.documentId,
      );
      if (
        node.node.warnings.length ||
        linkResult.unresolvedBookmarks ||
        linkResult.unresolvedTargets
      ) {
        logImport("source_conversion_warning", {
          documentId: job.documentId,
          sourceNodeId: node.sourceNodeId,
          warnings: [...new Set(node.node.warnings)],
          unresolvedBookmarks: linkResult.unresolvedBookmarks,
          unresolvedTargets: linkResult.unresolvedTargets,
        });
      }
      const rendered = await persistImages(
        env,
        source.token,
        pageId,
        linkResult.markdown,
        node.node.images,
        {
          documentId: job.documentId,
          sourceNodeId: node.sourceNodeId,
        },
      );
      const skipped = node.node.images.length - rendered.attachments.length;
      warnings +=
        skipped +
        node.node.warnings.length +
        linkResult.unresolvedBookmarks +
        linkResult.unresolvedTargets;
      completedImages += rendered.attachments.length;
      const contentStatements: D1PreparedStatement[] = [
        env.DB.prepare("UPDATE pages SET content_ja=?,updated_at=unixepoch() WHERE id=?").bind(
          rendered.content,
          pageId,
        ),
        env.DB.prepare("DELETE FROM page_attachments WHERE page_id=? AND r2_key LIKE ?").bind(
          pageId,
          `wiki/${pageId}/google-documents/%`,
        ),
        ...rendered.attachments.map((attachment) =>
          env.DB.prepare(
            "INSERT INTO page_attachments (id,page_id,r2_key,file_name,mime_type,created_at) VALUES (?,?,?,?,?,unixepoch())",
          ).bind(attachment.id, pageId, attachment.r2Key, attachment.fileName, attachment.mimeType),
        ),
      ];
      await env.DB.batch(contentStatements);
      await env.DB.prepare(
        "UPDATE google_document_import_jobs SET completed_nodes=completed_nodes+1,completed_images=?,warning_count=?,updated_at=unixepoch() WHERE id=?",
      )
        .bind(completedImages, warnings, jobId)
        .run();
    }

    const present = new Set(source.nodes.map((node) => node.sourceNodeId));
    for (const node of existing.nodes) {
      if (present.has(node.sourceNodeId) || node.status === "archived") continue;
      await env.DB.batch([
        env.DB.prepare("UPDATE pages SET status='archived',updated_at=unixepoch() WHERE id=?").bind(
          node.pageId,
        ),
        env.DB.prepare(
          "UPDATE google_document_import_nodes SET status='archived',updated_at=unixepoch() WHERE document_id=? AND source_node_id=?",
        ).bind(job.documentId, node.sourceNodeId),
      ]);
    }
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE google_document_imports SET status='ready',error_message=NULL,last_imported_at=unixepoch(),updated_at=unixepoch() WHERE document_id=?",
      ).bind(job.documentId),
      env.DB.prepare(
        "UPDATE google_document_import_jobs SET status='completed',updated_at=unixepoch() WHERE id=?",
      ).bind(jobId),
    ]);
  } catch (error) {
    const details = errorDetails(error);
    logImport("job_failed", { jobId, documentId: job.documentId, ...details });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE google_document_import_jobs SET status='failed',error_message=?,updated_at=unixepoch() WHERE id=?",
      ).bind(details.errorMessage, jobId),
      env.DB.prepare(
        "UPDATE google_document_imports SET status='failed',error_message=?,updated_at=unixepoch() WHERE document_id=?",
      ).bind(details.errorMessage, job.documentId),
    ]);
    throw error;
  }
}
