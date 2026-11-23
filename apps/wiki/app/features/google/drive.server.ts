import { fetchWithTimeout } from "./drive-fetch.server";

const EXPORT_TIMEOUT_MS = 30_000;
const DOCUMENTS_TIMEOUT_MS = 30_000;
const DRIVE_METADATA_TIMEOUT_MS = 10_000;

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 50_000;

export interface ExportResult {
  buffer: ArrayBuffer;
  mimeType: string;
  warning?: string;
}

export async function exportFileAsPdf(fileId: string, accessToken: string): Promise<ExportResult> {
  const pdfUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`;

  const pdfResponse = await fetchWithTimeout(
    pdfUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    EXPORT_TIMEOUT_MS,
  );

  if (!pdfResponse.ok) {
    const err = await pdfResponse.text();
    throw new Error(`Google Drive PDF export failed (${pdfResponse.status}): ${err}`);
  }
  const contentType = pdfResponse.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/pdf") {
    throw new Error(`Google Drive PDF export returned ${contentType || "an unknown content type"}`);
  }
  const buffer = await pdfResponse.arrayBuffer();
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error(`Google Drive PDF export exceeds ${MAX_PDF_BYTES} bytes`);
  }
  const magic = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  if (magic.length < 5 || new TextDecoder().decode(magic) !== "%PDF-") {
    throw new Error("Google Drive PDF export returned invalid PDF bytes");
  }
  return { buffer, mimeType: "application/pdf" };
}

export async function exportFileAsText(
  fileId: string,
  accessToken: string,
  exportMimeType = "text/plain",
): Promise<string> {
  const textUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
  const response = await fetchWithTimeout(
    textUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    EXPORT_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Drive text export failed (${response.status}): ${err}`);
  }

  let text = await response.text();
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  return text;
}

export interface GoogleDocsDimension {
  magnitude?: number;
  unit?: "PT" | string;
}

export interface GoogleDocsColor {
  color?: { rgbColor?: { red?: number; green?: number; blue?: number } };
}

export interface GoogleDocsLink {
  url?: string;
  tabId?: string;
  bookmark?: { id?: string; tabId?: string };
  heading?: { id?: string; tabId?: string };
  bookmarkId?: string;
  headingId?: string;
}

export interface GoogleDocsTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  smallCaps?: boolean;
  foregroundColor?: GoogleDocsColor;
  backgroundColor?: GoogleDocsColor;
  fontSize?: GoogleDocsDimension;
  weightedFontFamily?: { fontFamily?: string; weight?: number };
  baselineOffset?: "SUPERSCRIPT" | "SUBSCRIPT" | "NONE" | string;
  link?: GoogleDocsLink;
}

export interface GoogleDocsTextRun {
  content?: string;
  textStyle?: GoogleDocsTextStyle;
}

export interface GoogleDocsParagraphElement {
  textRun?: GoogleDocsTextRun;
  autoText?: { type?: "PAGE_NUMBER" | "PAGE_COUNT" | string; textStyle?: GoogleDocsTextStyle };
  pageBreak?: { textStyle?: GoogleDocsTextStyle };
  columnBreak?: { textStyle?: GoogleDocsTextStyle };
  footnoteReference?: {
    footnoteId?: string;
    footnoteNumber?: string;
    textStyle?: GoogleDocsTextStyle;
  };
  horizontalRule?: { textStyle?: GoogleDocsTextStyle };
  equation?: Record<string, never>;
  inlineObjectElement?: { inlineObjectId?: string };
  person?: {
    textStyle?: GoogleDocsTextRun["textStyle"];
    personProperties?: { name?: string; email?: string };
  };
  richLink?: {
    textStyle?: GoogleDocsTextRun["textStyle"];
    richLinkProperties?: { title?: string; uri?: string };
  };
  dateElement?: {
    textStyle?: GoogleDocsTextRun["textStyle"];
    dateElementProperties?: { displayText?: string };
  };
}

