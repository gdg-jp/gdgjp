import { type Asset, type AssetNotes, type AssetStatus, parseNotes } from "./asset";

type Row = {
  id: number;
  campaign_id: number;
  template_id: string;
  purpose: string;
  html: string | null;
  notes: string;
  slots: string;
  layout_vars: string;
  skin: string;
  width: number;
  height: number;
  scale: number;
  r2_key: string | null;
  r2_key_jpeg: string | null;
  img_id: string | null;
  img_url: string | null;
  checks: string;
  status: AssetStatus;
  error: string | null;
  for_draft_id: number | null;
  for_schedule_item_id: number | null;
  for_image_slot_id: string | null;
  derived_from_asset_id: number | null;
  job_id: string | null;
  author: Asset["author"];
  approved_by: string | null;
  created_at: number;
};

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const toAsset = (r: Row): Asset => ({
  id: r.id,
  campaignId: r.campaign_id,
  templateId: r.template_id,
  purpose: r.purpose === "kit" ? "kit" : "image",
  html: r.html,
  notes: parseNotes(r.notes),
  slots: json(r.slots, {}),
  layoutVars: json(r.layout_vars, {}),
  skin: json(r.skin, {}),
  width: r.width,
  height: r.height,
  scale: r.scale,
  r2Key: r.r2_key,
  r2KeyJpeg: r.r2_key_jpeg,
  imgId: r.img_id,
  imgUrl: r.img_url,
  checks: json(r.checks, []),
  status: r.status,
  error: r.error,
  forDraftId: r.for_draft_id,
  forScheduleItemId: r.for_schedule_item_id,
  forImageSlotId: r.for_image_slot_id,
  derivedFromAssetId: r.derived_from_asset_id,
  jobId: r.job_id,
  author: r.author,
  approvedBy: r.approved_by,
  createdAt: r.created_at,
});

export async function insertAsset(
  db: D1Database,
  a: Pick<
    Asset,
    "campaignId" | "templateId" | "slots" | "layoutVars" | "skin" | "width" | "height" | "author"
  > &
    Partial<
      Pick<
        Asset,
        | "purpose"
        | "html"
        | "forDraftId"
        | "forScheduleItemId"
        | "forImageSlotId"
        | "derivedFromAssetId"
        | "jobId"
      >
    > & {
      notes?: AssetNotes;
      playbookVersion: string;
    },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO assets (campaign_id, template_id, purpose, html, notes, slots, layout_vars, skin, width, height, author,
         for_draft_id, for_schedule_item_id, for_image_slot_id, derived_from_asset_id, job_id, playbook_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      a.campaignId,
      a.templateId,
      a.purpose ?? "image",
      a.html ?? null,
      JSON.stringify(a.notes ?? {}),
      JSON.stringify(a.slots),
      JSON.stringify(a.layoutVars),
      JSON.stringify(a.skin),
      a.width,
      a.height,
      a.author,
      a.forDraftId ?? null,
      a.forScheduleItemId ?? null,
      a.forImageSlotId ?? null,
      a.derivedFromAssetId ?? null,
      a.jobId ?? null,
      a.playbookVersion,
    )
    .first<{ id: number }>();
  if (!row) throw new Error("asset insert returned no id");
  return row.id;
}

