/**
 * Google Drive OAuth and export utilities.
 *
 * Scope: drive.readonly — used to export Google Docs / Slides as PDF.
 */

export interface DriveToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// OAuth URL generation
// ---------------------------------------------------------------------------

export function getGoogleDriveAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/forms.responses.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

const TOKEN_TIMEOUT_MS = 10_000;
const EXPORT_TIMEOUT_MS = 30_000;
const DOCUMENTS_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<DriveToken> {
  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
    TOKEN_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    },
    TOKEN_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---------------------------------------------------------------------------
// Google Drive file export as PDF (or plain text fallback)
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

  if (pdfResponse.ok) {
    const buffer = await pdfResponse.arrayBuffer();
    if (buffer.byteLength <= MAX_PDF_BYTES) {
      return { buffer, mimeType: "application/pdf" };
    }
    // PDF too large — fall back to text
  }

  // Fallback: plain text export
  const textUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
  const textResponse = await fetchWithTimeout(
    textUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    EXPORT_TIMEOUT_MS,
  );

  if (!textResponse.ok) {
    const err = await textResponse.text();
    throw new Error(`Google Drive export failed: ${textResponse.status} ${err}`);
  }

  let text = await textResponse.text();
  let warning: string | undefined;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warning = "ドキュメントが大きすぎるため、最初の50,000文字のみ使用されました。";
  }

  const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
  return {
    buffer,
    mimeType: "text/plain",
    warning:
      warning ?? "PDFのエクスポートに失敗したため、プレーンテキストにフォールバックしました。",
  };
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
export interface GoogleDocsTextRun {
  content?: string;
}

export interface GoogleDocsParagraphElement {
  textRun?: GoogleDocsTextRun;
}

export interface GoogleDocsStructuralElement {
  paragraph?: { elements?: GoogleDocsParagraphElement[] };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{ content?: GoogleDocsStructuralElement[] }>;
    }>;
  };
  tableOfContents?: { content?: GoogleDocsStructuralElement[] };
}

export interface GoogleDocsDocumentTab {
  body?: { content?: GoogleDocsStructuralElement[] };
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
  /** Present with `includeTabsContent=true`. */
  tabs?: GoogleDocsTab[];
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
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    TOKEN_TIMEOUT_MS,
  );
  if (!res.ok) return fileId;
  const meta = (await res.json()) as { name?: string };
  return meta.name ?? fileId;
}

// ---------------------------------------------------------------------------
// Extract file ID from Google Drive URL
// ---------------------------------------------------------------------------

export function extractFileId(url: string): string {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Could not extract file ID from URL: ${url}`);
  return match[1];
}
