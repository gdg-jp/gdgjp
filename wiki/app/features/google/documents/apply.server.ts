import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { resolveGoogleDocsInternalLinks } from "~/features/google/docs-markdown.server";
import { getDb } from "~/lib/db.server";
import {
  D1_MAX_VALUE_BYTES,
  ROOT_NODE_ID,
  byteLength,
  errorDetails,
  getExistingImport,
  importDiagnostics,
  loadSource,
  logImport,
  persistImages,
  persistedContentDiagnostics,
  uniqueSlug,
} from "./import-internals.server";

export async function importGoogleDocument(
  env: Env,
  documentId: string,
  user: { id: string; isAdmin: boolean },
): Promise<{ slug: string }> {
  const startedAt = Date.now();
  const [source, existing] = await Promise.all([
    loadSource(env, documentId, user.id),
    getExistingImport(env, documentId, user.id, user.isAdmin),
  ]);
  const diagnostics = importDiagnostics(documentId, source.nodes);
  logImport("source_loaded", {
    ...diagnostics,
    existingNodeCount: existing.nodes.length,
    elapsedMs: Date.now() - startedAt,
  });
  if (diagnostics.nodesAtOrOverD1ValueLimit > 0) {
    logImport("d1_value_limit_risk", { ...diagnostics, d1MaxValueBytes: D1_MAX_VALUE_BYTES });
  }
  const db = getDb(env);
  const existingBySource = new Map(existing.nodes.map((node) => [node.sourceNodeId, node]));
  const pageIdBySource = new Map<string, string>();
  const reserved = new Set<string>();
  const slugBySource = new Map<string, string>();
  for (const node of source.nodes) {
    const current = existingBySource.get(node.sourceNodeId);
    pageIdBySource.set(node.sourceNodeId, current?.pageId ?? nanoid());
    if (current) {
      const page = await db
        .select({ slug: schema.pages.slug })
        .from(schema.pages)
        .where(eq(schema.pages.id, current.pageId))
        .get();
      if (!page) throw new Error("A previously imported Wiki page no longer exists");
      slugBySource.set(node.sourceNodeId, page.slug);
    } else {
      slugBySource.set(node.sourceNodeId, await uniqueSlug(env, node.node.title, reserved));
    }
  }
  // Legacy single-tab heading/bookmark links omit tabId. They target the root page.
  slugBySource.set("", slugBySource.get(ROOT_NODE_ID) as string);

  const rendered = new Map<string, Awaited<ReturnType<typeof persistImages>>>();
  for (const node of source.nodes) {
    const resolved = resolveGoogleDocsInternalLinks(node.node.markdown, slugBySource, documentId);
    const warningCount =
      node.node.warnings.length + resolved.unresolvedBookmarks + resolved.unresolvedTargets;
    if (warningCount) {
      logImport("source_conversion_warning", {
        documentId,
        sourceNodeId: node.sourceNodeId,
        warningCount,
        warnings: [...new Set(node.node.warnings)],
        unresolvedBookmarks: resolved.unresolvedBookmarks,
        unresolvedTargets: resolved.unresolvedTargets,
      });
    }
    try {
      rendered.set(
        node.sourceNodeId,
        await persistImages(
          env,
          source.token,
          pageIdBySource.get(node.sourceNodeId) as string,
          resolved.markdown,
          node.node.images,
        ),
      );
    } catch (error) {
      logImport("image_persistence_failed", {
        documentId,
        sourceNodeId: node.sourceNodeId,
        imageCount: node.node.images.length,
        markdownBytes: byteLength(node.node.markdown),
        ...errorDetails(error),
      });
      throw error;
    }
  }

  const affectedPageIds = source.nodes
    .map((node) => existingBySource.get(node.sourceNodeId)?.pageId)
    .filter((value): value is string => Boolean(value));
  const oldAttachments = affectedPageIds.length
    ? await db
        .select({ r2Key: schema.pageAttachments.r2Key })
        .from(schema.pageAttachments)
        .where(inArray(schema.pageAttachments.pageId, affectedPageIds))
        .all()
    : [];

  const rootPageId = pageIdBySource.get(ROOT_NODE_ID) as string;
  const statements: D1PreparedStatement[] = [];
  for (const node of source.nodes) {
    const pageId = pageIdBySource.get(node.sourceNodeId) as string;
    const parentId = node.parentSourceNodeId
      ? (pageIdBySource.get(node.parentSourceNodeId) as string)
      : null;
    const content = rendered.get(node.sourceNodeId) as Awaited<ReturnType<typeof persistImages>>;
    const current = existingBySource.get(node.sourceNodeId);
    if (current) {
      statements.push(
        env.DB.prepare(
          "UPDATE pages SET title_ja=?, content_ja=?, parent_id=?, acl_synced_with_parent=CASE WHEN ? IS NULL THEN 1 ELSE 0 END, sort_order=?, status='published', visibility='restricted', general_role='viewer', last_edited_by=?, updated_at=unixepoch() WHERE id=?",
        ).bind(
          node.node.title,
          content.content,
          parentId,
          parentId,
          node.sortOrder,
          user.id,
          pageId,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          "INSERT INTO pages (id,title_ja,slug,content_ja,parent_id,acl_synced_with_parent,sort_order,status,visibility,general_role,author_id,last_edited_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'published','restricted','viewer',?,?,unixepoch(),unixepoch())",
        ).bind(
          pageId,
          node.node.title,
          slugBySource.get(node.sourceNodeId),
          content.content,
          parentId,
          parentId === null ? 1 : 0,
          node.sortOrder,
          user.id,
          user.id,
        ),
      );
    }
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO google_document_imports (document_id,root_page_id,imported_by,status,last_imported_at,created_at,updated_at) VALUES (?,? ,?,'ready',unixepoch(),unixepoch(),unixepoch()) ON CONFLICT(document_id) DO UPDATE SET root_page_id=excluded.root_page_id,status='ready',error_message=NULL,last_imported_at=unixepoch(),updated_at=unixepoch()",
    ).bind(documentId, rootPageId, user.id),
  );
  for (const node of source.nodes) {
    const pageId = pageIdBySource.get(node.sourceNodeId) as string;
    statements.push(
      env.DB.prepare(
        "INSERT INTO google_document_import_nodes (document_id,source_node_id,page_id,source_parent_node_id,source_kind,sort_order,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',unixepoch(),unixepoch()) ON CONFLICT(document_id,source_node_id) DO UPDATE SET page_id=excluded.page_id,source_parent_node_id=excluded.source_parent_node_id,source_kind=excluded.source_kind,sort_order=excluded.sort_order,status='active',updated_at=unixepoch()",
      ).bind(
        documentId,
        node.sourceNodeId,
        pageId,
        node.parentSourceNodeId,
        node.sourceKind,
        node.sortOrder,
      ),
    );
    statements.push(
      env.DB.prepare("DELETE FROM page_attachments WHERE page_id=? AND r2_key LIKE ?").bind(
        pageId,
        `wiki/${pageId}/google-documents/%`,
      ),
    );
    for (const attachment of (
      rendered.get(node.sourceNodeId) as Awaited<ReturnType<typeof persistImages>>
    ).attachments) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO page_attachments (id,page_id,r2_key,file_name,mime_type,created_at) VALUES (?,?,?,?,?,unixepoch())",
        ).bind(attachment.id, pageId, attachment.r2Key, attachment.fileName, attachment.mimeType),
      );
    }
  }
  const present = new Set(source.nodes.map((node) => node.sourceNodeId));
  for (const node of existing.nodes) {
    if (present.has(node.sourceNodeId) || node.status === "archived") continue;
    statements.push(
      env.DB.prepare("UPDATE pages SET status='archived',updated_at=unixepoch() WHERE id=?").bind(
        node.pageId,
      ),
    );
    statements.push(
      env.DB.prepare(
        "UPDATE google_document_import_nodes SET status='archived',updated_at=unixepoch() WHERE document_id=? AND source_node_id=?",
      ).bind(documentId, node.sourceNodeId),
    );
  }
  const newKeys = [...rendered.values()].flatMap((value) =>
    value.attachments.map((attachment) => attachment.r2Key),
  );
  const persistedDiagnostics = persistedContentDiagnostics(rendered);
  if (persistedDiagnostics.persistedNodesAtOrOverD1ValueLimit > 0) {
    logImport("d1_persisted_value_limit_risk", {
      documentId,
      ...persistedDiagnostics,
      d1MaxValueBytes: D1_MAX_VALUE_BYTES,
    });
  }
  logImport("d1_batch_prepared", {
    ...diagnostics,
    ...persistedDiagnostics,
    statementCount: statements.length,
    attachmentCount: newKeys.length,
    archivedNodeCount: existing.nodes.filter(
      (node) => !present.has(node.sourceNodeId) && node.status !== "archived",
    ).length,
    elapsedMs: Date.now() - startedAt,
  });
  try {
    await env.DB.batch(statements);
  } catch (error) {
    logImport("d1_batch_failed", {
      ...diagnostics,
      ...persistedDiagnostics,
      statementCount: statements.length,
      attachmentCount: newKeys.length,
      elapsedMs: Date.now() - startedAt,
      ...errorDetails(error),
    });
    // The page rows are atomic; clean up image objects that never became reachable.
    if (newKeys.length) await env.BUCKET.delete(newKeys);
    throw error;
  }
  const staleKeys = oldAttachments
    .map((attachment) => attachment.r2Key)
    .filter((key) => key.includes("/google-documents/"));
  if (staleKeys.length) await env.BUCKET.delete(staleKeys);
  logImport("completed", {
    ...diagnostics,
    ...persistedDiagnostics,
    attachmentCount: newKeys.length,
    staleAttachmentCount: staleKeys.length,
    elapsedMs: Date.now() - startedAt,
  });
  return { slug: slugBySource.get(ROOT_NODE_ID) as string };
}