export interface GoogleDocsStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: GoogleDocsParagraphElement[];
    positionedObjectIds?: string[];
    paragraphStyle?: {
      namedStyleType?: string;
      headingId?: string;
      alignment?: "START" | "CENTER" | "END" | "JUSTIFIED" | string;
      direction?: "LEFT_TO_RIGHT" | "RIGHT_TO_LEFT" | string;
      lineSpacing?: number;
      spaceAbove?: GoogleDocsDimension;
      spaceBelow?: GoogleDocsDimension;
      indentFirstLine?: GoogleDocsDimension;
      indentStart?: GoogleDocsDimension;
      indentEnd?: GoogleDocsDimension;
      shading?: { backgroundColor?: GoogleDocsColor };
      pageBreakBefore?: boolean;
    };
    bullet?: { listId?: string; nestingLevel?: number; textStyle?: GoogleDocsTextStyle };
  };
  sectionBreak?: {
    sectionStyle?: {
      sectionType?: string;
      columnProperties?: Array<{ width?: GoogleDocsDimension; paddingEnd?: GoogleDocsDimension }>;
      contentDirection?: string;
      defaultHeaderId?: string;
      defaultFooterId?: string;
      firstPageHeaderId?: string;
      firstPageFooterId?: string;
      evenPageHeaderId?: string;
      evenPageFooterId?: string;
      pageNumberStart?: number;
    };
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{ content?: GoogleDocsStructuralElement[] }>;
    }>;
  };
  tableOfContents?: { content?: GoogleDocsStructuralElement[] };
}

export interface GoogleDocsDocumentTab {
  body?: { content?: GoogleDocsStructuralElement[] };
  headers?: Record<string, { headerId?: string; content?: GoogleDocsStructuralElement[] }>;
  footers?: Record<string, { footerId?: string; content?: GoogleDocsStructuralElement[] }>;
  footnotes?: Record<string, { footnoteId?: string; content?: GoogleDocsStructuralElement[] }>;
  lists?: Record<
    string,
    {
      listProperties?: {
        nestingLevels?: Array<{ glyphType?: string; glyphFormat?: string; startNumber?: number }>;
      };
    }
  >;
  inlineObjects?: Record<
    string,
    {
      inlineObjectProperties?: {
        embeddedObject?: {
          title?: string;
          description?: string;
          imageProperties?: { contentUri?: string; contentType?: string; sourceUri?: string };
          linkedContentReference?: {
            sheetsChartReference?: { spreadsheetId?: string; chartId?: number };
          };
        };
      };
    }
  >;
  positionedObjects?: Record<
    string,
    {
      positionedObjectProperties?: {
        positioning?: {
          layout?: string;
          leftOffset?: GoogleDocsDimension;
          topOffset?: GoogleDocsDimension;
        };
        embeddedObject?: {
          title?: string;
          description?: string;
          imageProperties?: { contentUri?: string; contentType?: string; sourceUri?: string };
          linkedContentReference?: {
            sheetsChartReference?: { spreadsheetId?: string; chartId?: number };
          };
        };
      };
    }
  >;
}

export interface GoogleDocsTab {
  tabProperties?: {
    tabId?: string;
    title?: string;
    index?: number;
    nestingLevel?: number;
  };
  documentTab?: GoogleDocsDocumentTab;
  childTabs?: GoogleDocsTab[];
}

export interface GoogleDocsDocument {
  documentId: string;
  title?: string;
  body?: { content?: GoogleDocsStructuralElement[] };
  headers?: GoogleDocsDocumentTab["headers"];
  footers?: GoogleDocsDocumentTab["footers"];
  footnotes?: GoogleDocsDocumentTab["footnotes"];
  tabs?: GoogleDocsTab[];
  lists?: GoogleDocsDocumentTab["lists"];
  inlineObjects?: GoogleDocsDocumentTab["inlineObjects"];
  positionedObjects?: GoogleDocsDocumentTab["positionedObjects"];
}

export async function getGoogleDocumentWithTabs(
  fileId: string,
  accessToken: string,
): Promise<GoogleDocsDocument> {
  const params = new URLSearchParams({ includeTabsContent: "true" });
  const response = await fetchWithTimeout(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    DOCUMENTS_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Docs document retrieval failed (${response.status}): ${err}`);
  }
  return (await response.json()) as GoogleDocsDocument;
}

export async function getDriveFileName(fileId: string, accessToken: string): Promise<string> {
  const res = await fetchWithTimeout(
    driveFilesUrl(fileId, { fields: "name" }),
    { headers: { Authorization: `Bearer ${accessToken}` } },
    DRIVE_METADATA_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`Google Drive file metadata failed (${res.status})`);
  }
  const meta = (await res.json()) as { name?: string };
  return meta.name ?? fileId;
}

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

/**
 * Builds a Drive v3 `files.get` URL (metadata or `alt=media`).
 *
 * `supportsAllDrives=true` is mandatory and deliberately not caller-overridable: without it Drive
 * answers 404 "File not found" for every item in a shared drive, which is where this org keeps its
 * content. `files.export` is NOT gated by this flag — do not route export URLs through here. A future
 * `files.list` would additionally need `includeItemsFromAllDrives=true`.
 */
export function driveFilesUrl(fileId: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...params, supportsAllDrives: "true" });
  return `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${query}`;
}

export function extractFileId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Could not extract file ID from URL: ${url}`);
  return match[1];
}
