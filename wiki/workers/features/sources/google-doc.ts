import type { GoogleDocsInlineImage } from "../../../app/lib/google-docs-markdown.server";
import type { GoogleDocsMarkdownNode } from "../../../app/lib/google-docs-markdown.server";
import { googleDocsPathSegment } from "../ingestion/tools/google-docs/workspace";

export interface FetchedSourceDocument {
  path: string;
  title: string;
  markdown: string;
  images: GoogleDocsInlineImage[];
}

/**
 * The document body becomes `index`; tabs keep their title hierarchy. The document
 * title is deliberately left out of the path so renaming the Doc does not orphan
 * every source_document under it.
 */
export function collectDocuments(root: GoogleDocsMarkdownNode): FetchedSourceDocument[] {
  const documents: FetchedSourceDocument[] = [];
  if (root.markdown.trim()) {
    documents.push({
      path: "index",
      title: root.title,
      markdown: root.markdown,
      images: root.images,
    });
  }
  collectTabs(root.children, "", documents);
  return documents;
}

function collectTabs(
  nodes: readonly GoogleDocsMarkdownNode[],
  parentPath: string,
  out: FetchedSourceDocument[],
): void {
  const segments = withUniqueNames(
    nodes.map((node, index) => ({
      node,
      name: googleDocsPathSegment(node.title, `Tab ${index + 1}`),
    })),
  );

  for (const { node, name } of segments) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (node.markdown.trim()) {
      out.push({ path, title: node.title, markdown: node.markdown, images: node.images });
    }
    collectTabs(node.children, path, out);
  }
}

/** Sibling tabs may share a title; disambiguate so `(source_id, path)` stays unique. */
export function withUniqueNames<T extends { name: string }>(values: readonly T[]): T[] {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (occurrences.get(value.name) ?? 0) + 1;
    occurrences.set(value.name, occurrence);
    return occurrence === 1 ? value : { ...value, name: `${value.name} (${occurrence})` };
  });
}
