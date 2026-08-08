import type { GoogleDocsInlineImage } from "../../../app/lib/google-docs-markdown.server";
import {
  type GoogleDocsMarkdownNode,
  convertGoogleDocsDocument,
} from "../../../app/lib/google-docs-markdown.server";
import { getGoogleDriveDocumentKind } from "../../../app/lib/google-drive-utils";
import {
  exportFileAsText,
  extractFileId,
  getDriveFileName,
  getGoogleDocumentWithTabs,
} from "../../../app/lib/google-drive.server";
import { googleDocsPathSegment } from "../ingestion/tools/google-docs/workspace";

export interface FetchedSourceDocument {
  path: string;
  title: string;
  markdown: string;
  images: GoogleDocsInlineImage[];
}

export interface GoogleDocFetchResult {
  title: string;
  documents: FetchedSourceDocument[];
  /** Reused for inline image downloads, which need the same authorization. */
  accessToken: string;
}

/**
 * Fetch a Google Doc/Sheet/Slide into raw source_documents.
 *
 * Docs go through `convertGoogleDocsDocument` — the same converter the Wiki page
 * import uses — so raw keeps headings, tables, footnotes and smart chips. The
 * `/google-docs` workspace adapter is deliberately not used here: it flattens a
 * document to bare text runs, which is fine for bounded agent browsing but loses
 * exactly the structure the raw layer exists to preserve.
 */
export async function fetchGoogleDocSource(
  url: string,
  getAccessToken: () => Promise<string>,
): Promise<GoogleDocFetchResult> {
  const documentKind = getGoogleDriveDocumentKind(url);
  if (!documentKind) throw new Error("Unsupported Google Workspace URL");

  const fileId = extractFileId(url);
  const accessToken = await getAccessToken();

  if (documentKind !== "document") {
    const title = await getDriveFileName(fileId, accessToken).catch(() => fileId);
    const exportMimeType = documentKind === "spreadsheet" ? "text/csv" : "text/plain";
    return {
      title,
      accessToken,
      documents: [
        {
          path: "index",
          title,
          markdown: await exportFileAsText(fileId, accessToken, exportMimeType),
          images: [],
        },
      ],
    };
  }

  const document = await getGoogleDocumentWithTabs(fileId, accessToken);
  const root = convertGoogleDocsDocument(document);
  return {
    title: document.title?.trim() || fileId,
    accessToken,
    documents: collectDocuments(root),
  };
}

/**
 * The document body becomes `index`; tabs keep their title hierarchy. The document
 * title is deliberately left out of the path so renaming the Doc does not orphan
 * every source_document under it.
 */
function collectDocuments(root: GoogleDocsMarkdownNode): FetchedSourceDocument[] {
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
function withUniqueNames<T extends { name: string }>(values: readonly T[]): T[] {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (occurrences.get(value.name) ?? 0) + 1;
    occurrences.set(value.name, occurrence);
    return occurrence === 1 ? value : { ...value, name: `${value.name} (${occurrence})` };
  });
}
