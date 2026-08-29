import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import {
  type GoogleDocsInlineImage,
  type GoogleDocsMarkdownNode,
  convertGoogleDocsDocument,
  resolveGoogleDocsInternalLinks,
} from "~/features/google/docs-markdown.server";
import { getGoogleDriveAccessToken } from "~/features/google/drive-token.server";
import { getGoogleDocumentWithTabs } from "~/features/google/drive.server";
import { generateSlug } from "~/features/ingestion/slug";
import { getDb } from "~/lib/db.server";

const ROOT_NODE_ID = "__document_root__";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const D1_MAX_VALUE_BYTES = 2_000_000;

type FlatNode = {
  sourceNodeId: string;
  parentSourceNodeId: string | null;
  sourceKind: "document" | "tab";
  sortOrder: number;
  node: GoogleDocsMarkdownNode;
};

type PreviewPage = {
  title: string;
  action: "create" | "update" | "archive";
  depth: number;
};

type ImportDiagnostics = {
  documentId: string;
  nodeCount: number;
  imageCount: number;
  totalMarkdownBytes: number;
  largestMarkdownBytes: number;
  nodesAtOrOverD1ValueLimit: number;
};

type PersistedContentDiagnostics = {
  totalPersistedContentBytes: number;
  largestPersistedContentBytes: number;
  persistedNodesAtOrOverD1ValueLimit: number;
};

export type GoogleDocumentImportPreview = {
  documentTitle: string;
  createCount: number;
  updateCount: number;
  archiveCount: number;
  pages: PreviewPage[];
};

function flattenDocument(root: GoogleDocsMarkdownNode): FlatNode[] {
  const values: FlatNode[] = [];
  const visit = (
    node: GoogleDocsMarkdownNode,
    sourceNodeId: string,
    parentSourceNodeId: string | null,
    sourceKind: "document" | "tab",
    sortOrder: number,
  ) => {
    values.push({ sourceNodeId, parentSourceNodeId, sourceKind, sortOrder, node });
    node.children.forEach((child, index) =>
      visit(child, child.externalId, sourceNodeId, "tab", index),
    );
  };
  visit(root, ROOT_NODE_ID, null, "document", 0);
  return values;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function importDiagnostics(documentId: string, nodes: FlatNode[]): ImportDiagnostics {
  const markdownBytes = nodes.map((node) => byteLength(node.node.markdown));
  return {
    documentId,
    nodeCount: nodes.length,
    imageCount: nodes.reduce((count, node) => count + node.node.images.length, 0),
    totalMarkdownBytes: markdownBytes.reduce((total, bytes) => total + bytes, 0),
    largestMarkdownBytes: Math.max(0, ...markdownBytes),
    nodesAtOrOverD1ValueLimit: markdownBytes.filter((bytes) => bytes >= D1_MAX_VALUE_BYTES).length,
  };
}

function persistedContentDiagnostics(
  rendered: Map<string, Awaited<ReturnType<typeof persistImages>>>,
): PersistedContentDiagnostics {
  const contentBytes = [...rendered.values()].map((value) => byteLength(value.content));
  return {
    totalPersistedContentBytes: contentBytes.reduce((total, bytes) => total + bytes, 0),
    largestPersistedContentBytes: Math.max(0, ...contentBytes),
    persistedNodesAtOrOverD1ValueLimit: contentBytes.filter((bytes) => bytes >= D1_MAX_VALUE_BYTES)
      .length,
  };
}

function logImport(event: string, fields: Record<string, unknown>) {
  // Do not log document content, Google access tokens, or Google image URLs.
  console.log(JSON.stringify({ component: "google-document-import", event, ...fields }));
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { errorName: typeof error, errorMessage: String(error) };
}

async function loadSource(env: Env, documentId: string, userId: string) {
  const db = getDb(env);
  const token = await getGoogleDriveAccessToken(env, db, userId);
  const document = await getGoogleDocumentWithTabs(documentId, token);
  if (document.documentId !== documentId)
    throw new Error("Selected Google Document could not be verified");
  return { token, document, nodes: flattenDocument(convertGoogleDocsDocument(document)) };
}

async function getExistingImport(env: Env, documentId: string, userId: string, isAdmin: boolean) {
  const db = getDb(env);
  const imported = await db
    .select()
    .from(schema.googleDocumentImports)
    .where(eq(schema.googleDocumentImports.documentId, documentId))
    .get();
  if (imported && imported.importedBy !== userId && !isAdmin) {
    throw new Error("Only the original importer can update this Google Document");
  }
  const nodes = imported
    ? await db
        .select()
        .from(schema.googleDocumentImportNodes)
        .where(eq(schema.googleDocumentImportNodes.documentId, documentId))
        .all()
    : [];
  return { imported, nodes };
}

export async function previewGoogleDocumentImport(
  env: Env,
  documentId: string,
  userId: string,
  isAdmin: boolean,
): Promise<GoogleDocumentImportPreview> {
  const [{ document, nodes }, existing] = await Promise.all([
    loadSource(env, documentId, userId),
    getExistingImport(env, documentId, userId, isAdmin),
  ]);
  const existingBySource = new Map(existing.nodes.map((node) => [node.sourceNodeId, node]));
  const sourceNodeIds = new Set(nodes.map((node) => node.sourceNodeId));
  const depthBySourceNodeId = new Map<string, number>();
  const pages: PreviewPage[] = nodes.map((node) => {
    const depth = node.parentSourceNodeId
      ? (depthBySourceNodeId.get(node.parentSourceNodeId) ?? -1) + 1
      : 0;
    depthBySourceNodeId.set(node.sourceNodeId, depth);
    return {
      title: node.node.title,
      action: existingBySource.has(node.sourceNodeId) ? "update" : "create",
      depth,
    };
  });
  for (const node of existing.nodes) {
    if (!sourceNodeIds.has(node.sourceNodeId) && node.status !== "archived") {
      pages.push({ title: node.sourceNodeId, action: "archive", depth: 0 });
    }
  }
  return {
    documentTitle: document.title?.trim() || "Untitled document",
    createCount: pages.filter((page) => page.action === "create").length,
    updateCount: pages.filter((page) => page.action === "update").length,
    archiveCount: pages.filter((page) => page.action === "archive").length,
    pages,
  };
}

function extensionFor(contentType: string | null): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function removeImagePlaceholder(markdown: string, objectId: string): string {
  // object IDs originate from the Docs API. Removing the entire image token is
  // preferable to leaving a broken attachment URL in the imported document.
  const escapedObjectId = objectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(`!\\[(?:\\\\.|[^\\]])*\\]\\(attachment:${escapedObjectId}\\)`, "g"),
    "",
  );
}

