import { convertGoogleDocsDocument } from "../../../../../../app/features/google/docs-markdown.server";
import {
  type GoogleDocsDocument,
  getGoogleDocumentWithTabs,
} from "../../../../../../app/features/google/drive.server";
import { collectDocuments } from "../../../google-doc";
import { MARKDOWN_MEDIA_TYPE, PDF_MEDIA_TYPE, markdownBody } from "../../../media-type";
import type { CurrentSourceImport, SourceImportTickContext } from "../../run";
import { metaGet, metaNumber, metaSet } from "../../run";
import {
  DOC_MIME,
  SHEET_MIME,
  SLIDES_MIME,
  type SpreadsheetMetadata,
  fileId,
  insertUnit,
  requireToken,
  spreadsheetUnitDescriptors,
  stagedUnitKey,
} from "../drive-import-shared";

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

export async function stepEnumerate(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  const mimeType = metaGet(ctx.sql, "drive_mime_type");
  if (mimeType === DOC_MIME) return enumerateDoc(ctx, current);
  if (mimeType === SHEET_MIME) return enumerateSheets(ctx, current);
  if (mimeType === SLIDES_MIME) return enumerateSlides(ctx, current);
  throw new Error(`Unsupported Google Drive MIME type: ${mimeType}`);
}
