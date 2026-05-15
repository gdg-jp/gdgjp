/**
 * Shared (client + server) Google Drive URL validation.
 */

const GOOGLE_DRIVE_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/(document|presentation|spreadsheets)\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

const GOOGLE_SHEETS_URL_RE =
  /^https:\/\/docs\.google\.com(?:\/u\/\d+)?\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)/;

export function isGoogleDriveUrl(url: string): boolean {
  return GOOGLE_DRIVE_URL_RE.test(url);
}

export function isGoogleSheetsUrl(url: string): boolean {
  return GOOGLE_SHEETS_URL_RE.test(url);
}
