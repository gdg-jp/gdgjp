import { convertGoogleDocsDocument } from "../../../../../../app/features/google/docs-markdown.server";
import {
  type GoogleDocsDocument,
  getGoogleDocumentWithTabs,
} from "../../../../../../app/features/google/drive.server";
import { collectDocuments } from "../../../google-doc";
import { MARKDOWN_MEDIA_TYPE, PDF_MEDIA_TYPE, markdownBody } from "../../../media-type";
import type { CurrentSourceImport, SourceImportTickContext } from "../../run";
import { metaGet } from "../../run";
import {
  DOC_MIME,
  type DriveFile,
  FILE_SORT_STRIDE,
  FOLDER_MIME,
  SHEET_MIME,
  SLIDES_MIME,
  type SpreadsheetMetadata,
  fileId,
  insertUnit,
  requireToken,
  spreadsheetUnitDescriptors,
  stagedUnitKey,
} from "../drive-import-shared";

type Outcome = { phaseComplete: boolean };

function sortIndex(file: DriveFile, index: number): number {
  return file.id * FILE_SORT_STRIDE + index;
}

async function enumerateDoc(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  file: DriveFile,
): Promise<Outcome> {
  let jsonKey = file.json_key;
  if (!jsonKey) {
    if (!ctx.budget.canSpend(2)) return { phaseComplete: false };
    ctx.budget.spend(1);
    const document = await getGoogleDocumentWithTabs(file.file_id, requireToken(ctx));
    jsonKey = `raw/${current.source.id}/import-runs/${ctx.runId}/files/${file.id}.json`;
    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(jsonKey, JSON.stringify(document), {
      httpMetadata: { contentType: "application/json" },
    });
    ctx.sql.exec("UPDATE drive_files SET json_key = ? WHERE id = ?", jsonKey, file.id);
  }
  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
  ctx.budget.spend(1);
  const object = await ctx.env.BUCKET.get(jsonKey);
  if (!object) throw new Error("Staged Google Docs document is missing");
  const document = (await object.json()) as GoogleDocsDocument;
  const documents = collectDocuments(convertGoogleDocsDocument(document));
  let index = file.enumerate_index;
  while (index < documents.length && ctx.budget.canSpend(1)) {
    const item = documents[index];
    if (!item) break;
    const id = insertUnit(ctx.sql, {
      unit_kind: "doc-tab",
      path: `${file.path_prefix}${item.path}.md`,
      title: item.title,
      gid: null,
      media_type: MARKDOWN_MEDIA_TYPE,
      sort_index: sortIndex(file, index),
      status: item.images.length ? "content" : "ready",
      fileId: file.file_id,
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
    ctx.sql.exec("UPDATE drive_files SET enumerate_index = ? WHERE id = ?", index, file.id);
  }
  return { phaseComplete: index >= documents.length };
}

async function enumerateSheets(ctx: SourceImportTickContext, file: DriveFile): Promise<Outcome> {
  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
  const params = new URLSearchParams({
    fields:
      "properties.title,sheets.properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount))",
  });
  ctx.budget.spend(1);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.file_id)}?${params}`,
    { headers: { Authorization: `Bearer ${requireToken(ctx)}` } },
  );
  if (!response.ok) {
    throw new Error(`Google Sheets metadata failed (${response.status}): ${await response.text()}`);
  }
  const metadata = (await response.json()) as SpreadsheetMetadata;
  for (const unit of spreadsheetUnitDescriptors(metadata)) {
    insertUnit(ctx.sql, {
      unit_kind: unit.unitKind,
      path: `${file.path_prefix}${unit.path}`,
      title: unit.title,
      gid: unit.gid,
      media_type: unit.mediaType,
      sort_index: sortIndex(file, unit.sortIndex),
      fileId: file.file_id,
    });
  }
  return { phaseComplete: true };
}

function enumerateSlides(ctx: SourceImportTickContext, file: DriveFile): Outcome {
  insertUnit(ctx.sql, {
    unit_kind: "slides-md",
    path: `${file.path_prefix}index.md`,
    title: file.title,
    gid: null,
    media_type: MARKDOWN_MEDIA_TYPE,
    sort_index: sortIndex(file, 0),
    fileId: file.file_id,
  });
  insertUnit(ctx.sql, {
    unit_kind: "file-pdf",
    path: `${file.path_prefix}index.pdf`,
    title: file.title,
    gid: null,
    media_type: PDF_MEDIA_TYPE,
    sort_index: sortIndex(file, 1),
    fileId: file.file_id,
  });
  return { phaseComplete: true };
}

function enumerateFile(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
  file: DriveFile,
): Promise<Outcome> | Outcome {
  if (file.mime_type === DOC_MIME) return enumerateDoc(ctx, current, file);
  if (file.mime_type === SHEET_MIME) return enumerateSheets(ctx, file);
  if (file.mime_type === SLIDES_MIME) return enumerateSlides(ctx, file);
  throw new Error(`Unsupported Google Drive MIME type: ${file.mime_type}`);
}

/** A single-file source imports just itself, at the source root (no path prefix). */
function ensureSourceFile(ctx: SourceImportTickContext, current: CurrentSourceImport): void {
  const mimeType = metaGet(ctx.sql, "drive_mime_type");
  if (!mimeType || mimeType === FOLDER_MIME) return;
  ctx.sql.exec(
    `INSERT OR IGNORE INTO drive_files (file_id, mime_type, title, path_prefix)
     VALUES (?, ?, ?, '')`,
    fileId(current),
    mimeType,
    metaGet(ctx.sql, "drive_title") || current.source.title,
  );
}

export async function stepEnumerate(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  ensureSourceFile(ctx, current);
  for (;;) {
    const file = ctx.sql
      .exec<DriveFile>("SELECT * FROM drive_files WHERE status = 'pending' ORDER BY id LIMIT 1")
      .toArray()[0];
    if (!file) return { phaseComplete: true };
    const outcome = await enumerateFile(ctx, current, file);
    if (!outcome.phaseComplete) return outcome;
    ctx.sql.exec("UPDATE drive_files SET status = 'done' WHERE id = ?", file.id);
  }
}
