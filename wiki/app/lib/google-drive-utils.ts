/**
 * Shared (client + server) Google Drive URL validation.
 */

const GOOGLE_DRIVE_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/(document|presentation|spreadsheets)\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_SHEETS_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_DOCS_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/document\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_SLIDES_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/presentation\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

export type GoogleDriveDocumentKind = "document" | "presentation" | "spreadsheet";

export function isGoogleDriveUrl(url: string): boolean {
  return GOOGLE_DRIVE_URL_RE.test(url);
}

export function isGoogleSheetsUrl(url: string): boolean {
  return GOOGLE_SHEETS_URL_RE.test(url);
}

/** Identifies the Google Workspace resource API required for a supported URL. */
export function getGoogleDriveDocumentKind(url: string): GoogleDriveDocumentKind | null {
  if (GOOGLE_DOCS_URL_RE.test(url)) return "document";
  if (GOOGLE_SLIDES_URL_RE.test(url)) return "presentation";
  if (GOOGLE_SHEETS_URL_RE.test(url)) return "spreadsheet";
  return null;
}
