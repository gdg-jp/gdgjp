export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export class InvalidPdfExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPdfExportError";
  }
}

export class PdfExportHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "PdfExportHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.ceil(asSeconds * 1000);
  const asDate = Date.parse(header);
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, asDate - Date.now());
}

function responseStatusError(response: Response, body: string): PdfExportHttpError {
  const redirectedToLogin = response.url.includes("accounts.google.com");
  const suffix = body.trim().slice(0, 500);
  const message = `Google Drive PDF export failed (${response.status})${redirectedToLogin ? ": redirected to Google sign-in" : suffix ? `: ${suffix}` : ""}`;
  return new PdfExportHttpError(
    response.status,
    message,
    parseRetryAfterMs(response.headers.get("retry-after")),
  );
}

export async function validatedPdfBody(
  response: Response,
  maxBytes: number = MAX_PDF_BYTES,
): Promise<Uint8Array> {
  if (!response.ok || response.url.includes("accounts.google.com")) {
    throw responseStatusError(response, await response.text());
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf") {
    throw new InvalidPdfExportError(`expected application/pdf, received ${contentType || "none"}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new InvalidPdfExportError(`PDF exceeds ${maxBytes} bytes`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxBytes) throw new InvalidPdfExportError(`PDF exceeds ${maxBytes} bytes`);
  if (
    body.byteLength < 5 ||
    body[0] !== 0x25 ||
    body[1] !== 0x50 ||
    body[2] !== 0x44 ||
    body[3] !== 0x46 ||
    body[4] !== 0x2d
  ) {
    throw new InvalidPdfExportError("response does not begin with %PDF-");
  }
  return body;
}

export function spreadsheetSheetPdfUrl(fileId: string, gid: string): string {
  const query = new URLSearchParams({
    format: "pdf",
    gid,
    size: "A4",
    portrait: "false",
    fitw: "true",
    gridlines: "true",
    sheetnames: "false",
    printtitle: "false",
  });
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/export?${query}`;
}

export async function fetchValidatedPdf(url: string, accessToken: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });
  return validatedPdfBody(response);
}
