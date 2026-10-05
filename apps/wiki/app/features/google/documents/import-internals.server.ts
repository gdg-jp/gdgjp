import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import {
  type GoogleDocsInlineImage,
  type GoogleDocsMarkdownNode,
  convertGoogleDocsDocument,
} from "~/features/google/docs-markdown.server";
import { getGoogleDriveAccessToken } from "~/features/google/drive-token.server";
import { getGoogleDocumentWithTabs } from "~/features/google/drive.server";
import { generateSlug } from "~/features/ingestion/slug";
import { getDb } from "~/lib/db.server";

/**
 * Shared internals for the Google Docs import pipeline. Public entry points are
 * split by "reason to read": `preview.server.ts` (dry-run diff),
 * `apply.server.ts` (synchronous batch import), `job.server.ts` (queued job).
 */

export const ROOT_NODE_ID = "__document_root__";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const D1_MAX_VALUE_BYTES = 2_000_000;

export type FlatNode = {
  sourceNodeId: string;
  parentSourceNodeId: string | null;
  sourceKind: "document" | "tab";
  sortOrder: number;
  node: GoogleDocsMarkdownNode;
};

export type PreviewPage = {
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

export function flattenDocument(root: GoogleDocsMarkdownNode): FlatNode[] {
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

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function importDiagnostics(documentId: string, nodes: FlatNode[]): ImportDiagnostics {
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

export function persistedContentDiagnostics(
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

export function logImport(event: string, fields: Record<string, unknown>) {
  // Do not log document content, Google access tokens, or Google image URLs.
  console.log(JSON.stringify({ component: "google-document-import", event, ...fields }));
}

export function errorDetails(error: unknown) {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { errorName: typeof error, errorMessage: String(error) };
}

export async function loadSource(env: Env, documentId: string, userId: string) {
  const db = getDb(env);
  const token = await getGoogleDriveAccessToken(env, db, userId);
  const document = await getGoogleDocumentWithTabs(documentId, token);
  if (document.documentId !== documentId)
    throw new Error("Selected Google Document could not be verified");
  return { token, document, nodes: flattenDocument(convertGoogleDocsDocument(document)) };
}

export async function getExistingImport(
  env: Env,
  documentId: string,
  userId: string,
  isAdmin: boolean,
) {
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

export async function persistImages(
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

export async function uniqueSlug(env: Env, title: string, reserved: Set<string>): Promise<string> {
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