async function persistImages(
  env: Env,
  token: string,
  pageId: string,
  markdown: string,
  images: GoogleDocsInlineImage[],
  diagnostics?: { documentId: string; sourceNodeId: string },
) {
  let content = markdown;
  const attachments: Array<{ id: string; r2Key: string; fileName: string; mimeType: string }> = [];
  for (const image of images) {
    const response = await fetch(image.sourceUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 404) {
        // Docs content URIs are short-lived and individual embedded images can
        // disappear. A missing image must never discard the surrounding text.
        content = removeImagePlaceholder(content, image.objectId);
        logImport("image_download_skipped", {
          ...diagnostics,
          objectId: image.objectId,
          status: response.status,
          reason: "not_found",
        });
        continue;
      }
      throw new Error(`Unable to download an image from Google Docs (${response.status})`);
    }
    const mimeType =
      response.headers.get("Content-Type")?.split(";")[0] || image.contentType || "image/jpeg";
    if (!mimeType.startsWith("image/"))
      throw new Error("Google Docs returned an invalid image type");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw new Error("A Google Docs image exceeds the 10 MB limit");
    const id = nanoid();
    const r2Key = `wiki/${pageId}/google-documents/${id}.${extensionFor(mimeType)}`;
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mimeType } });
    attachments.push({
      id,
      r2Key,
      fileName: `google-doc-${id}.${extensionFor(mimeType)}`,
      mimeType,
    });
    content = content.replaceAll(`attachment:${image.objectId}`, `/api/images/${r2Key}`);
  }
  return { content, attachments };
}

async function uniqueSlug(env: Env, title: string, reserved: Set<string>): Promise<string> {
  const db = getDb(env);
  const base = generateSlug(title) || `page-${nanoid(8)}`;
  let slug = base;
  while (
    reserved.has(slug) ||
    (await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(eq(schema.pages.slug, slug))
      .get())
  ) {
    slug = `${base}-${nanoid(6)}`;
  }
  reserved.add(slug);
  return slug;
}

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
