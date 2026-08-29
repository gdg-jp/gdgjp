import { markdownBody } from "../../../media-type";
import type {
  CurrentSourceImport,
  SourceImportStepOutcome,
  SourceImportTickContext,
} from "../../run";
import { metaNumber, metaSet } from "../../run";
import {
  type ContentPdfResult,
  type DriveUnit,
  MAX_SHEET_PDF_ATTEMPTS,
  fileId,
  isSkippablePdfExport,
  pendingUnits,
  requireToken,
  sheetPdfRetryDelayMs,
  stageBody,
} from "../drive-import-shared";
import { PdfExportHttpError, fetchValidatedPdf, spreadsheetSheetPdfUrl } from "../pdf";
import { sheetRange, sheetValuesToMarkdown } from "../sheets";

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

export async function stepContent(
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
