import { driveFilesUrl, extractFileId } from "../../../../../app/features/google/drive.server";
import { googleDocsPathSegment } from "../../../ingestion/tools/google-docs/workspace";
import { withUniqueNames } from "../../google-doc";
import { MARKDOWN_MEDIA_TYPE, PDF_MEDIA_TYPE } from "../../media-type";
import type { CurrentSourceImport, SourceImportTickContext } from "../run";
import { InvalidPdfExportError } from "./pdf";

export const DOC_MIME = "application/vnd.google-apps.document";
export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Unofficial per-gid sheet PDF exports are rate-limited; retry before giving up. */
export const MAX_SHEET_PDF_ATTEMPTS = 5;
const SHEET_PDF_BACKOFF_BASE_MS = 15_000;
const SHEET_PDF_BACKOFF_CAP_MS = 120_000;

export type DriveUnitKind = "doc-tab" | "sheet-md" | "sheet-pdf" | "slides-md" | "file-pdf";
export interface DriveUnit {
  [key: string]: SqlStorageValue;
  id: number;
  unit_kind: DriveUnitKind;
  path: string;
  title: string;
  gid: string | null;
  media_type: string;
  body_r2_key: string | null;
  status: string;
  sort_index: number;
}

export interface DriveImage {
  [key: string]: SqlStorageValue;
  id: number;
  unit_id: number;
  object_id: string;
  source_url: string;
  content_type: string | null;
}

export type ContentPdfResult = { deferredMs?: number };

export function stagedUnitKey(
  sourceId: string,
  runId: string,
  id: number,
  extension: string,
): string {
  return `raw/${sourceId}/import-runs/${runId}/units/${id}.${extension}`;
}

export function requireToken(ctx: SourceImportTickContext): string {
  if (!ctx.accessToken) throw new Error("Drive import tick is missing an access token");
  return ctx.accessToken;
}

export function fileId(current: CurrentSourceImport): string {
  return current.source.externalId || extractFileId(current.source.url);
}

export function driveMetadataUrl(id: string): string {
  return driveFilesUrl(id, { fields: "name,mimeType" });
}

export function expectedKind(mimeType: string): string {
  if (mimeType === DOC_MIME) return "google-doc";
  if (mimeType === SHEET_MIME) return "google-sheet";
  if (mimeType === SLIDES_MIME) return "google-slides";
  throw new Error(`Unsupported Google Drive MIME type: ${mimeType}`);
}

export function insertUnit(
  sql: SqlStorage,
  unit: Omit<DriveUnit, "id" | "body_r2_key" | "status"> & {
    bodyR2Key?: string | null;
    status?: string;
  },
): number {
  sql.exec(
    `INSERT OR IGNORE INTO drive_units
      (unit_kind, path, title, gid, media_type, body_r2_key, status, sort_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    unit.unit_kind,
    unit.path,
    unit.title,
    unit.gid,
    unit.media_type,
    unit.bodyR2Key ?? null,
    unit.status ?? "pending",
    unit.sort_index,
  );
  const row = sql
    .exec<{ id: number }>("SELECT id FROM drive_units WHERE sort_index = ?", unit.sort_index)
    .toArray()[0];
  if (!row) throw new Error("Unable to create Drive import unit");
  return row.id;
}

export function pendingUnits(sql: SqlStorage, kind?: DriveUnitKind, limit = 100): DriveUnit[] {
  return sql
    .exec<DriveUnit>(
      `SELECT * FROM drive_units WHERE status = 'pending' ${kind ? "AND unit_kind = ?" : ""}
       ORDER BY sort_index LIMIT ?`,
      ...(kind ? [kind, limit] : [limit]),
    )
    .toArray();
}

export async function stageBody(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  unit: DriveUnit,
  body: Uint8Array,
): Promise<void> {
  const extension = unit.media_type === PDF_MEDIA_TYPE ? "pdf" : "md";
  const key = stagedUnitKey(current.source.id, ctx.runId, unit.id, extension);
  ctx.budget.spend(1);
  await ctx.env.BUCKET.put(key, body, { httpMetadata: { contentType: unit.media_type } });
  ctx.sql.exec(
    "UPDATE drive_units SET body_r2_key = ?, status = 'ready' WHERE id = ?",
    key,
    unit.id,
  );
}

export interface SpreadsheetMetadata {
  sheets?: Array<{
    properties?: { sheetId?: number; title?: string; index?: number; sheetType?: string };
  }>;
}

export interface SpreadsheetUnitDescriptor {
  unitKind: "sheet-md" | "sheet-pdf";
  path: string;
  title: string;
  gid: string;
  mediaType: string;
  sortIndex: number;
}

export function spreadsheetUnitDescriptors(
  metadata: SpreadsheetMetadata,
): SpreadsheetUnitDescriptor[] {
  const named = withUniqueNames(
    (metadata.sheets ?? [])
      .sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0))
      .map((sheet, index) => ({
        sheet,
        name: googleDocsPathSegment(sheet.properties?.title || "", `Sheet ${index + 1}`),
      })),
  );
  const units: SpreadsheetUnitDescriptor[] = [];
  for (const { sheet, name } of named) {
    const properties = sheet.properties;
    const title = properties?.title || name;
    const gid = String(properties?.sheetId ?? 0);
    if (properties?.sheetType === "GRID" || !properties?.sheetType) {
      units.push({
        unitKind: "sheet-md",
        path: `${name}.md`,
        title,
        gid,
        mediaType: MARKDOWN_MEDIA_TYPE,
        sortIndex: units.length,
      });
    }
    // Always attempt a PDF. GRID sheets also keep Markdown from the Values API;
    // OBJECT sheets (charts) only have the unofficial per-gid PDF export.
    units.push({
      unitKind: "sheet-pdf",
      path: `${name}.pdf`,
      title,
      gid,
      mediaType: PDF_MEDIA_TYPE,
      sortIndex: units.length,
    });
  }
  return units;
}

export function sheetPdfRetryDelayMs(attempt: number, retryAfterMs: number | null = null): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    return Math.min(SHEET_PDF_BACKOFF_CAP_MS, retryAfterMs);
  }
  return Math.min(
    SHEET_PDF_BACKOFF_CAP_MS,
    SHEET_PDF_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
}

export function isSkippablePdfExport(
  unitKind: DriveUnitKind,
  error: unknown,
): error is InvalidPdfExportError {
  return unitKind === "sheet-pdf" && error instanceof InvalidPdfExportError;
}
