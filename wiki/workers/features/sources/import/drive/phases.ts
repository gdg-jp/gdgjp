import { and, eq } from "drizzle-orm";
import * as schema from "../../../../../app/db/schema";
import { convertGoogleDocsDocument } from "../../../../../app/lib/google-docs-markdown.server";
import {
  GOOGLE_DRIVE_REAUTH_MESSAGE,
  type GoogleDocsDocument,
  driveFilesUrl,
  extractFileId,
  getGoogleDocumentWithTabs,
} from "../../../../../app/lib/google-drive.server";
import { googleDocsPathSegment } from "../../../ingestion/tools/google-docs/workspace";
import { type ResolvedSourceAsset, assetR2Key } from "../../assets";
import { collectDocuments, withUniqueNames } from "../../google-doc";
import { MARKDOWN_MEDIA_TYPE, PDF_MEDIA_TYPE, markdownBody } from "../../media-type";
import { persistSourceDocument, sha256Hex } from "../../persist";
import { ATTACHMENT_PARALLELISM } from "../../subrequest-budget";
import { archiveMissingDocuments } from "../archive";
import {
  ARCHIVE_MISSING_SUBREQUESTS,
  type CurrentSourceImport,
  PERSIST_REPLACE_SUBREQUESTS,
  type SourceImportStepOutcome,
  type SourceImportTickContext,
  metaGet,
  metaNumber,
  metaSet,
} from "../run";
import type { ImportKindDriver } from "../tick";
import {
  InvalidPdfExportError,
  PdfExportHttpError,
  fetchValidatedPdf,
  spreadsheetSheetPdfUrl,
} from "./pdf";
import { sheetRange, sheetValuesToMarkdown } from "./sheets";

const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const SLIDES_MIME = "application/vnd.google-apps.presentation";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Unofficial per-gid sheet PDF exports are rate-limited; retry before giving up. */
export const MAX_SHEET_PDF_ATTEMPTS = 5;
const SHEET_PDF_BACKOFF_BASE_MS = 15_000;
const SHEET_PDF_BACKOFF_CAP_MS = 120_000;

export const DRIVE_PHASES = [
  "metadata",
  "enumerate",
  "content",
  "assets",
  "rewrite",
  "finalizing",
] as const;
export type DriveImportPhase = (typeof DRIVE_PHASES)[number];

