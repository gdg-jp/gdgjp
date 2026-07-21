import type {
  GoogleDocsDocument,
  GoogleDocsStructuralElement,
  GoogleDocsTab,
} from "../../../../../app/lib/google-drive.server";
import type {
  AdapterResult,
  ListOptions,
  ListResult,
  ReadOptions,
  ReadResult,
  WorkspaceAdapter,
  WorkspaceEntry,
} from "../workspace/contracts";
import { WORKSPACE_LIMITS } from "../workspace/contracts";
import {
  boundedLimit,
  decodeOffsetCursor,
  encodeOffsetCursor,
  normaliseRelativeWorkspacePath,
} from "../workspace/paths";

export interface GoogleDocsWorkspaceDocument {
  document: GoogleDocsDocument;
  /** Optional stable ID when the document object came from a different API. */
  id?: string;
}

/**
 * A source node ready for node-by-node persistence. `path` and `parentPath`
 * are relative to the `/google-docs` mount, so no synthetic prefix or file
 * extension leaks into R2 manifests.
 */
export interface GoogleDocsWorkspaceNode {
  path: string;
  parentPath: string | null;
  title: string;
  kind: "google_document" | "google_tab";
  content?: string;
  externalId: string;
}

type Node = {
  id: string;
  name: string;
  title: string;
  path: string;
  kind: "google_document" | "google_tab";
  content: string | null;
  children: Node[];
};

/** Preserve human-readable titles while ensuring each segment is a path segment. */
export function googleDocsPathSegment(title: string, fallback: string): string {
  const cleaned = title.trim().replaceAll("/", "／").replaceAll("\\", "＼").replace(/\0/g, "");
  return !cleaned || cleaned === "." || cleaned === ".." ? fallback : cleaned;
}

function withUniqueNames<T extends { name: string }>(values: readonly T[]): T[] {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (occurrences.get(value.name) ?? 0) + 1;
    occurrences.set(value.name, occurrence);
    return occurrence === 1 ? value : { ...value, name: `${value.name} (${occurrence})` };
  });
}

function textFromElements(elements: readonly GoogleDocsStructuralElement[] | undefined): string {
  if (!elements) return "";
  return elements
    .map((element) => {
      if (element.paragraph) {
        return (element.paragraph.elements ?? [])
          .map((paragraphElement) => paragraphElement.textRun?.content ?? "")
          .join("");
      }
      if (element.table) {
        return (element.table.tableRows ?? [])
          .map((row) =>
            (row.tableCells ?? []).map((cell) => textFromElements(cell.content)).join("\t"),
          )
          .join("\n");
      }
      return textFromElements(element.tableOfContents?.content);
    })
    .join("");
}

/** Extracts only one requested tab's body. It deliberately never walks child tabs. */
export function textFromGoogleDocsTab(tab: GoogleDocsTab): string {
  return textFromElements(tab.documentTab?.body?.content);
}

function buildTabNodes(tabs: readonly GoogleDocsTab[], parentPath: string): Node[] {
  const provisional = tabs.map((tab, index) => ({
    tab,
    name: googleDocsPathSegment(tab.tabProperties?.title ?? "", `Tab ${index + 1}`),
  }));
  return withUniqueNames(provisional).map(({ tab, name }, index) => {
    const path = parentPath ? `${parentPath}/${name}` : name;
    return {
      id: tab.tabProperties?.tabId ?? `${parentPath}:tab:${index + 1}`,
      name,
      title: tab.tabProperties?.title?.trim() || name,
      path,
      kind: "google_tab",
      content: textFromGoogleDocsTab(tab),
      children: buildTabNodes(tab.childTabs ?? [], path),
    };
  });
}

function buildDocumentNodes(documents: readonly GoogleDocsWorkspaceDocument[]): Node[] {
  const provisional = documents.map(({ document, id }, index) => ({
    document,
    id: id ?? document.documentId ?? `document-${index + 1}`,
    name: googleDocsPathSegment(document.title ?? "", `Document ${index + 1}`),
  }));
  return withUniqueNames(provisional).map(({ document, id, name }) => {
    const title = document.title?.trim() || name;
    return {
      id,
      name,
      title,
      path: name,
      kind: "google_document",
      // Legacy single-tab documents retain their body on the document node.
      // Tabbed documents are intentionally not concatenated here.
      content: document.body ? textFromElements(document.body.content) : null,
      children: buildTabNodes(document.tabs ?? [], name),
    };
  });
}

