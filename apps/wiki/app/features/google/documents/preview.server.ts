import type { PreviewPage } from "./import-internals.server";
import { getExistingImport, loadSource } from "./import-internals.server";

export type GoogleDocumentImportPreview = {
  documentTitle: string;
  createCount: number;
  updateCount: number;
  archiveCount: number;
  pages: PreviewPage[];
};

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