export type DriveUnitKind = "doc-tab" | "sheet-md" | "sheet-pdf" | "slides-md" | "file-pdf";
interface DriveUnit {
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

function stagedUnitKey(sourceId: string, runId: string, id: number, extension: string): string {
  return `raw/${sourceId}/import-runs/${runId}/units/${id}.${extension}`;
}

function requireToken(ctx: SourceImportTickContext): string {
  if (!ctx.accessToken) throw new Error("Drive import tick is missing an access token");
  return ctx.accessToken;
}

function fileId(current: CurrentSourceImport): string {
  return current.source.externalId || extractFileId(current.source.url);
}

export function driveMetadataUrl(id: string): string {
  return driveFilesUrl(id, { fields: "name,mimeType" });
}

function expectedKind(mimeType: string): string {
  if (mimeType === DOC_MIME) return "google-doc";
  if (mimeType === SHEET_MIME) return "google-sheet";
  if (mimeType === SLIDES_MIME) return "google-slides";
  throw new Error(`Unsupported Google Drive MIME type: ${mimeType}`);
}

async function stepMetadata(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<{ phaseComplete: boolean }> {
  if (metaGet(ctx.sql, "drive_mime_type")) return { phaseComplete: true };
  if (!ctx.budget.canSpend(2)) return { phaseComplete: false };
  ctx.budget.spend(1);
  const response = await fetch(driveMetadataUrl(fileId(current)), {
    headers: { Authorization: `Bearer ${requireToken(ctx)}` },
  });
  if (!response.ok) {
    throw new Error(
      `Google Drive file metadata failed (${response.status}): ${await response.text()}`,
    );
  }
  const metadata = (await response.json()) as { name?: string; mimeType?: string };
  const mimeType = metadata.mimeType || "";
  const kind = expectedKind(mimeType);
  const title = metadata.name?.trim() || current.source.title;

  if (title !== current.source.title || kind !== current.source.kind) {
    ctx.budget.spend(1);
    await current.db
      .update(schema.sources)
      .set({ title, kind, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sources.id, current.source.id),
          eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
        ),
      );
    current.source.title = title;
    current.source.kind = kind;
  }
  metaSet(ctx.sql, "drive_file_id", fileId(current));
  metaSet(ctx.sql, "drive_mime_type", mimeType);
  metaSet(ctx.sql, "drive_title", title);
  return { phaseComplete: true };
}

function insertUnit(
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

async function enumerateDoc(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<{ phaseComplete: boolean }> {
  let jsonKey = metaGet(ctx.sql, "drive_source_json_key");
  if (!jsonKey) {
    if (!ctx.budget.canSpend(2)) return { phaseComplete: false };
    ctx.budget.spend(1);
    const document = await getGoogleDocumentWithTabs(fileId(current), requireToken(ctx));
    jsonKey = `raw/${current.source.id}/import-runs/${ctx.runId}/source.json`;
    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(jsonKey, JSON.stringify(document), {
      httpMetadata: { contentType: "application/json" },
    });
    metaSet(ctx.sql, "drive_source_json_key", jsonKey);
  }
  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
  ctx.budget.spend(1);
  const object = await ctx.env.BUCKET.get(jsonKey);
  if (!object) throw new Error("Staged Google Docs document is missing");
  const document = (await object.json()) as GoogleDocsDocument;
  const documents = collectDocuments(convertGoogleDocsDocument(document));
  let index = metaNumber(ctx.sql, "drive_enumerate_index");
  while (index < documents.length && ctx.budget.canSpend(1)) {
    const item = documents[index];
    if (!item) break;
    const id = insertUnit(ctx.sql, {
      unit_kind: "doc-tab",
      path: `${item.path}.md`,
      title: item.title,
      gid: null,
      media_type: MARKDOWN_MEDIA_TYPE,
      sort_index: index,
      status: item.images.length ? "content" : "ready",
    });
    const bodyKey = stagedUnitKey(current.source.id, ctx.runId, id, "md");
    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(bodyKey, markdownBody(item.markdown), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    ctx.sql.exec("UPDATE drive_units SET body_r2_key = ? WHERE id = ?", bodyKey, id);
    for (const image of item.images) {
      ctx.sql.exec(
        `INSERT OR IGNORE INTO drive_images
          (unit_id, object_id, source_url, content_type) VALUES (?, ?, ?, ?)`,
        id,
        image.objectId,
        image.sourceUrl,
        image.contentType ?? null,
      );
    }
    index += 1;
    metaSet(ctx.sql, "drive_enumerate_index", String(index));
  }
  return { phaseComplete: index >= documents.length };
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

async function enumerateSheets(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<{ phaseComplete: boolean }> {
  if (metaGet(ctx.sql, "drive_enumerated") === "1") return { phaseComplete: true };
  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
  const params = new URLSearchParams({
    fields:
      "properties.title,sheets.properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount))",
  });
  ctx.budget.spend(1);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId(current))}?${params}`,
    { headers: { Authorization: `Bearer ${requireToken(ctx)}` } },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets metadata failed (${response.status}): ${await response.text()}`);
  }
  const metadata = (await response.json()) as SpreadsheetMetadata;
  for (const unit of spreadsheetUnitDescriptors(metadata)) {
    insertUnit(ctx.sql, {
      unit_kind: unit.unitKind,
      path: unit.path,
      title: unit.title,
      gid: unit.gid,
      media_type: unit.mediaType,
      sort_index: unit.sortIndex,
    });
  }
  metaSet(ctx.sql, "drive_enumerated", "1");
  return { phaseComplete: true };
}

function enumerateSlides(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  if (metaGet(ctx.sql, "drive_enumerated") !== "1") {
    insertUnit(ctx.sql, {
      unit_kind: "slides-md",
      path: "index.md",
      title: current.source.title,
      gid: null,
      media_type: MARKDOWN_MEDIA_TYPE,
      sort_index: 0,
    });
    insertUnit(ctx.sql, {
      unit_kind: "file-pdf",
      path: "index.pdf",
      title: current.source.title,
      gid: null,
      media_type: PDF_MEDIA_TYPE,
      sort_index: 1,
    });
    metaSet(ctx.sql, "drive_enumerated", "1");
  }
  return { phaseComplete: true };
}

async function stepEnumerate(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  const mimeType = metaGet(ctx.sql, "drive_mime_type");
  if (mimeType === DOC_MIME) return enumerateDoc(ctx, current);
  if (mimeType === SHEET_MIME) return enumerateSheets(ctx, current);
  if (mimeType === SLIDES_MIME) return enumerateSlides(ctx, current);
  throw new Error(`Unsupported Google Drive MIME type: ${mimeType}`);
}

function pendingUnits(sql: SqlStorage, kind?: DriveUnitKind, limit = 100): DriveUnit[] {
  return sql
    .exec<DriveUnit>(
      `SELECT * FROM drive_units WHERE status = 'pending' ${kind ? "AND unit_kind = ?" : ""}
       ORDER BY sort_index LIMIT ?`,
      ...(kind ? [kind, limit] : [limit]),
    )
    .toArray();
}

async function stageBody(
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

async function contentSheetMarkdown(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  const capacity = Math.min(10, Math.max(0, ctx.budget.remaining() - 1));
  if (capacity === 0) return false;
  const units = pendingUnits(ctx.sql, "sheet-md", capacity);
  if (!units.length) return true;
  const params = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  for (const unit of units) params.append("ranges", sheetRange(unit.title));
  ctx.budget.spend(1);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId(current))}/values:batchGet?${params}`,
    { headers: { Authorization: `Bearer ${requireToken(ctx)}` } },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets values failed (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    valueRanges?: Array<{ values?: unknown[][] }>;
  };
  for (const [index, unit] of units.entries()) {
    const result = sheetValuesToMarkdown(unit.title, payload.valueRanges?.[index]?.values ?? []);
    await stageBody(ctx, current, unit, markdownBody(result.markdown));
  }
  return pendingUnits(ctx.sql, "sheet-md", 1).length === 0;
}

type ContentPdfResult = { deferredMs?: number };

function skipSheetPdf(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  unit: DriveUnit,
  error: Error,
): void {
  ctx.sql.exec("UPDATE drive_units SET status = 'skipped' WHERE id = ?", unit.id);
  console.warn(
    JSON.stringify({
      component: "sources",
      integration: "google-drive",
      event: "pdf_export_skipped",
      sourceId: current.source.id,
      path: unit.path,
      error: error.message,
    }),
  );
}

async function contentPdf(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  unit: DriveUnit,
): Promise<ContentPdfResult> {
  const url =
    unit.unit_kind === "sheet-pdf"
      ? spreadsheetSheetPdfUrl(fileId(current), unit.gid || "0")
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId(current))}/export?mimeType=application%2Fpdf`;
  ctx.budget.spend(1);
  try {
    const body = await fetchValidatedPdf(url, requireToken(ctx));
    await stageBody(ctx, current, unit, body);
    return {};
  } catch (error) {
    if (isSkippablePdfExport(unit.unit_kind, error)) {
      skipSheetPdf(ctx, current, unit, error);
      return {};
    }
    if (
      unit.unit_kind === "sheet-pdf" &&
      error instanceof PdfExportHttpError &&
      (error.status === 429 || error.status === 503)
    ) {
      const attemptKey = `sheet_pdf_attempts_${unit.id}`;
      const attempt = metaNumber(ctx.sql, attemptKey) + 1;
      metaSet(ctx.sql, attemptKey, String(attempt));
      if (attempt >= MAX_SHEET_PDF_ATTEMPTS) {
        skipSheetPdf(ctx, current, unit, error);
        return {};
      }
      const deferredMs = sheetPdfRetryDelayMs(attempt, error.retryAfterMs);
      console.warn(
        JSON.stringify({
          component: "sources",
          integration: "google-drive",
          event: "pdf_export_deferred",
          sourceId: current.source.id,
          path: unit.path,
          attempt,
          deferredMs,
          error: error.message,
        }),
      );
      return { deferredMs };
    }
    throw error;
  }
}

export function isSkippablePdfExport(
  unitKind: DriveUnitKind,
  error: unknown,
): error is InvalidPdfExportError {
  return unitKind === "sheet-pdf" && error instanceof InvalidPdfExportError;
}

async function contentSlidesMarkdown(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  unit: DriveUnit,
): Promise<void> {
  ctx.budget.spend(1);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId(current))}/export?mimeType=text%2Fplain`,
    { headers: { Authorization: `Bearer ${requireToken(ctx)}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Google Drive text export failed (${response.status}): ${await response.text()}`,
    );
  }
  await stageBody(ctx, current, unit, markdownBody(await response.text()));
}

async function stepContent(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
): Promise<SourceImportStepOutcome> {
  if (!(await contentSheetMarkdown(ctx, current))) return { phaseComplete: false };
  while (ctx.budget.canSpend(2)) {
    const unit = pendingUnits(ctx.sql, undefined, 1)[0];
    if (!unit) return { phaseComplete: true };
    if (unit.unit_kind === "sheet-pdf" || unit.unit_kind === "file-pdf") {
      const result = await contentPdf(ctx, current, unit);
      if (result.deferredMs != null) {
        // Stop hammering the unofficial export endpoint; wait before retrying.
        return { phaseComplete: false, continueAfterMs: result.deferredMs };
      }
    } else if (unit.unit_kind === "slides-md") {
      await contentSlidesMarkdown(ctx, current, unit);
    } else {
      throw new Error(`Unexpected pending Drive unit: ${unit.unit_kind}`);
    }
  }
  return { phaseComplete: pendingUnits(ctx.sql, undefined, 1).length === 0 };
}

interface DriveImage {
  [key: string]: SqlStorageValue;
  id: number;
  unit_id: number;
  object_id: string;
  source_url: string;
  content_type: string | null;
}

async function downloadImage(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  image: DriveImage,
): Promise<{ status: "ready" | "missing"; asset?: ResolvedSourceAsset }> {
  const response = await fetch(image.source_url, {
    headers: { Authorization: `Bearer ${requireToken(ctx)}` },
  });
  if (response.status === 404) return { status: "missing" };
  if (!response.ok) throw new Error(`Google Docs image download failed (${response.status})`);
  const mimeType =
    response.headers.get("content-type")?.split(";", 1)[0] || image.content_type || "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error("Google Docs returned an invalid image type");
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_IMAGE_BYTES) throw new Error("A Google Docs image exceeds 10 MB");
  const contentHash = await sha256Hex(body);
  const r2Key = assetR2Key(current.source.id, image.object_id, contentHash, mimeType);
  await ctx.env.BUCKET.put(r2Key, body, { httpMetadata: { contentType: mimeType } });
  return {
    status: "ready",
    asset: {
      path: r2Key,
      r2Key,
      mimeType,
      byteSize: body.byteLength,
      contentHash,
    },
  };
}

async function stepAssets(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  const count = Math.min(ATTACHMENT_PARALLELISM, Math.floor(ctx.budget.remaining() / 2));
  if (count === 0) return { phaseComplete: false };
  const images = ctx.sql
    .exec<DriveImage>(
      "SELECT id, unit_id, object_id, source_url, content_type FROM drive_images WHERE status = 'pending' ORDER BY id LIMIT ?",
      count,
    )
    .toArray();
  if (!images.length) return { phaseComplete: true };
  ctx.budget.spend(images.length * 2);
  const results = await Promise.all(images.map((image) => downloadImage(ctx, current, image)));
  for (const [index, result] of results.entries()) {
    const image = images[index];
    if (!image) continue;
    ctx.sql.exec(
      "UPDATE drive_images SET status = ?, asset_json = ? WHERE id = ?",
      result.status,
      result.asset ? JSON.stringify(result.asset) : null,
      image.id,
    );
  }
  return {
    phaseComplete:
      ctx.sql.exec("SELECT id FROM drive_images WHERE status = 'pending' LIMIT 1").toArray()
        .length === 0,
  };
}

function removePlaceholder(markdown: string, objectId: string): string {
  const escaped = objectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(`!\\[(?:\\\\.|[^\\]])*\\]\\(attachment:${escaped}\\)`, "g"),
    "",
  );
}

async function stepRewrite(ctx: SourceImportTickContext) {
  while (ctx.budget.canSpend(2)) {
    const unit = ctx.sql
      .exec<DriveUnit>(
        "SELECT * FROM drive_units WHERE status = 'content' ORDER BY sort_index LIMIT 1",
      )
      .toArray()[0];
    if (!unit) return { phaseComplete: true };
    if (!unit.body_r2_key) throw new Error(`Drive unit ${unit.id} has no staged body`);
    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(unit.body_r2_key);
    if (!object) throw new Error(`Staged Drive unit ${unit.id} is missing`);
    let markdown = await object.text();
    const images = ctx.sql
      .exec<{ object_id: string; status: string; asset_json: string | null }>(
        "SELECT object_id, status, asset_json FROM drive_images WHERE unit_id = ? ORDER BY id",
        unit.id,
      )
      .toArray();
    for (const image of images) {
      if (image.status === "ready" && image.asset_json) {
        const asset = JSON.parse(image.asset_json) as ResolvedSourceAsset;
        markdown = markdown.replaceAll(`attachment:${image.object_id}`, asset.path);
      } else {
        markdown = removePlaceholder(markdown, image.object_id);
      }
    }
    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(unit.body_r2_key, markdownBody(markdown), {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    ctx.sql.exec("UPDATE drive_units SET status = 'ready' WHERE id = ?", unit.id);
  }
  return { phaseComplete: false };
}

async function stepFinalizing(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  let index = metaNumber(ctx.sql, "drive_finalize_index");
  const units = ctx.sql
    .exec<DriveUnit>("SELECT * FROM drive_units WHERE status = 'ready' ORDER BY sort_index")
    .toArray();
  while (index < units.length && ctx.budget.canSpend(1 + PERSIST_REPLACE_SUBREQUESTS)) {
    const unit = units[index];
    if (!unit?.body_r2_key) throw new Error(`Drive unit ${unit?.id ?? index} has no staged body`);
    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(unit.body_r2_key);
    if (!object) throw new Error(`Staged Drive unit ${unit.id} is missing`);
    const assets = ctx.sql
      .exec<{ asset_json: string }>(
        "SELECT asset_json FROM drive_images WHERE unit_id = ? AND status = 'ready'",
        unit.id,
      )
      .toArray()
      .map((row) => JSON.parse(row.asset_json) as ResolvedSourceAsset);
    ctx.budget.spend(PERSIST_REPLACE_SUBREQUESTS);
    const persisted = await persistSourceDocument(ctx.env, {
      sourceId: current.source.id,
      fetchAttemptId: current.run.fetchAttemptId,
      path: unit.path,
      title: unit.title,
      body: new Uint8Array(await object.arrayBuffer()),
      mediaType: unit.media_type,
      assets,
      assetPolicy: "replace",
    });
    if (persisted.skipped) return { phaseComplete: false };
    index += 1;
    metaSet(ctx.sql, "drive_finalize_index", String(index));
  }
  // The tick engine calls complete immediately after the last phase. Reserve its
  // reconciliation + final D1 mutations instead of crossing the soft limit.
  return {
    phaseComplete: index >= units.length && ctx.budget.canSpend(ARCHIVE_MISSING_SUBREQUESTS + 2),
  };
}

async function completeDriveImport(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  const paths = ctx.sql
    .exec<{ path: string }>(
      "SELECT path FROM drive_units WHERE status = 'ready' ORDER BY sort_index",
    )
    .toArray()
    .map((row) => row.path);
  ctx.budget.spend(ARCHIVE_MISSING_SUBREQUESTS);
  if (
    !(await archiveMissingDocuments(
      current.db,
      current.source.id,
      current.run.fetchAttemptId,
      paths,
    ))
  ) {
    return;
  }
  ctx.budget.spend(2);
  await current.db.batch([
    current.db
      .update(schema.sources)
      .set({
        status: "ready",
        fetchAttemptId: null,
        errorMessage: null,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.sources.id, current.source.id),
          eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
        ),
      ),
    current.db
      .update(schema.sourceImportRuns)
      .set({ phase: "complete", updatedAt: new Date() })
      .where(eq(schema.sourceImportRuns.id, ctx.runId)),
  ]);

  const stagedKeys = ctx.sql
    .exec<{ body_r2_key: string }>(
      "SELECT body_r2_key FROM drive_units WHERE body_r2_key IS NOT NULL",
    )
    .toArray()
    .map((row) => row.body_r2_key);
  const sourceJsonKey = metaGet(ctx.sql, "drive_source_json_key");
  if (sourceJsonKey) stagedKeys.push(sourceJsonKey);
  for (const key of new Set(stagedKeys)) {
    if (!ctx.budget.canSpend(1)) break;
    ctx.budget.spend(1);
    try {
      await ctx.env.BUCKET.delete(key);
    } catch (error) {
      console.warn("[sources] unable to delete Drive import staging object", key, error);
      break;
    }
  }
}

export const driveImportDriver: ImportKindDriver<DriveImportPhase> = {
  kind: "google-drive" as const,
  phases: DRIVE_PHASES,
  needsAccessToken: true,
  requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"] as const,
  authorizationErrorMessage: GOOGLE_DRIVE_REAUTH_MESSAGE,
  async step(phase: DriveImportPhase, ctx: SourceImportTickContext, current: CurrentSourceImport) {
    if (phase === "metadata") return stepMetadata(ctx, current);
    if (phase === "enumerate") return stepEnumerate(ctx, current);
    if (phase === "content") return stepContent(ctx, current);
    if (phase === "assets") return stepAssets(ctx, current);
    if (phase === "rewrite") return stepRewrite(ctx);
    return stepFinalizing(ctx, current);
  },
  complete: completeDriveImport,
};