function findNode(nodes: readonly Node[], path: string): Node | null {
  const segments = path ? path.split("/") : [];
  let currentNodes = nodes;
  let current: Node | undefined;
  for (const segment of segments) {
    current = currentNodes.find((node) => node.name === segment);
    if (!current) return null;
    currentNodes = current.children;
  }
  return current ?? null;
}

function listEntry(node: Node): WorkspaceEntry {
  return {
    name: node.name,
    path: node.path,
    readable: node.content !== null,
    hasChildren: node.children.length > 0,
    title: node.title,
  };
}

function flattenNodes(
  nodes: readonly Node[],
  parentPath: string | null,
): GoogleDocsWorkspaceNode[] {
  return nodes.flatMap((node) => [
    {
      path: node.path,
      parentPath,
      title: node.title,
      kind: node.kind,
      ...(node.content === null ? {} : { content: node.content }),
      externalId: node.id,
    },
    ...flattenNodes(node.children, node.path),
  ]);
}

/**
 * Flattens API documents into independently persistable document/tab records.
 * The content is one node body at a time; it never combines a document's tabs.
 */
export function flattenGoogleDocsWorkspaceNodes(
  documents: readonly GoogleDocsWorkspaceDocument[],
): GoogleDocsWorkspaceNode[] {
  return flattenNodes(buildDocumentNodes(documents), null);
}

function sliceContent(
  path: string,
  content: string,
  options: ReadOptions | undefined,
): AdapterResult<ReadResult> {
  const maxChars = boundedLimit(
    options?.maxChars,
    WORKSPACE_LIMITS.maxReadCharacters,
    WORKSPACE_LIMITS.defaultReadCharacters,
  );
  const offset = decodeOffsetCursor(options?.cursor);
  if (offset > content.length) throw new Error("Workspace cursor is outside resource");
  const end = Math.min(content.length, offset + maxChars);
  return {
    data: {
      path,
      content: content.slice(offset, end),
      nextCursor: end < content.length ? encodeOffsetCursor(end) : null,
    },
    truncated: end < content.length,
  };
}

/**
 * Builds an immutable mount adapter from Google Docs API responses. Fetching is
 * intentionally separate: the adapter is pure and `cat` returns one stored
 * document/tab body only, never a joined document export.
 */
export function createGoogleDocsWorkspaceAdapter(
  documents: readonly GoogleDocsWorkspaceDocument[],
): WorkspaceAdapter {
  const roots = buildDocumentNodes(documents);

  return {
    async ls(input: string, options: ListOptions = {}): Promise<AdapterResult<ListResult>> {
      const path = normaliseRelativeWorkspacePath(input);
      const node = path ? findNode(roots, path) : null;
      if (path && !node) throw new Error(`Google Docs workspace path not found: ${path}`);
      const limit = boundedLimit(
        options.limit,
        WORKSPACE_LIMITS.maxDirectoryEntries,
        WORKSPACE_LIMITS.defaultDirectoryEntries,
      );
      const offset = decodeOffsetCursor(options.cursor);
      const children = node ? node.children : roots;
      const entries = children.slice(offset, offset + limit).map(listEntry);
      const hasMore = offset + limit < children.length;
      return {
        data: {
          path,
          entries,
          nextCursor: hasMore ? encodeOffsetCursor(offset + entries.length) : null,
        },
        truncated: hasMore,
      };
    },

    async cat(input: string, options?: ReadOptions): Promise<AdapterResult<ReadResult>> {
      const path = normaliseRelativeWorkspacePath(input);
      if (!path) throw new Error("Google Docs workspace root has no readable content");
      const node = findNode(roots, path);
      if (!node) throw new Error(`Google Docs workspace path not found: ${path}`);
      if (node.content === null) {
        throw new Error(`Google Docs workspace path has no readable content: ${path}`);
      }
      return sliceContent(path, node.content, options);
    },
  };
}
