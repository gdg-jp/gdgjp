/**
 * Google Drive file export (PDF / text), the Docs document reader, and Drive
 * file-metadata helpers. OAuth (scopes, consent URL, token exchange) lives in
 * `drive-oauth.server.ts` and is re-exported here for back-compat.
 */
import { fetchWithTimeout } from "./drive-fetch.server";

export type { DriveToken } from "./drive-oauth.server";
export {
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_CHAT_SPACES_SCOPE,
  GOOGLE_CHAT_MESSAGES_SCOPE,
  GOOGLE_OAUTH_SCOPES,
  REQUIRED_GOOGLE_CHAT_SCOPES,
  GOOGLE_DRIVE_REAUTH_MESSAGE,
  hasRequiredGoogleChatScopes,
  getGoogleDriveAuthUrl,
  exchangeCodeForToken,
  refreshAccessToken,
} from "./drive-oauth.server";

const EXPORT_TIMEOUT_MS = 30_000;
const DOCUMENTS_TIMEOUT_MS = 30_000;
const DRIVE_METADATA_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Google Drive file export as PDF
// ---------------------------------------------------------------------------

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
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

// ---------------------------------------------------------------------------
// Google Drive file export as plain text (for inline content in prompts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Google Docs tab-aware document retrieval
// ---------------------------------------------------------------------------

/**
 * The subset of the Google Docs API shape that the ingestion workspace needs.
 *
 * Keep this as a structural type instead of importing a Node Google API client:
 * Workers already provide `fetch`, and the result is later transformed into a
 * lazy, read-only workspace tree. In particular, callers must not concatenate
 * all tab contents into one prompt string.
 */
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
  /** Legacy single-tab link fields. */
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
  /** A Google Docs people smart chip. */
  person?: {
    textStyle?: GoogleDocsTextRun["textStyle"];
    personProperties?: { name?: string; email?: string };
  };
  /** A Google Docs resource smart chip, such as a Calendar event or Drive file. */
  richLink?: {
    textStyle?: GoogleDocsTextRun["textStyle"];
    richLinkProperties?: { title?: string; uri?: string };
  };
  /** A Google Docs date smart chip. `displayText` preserves the document locale and format. */
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
  /** Present for legacy single-tab documents. */
  body?: { content?: GoogleDocsStructuralElement[] };
  headers?: GoogleDocsDocumentTab["headers"];
  footers?: GoogleDocsDocumentTab["footers"];
  footnotes?: GoogleDocsDocumentTab["footnotes"];
  /** Present with `includeTabsContent=true`. */
  tabs?: GoogleDocsTab[];
  lists?: GoogleDocsDocumentTab["lists"];
  inlineObjects?: GoogleDocsDocumentTab["inlineObjects"];
  positionedObjects?: GoogleDocsDocumentTab["positionedObjects"];
}

/**
 * Retrieves one Google Doc with its tab tree and each tab's own body.
 * `drive.readonly`, already requested by this app, authorizes this endpoint.
 */
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

// ---------------------------------------------------------------------------
// Get file display name from Drive metadata
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drive v3 files.get URL builder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Extract file ID from Google Drive URL
// ---------------------------------------------------------------------------

export function extractFileId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Could not extract file ID from URL: ${url}`);
  return match[1];
}
