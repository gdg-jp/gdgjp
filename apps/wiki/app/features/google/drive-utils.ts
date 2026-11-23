const GOOGLE_DRIVE_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/(document|presentation|spreadsheets)\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_SHEETS_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_DOCS_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/document\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_SLIDES_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/presentation\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_DRIVE_FOLDER_URL_RE =
  /^https:\/\/drive\.google\.com\/drive(?:\/u\/\d+)?\/folders\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/;

export function googleDriveFolderIdFromUrl(url: string): string | null {
  return url.match(GOOGLE_DRIVE_FOLDER_URL_RE)?.[1] ?? null;
}

export function googleDriveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export type GoogleDriveDocumentKind = "document" | "presentation" | "spreadsheet";

export function isGoogleDriveUrl(url: string): boolean {
  return GOOGLE_DRIVE_URL_RE.test(url);
}

export function isGoogleSheetsUrl(url: string): boolean {
  return GOOGLE_SHEETS_URL_RE.test(url);
}

export function getGoogleDriveDocumentKind(url: string): GoogleDriveDocumentKind | null {
  if (GOOGLE_DOCS_URL_RE.test(url)) return "document";
  if (GOOGLE_SLIDES_URL_RE.test(url)) return "presentation";
  if (GOOGLE_SHEETS_URL_RE.test(url)) return "spreadsheet";
  return null;
}