export async function getAsset(
  db: D1Database,
  campaignId: number,
  id: number,
): Promise<Asset | null> {
  const row = await db
    .prepare("SELECT * FROM assets WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .first<Row>();
  return row ? toAsset(row) : null;
}

export async function listAssets(db: D1Database, campaignId: number): Promise<Asset[]> {
  const { results } = await db
    .prepare("SELECT * FROM assets WHERE campaign_id = ? ORDER BY id DESC LIMIT 200")
    .bind(campaignId)
    .all<Row>();
  return results.map(toAsset);
}

export async function assetsForItem(db: D1Database, itemId: number): Promise<Asset[]> {
  const { results } = await db
    .prepare("SELECT * FROM assets WHERE for_schedule_item_id = ? ORDER BY id DESC")
    .bind(itemId)
    .all<Row>();
  return results.map(toAsset);
}

export async function finishRender(
  db: D1Database,
  id: number,
  r: {
    r2Key: string | null;
    r2KeyJpeg: string | null;
    checks: unknown[];
    status: AssetStatus;
    error: string | null;
    notes?: AssetNotes;
  },
) {
  await db
    .prepare(
      "UPDATE assets SET r2_key = ?, r2_key_jpeg = ?, checks = ?, status = ?, error = ?, notes = COALESCE(?, notes) WHERE id = ?",
    )
    .bind(
      r.r2Key,
      r.r2KeyJpeg,
      JSON.stringify(r.checks),
      r.status,
      r.error,
      r.notes ? JSON.stringify(r.notes) : null,
      id,
    )
    .run();
}

/** Compare-and-set, so a double click approves (and uploads) once. */
export async function moveAsset(
  db: D1Database,
  id: number,
  from: AssetStatus[],
  to: AssetStatus,
  by?: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE assets SET status = ?, approved_by = COALESCE(?, approved_by),
         approved_at = CASE WHEN ? IS NULL THEN approved_at ELSE unixepoch() END
       WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
    )
    .bind(to, by ?? null, by ?? null, id, ...from)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function setPublished(db: D1Database, id: number, imgId: string, imgUrl: string) {
  await db
    .prepare("UPDATE assets SET img_id = ?, img_url = ? WHERE id = ?")
    .bind(imgId, imgUrl, id)
    .run();
}

/**
 * An older image for the same purpose is replaced by a new one. Kit directions are not: they are
 * compared side by side until one is adopted.
 */
export async function supersedeOthers(
  db: D1Database,
  asset: {
    id: number;
    campaignId: number;
    templateId: string;
    purpose: Asset["purpose"];
    forScheduleItemId: number | null;
    forImageSlotId: string | null;
  },
) {
  if (asset.purpose === "kit") return;
  await db
    .prepare(
      `UPDATE assets SET status = 'superseded' WHERE campaign_id = ? AND template_id = ? AND id != ? AND purpose = 'image'
         AND COALESCE(for_schedule_item_id, 0) = COALESCE(?, 0) AND COALESCE(for_image_slot_id, '') = COALESCE(?, '')
         AND status IN ('needs_approval','failed','rendering')`,
    )
    .bind(
      asset.campaignId,
      asset.templateId,
      asset.id,
      asset.forScheduleItemId,
      asset.forImageSlotId,
    )
    .run();
}

/** The campaign's adopted kit (the face) and its pending directions. */
export async function kitAssets(
  db: D1Database,
  campaignId: number,
): Promise<{ adopted: Asset | null; directions: Asset[] }> {
  const { results } = await db
    .prepare(
      "SELECT * FROM assets WHERE campaign_id = ? AND purpose = 'kit' AND status IN ('needs_approval','approved','failed') ORDER BY id DESC LIMIT 12",
    )
    .bind(campaignId)
    .all<Row>();
  const all = results.map(toAsset);
  const adoptedId = await db
    .prepare("SELECT kit_asset_id FROM campaigns WHERE id = ?")
    .bind(campaignId)
    .first<{ kit_asset_id: number | null }>();
  const adopted = all.find((a) => a.id === adoptedId?.kit_asset_id) ?? null;
  return {
    adopted,
    directions: all.filter((a) => a.status !== "approved" && a.id !== adopted?.id),
  };
}

/** Adopt one direction: the campaign points at it, it is approved, the other pending ones are rejected. */
export async function adoptKit(
  db: D1Database,
  campaignId: number,
  assetId: number,
  userId: string,
): Promise<boolean> {
  const moved = await moveAsset(db, assetId, ["needs_approval", "approved"], "approved", userId);
  if (!moved) return false;
  await db.batch([
    db
      .prepare("UPDATE campaigns SET kit_asset_id = ?, updated_at = unixepoch() WHERE id = ?")
      .bind(assetId, campaignId),
    db
      .prepare(
        "UPDATE assets SET status = 'rejected' WHERE campaign_id = ? AND purpose = 'kit' AND id != ? AND status = 'needs_approval'",
      )
      .bind(campaignId, assetId),
  ]);
  return true;
}
