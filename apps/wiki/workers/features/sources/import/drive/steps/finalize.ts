import { and, eq } from "drizzle-orm";
import * as schema from "../../../../../../app/db/schema";
import type { ResolvedSourceAsset } from "../../../assets";
import { persistSourceDocument } from "../../../persist";
import { archiveMissingDocuments } from "../../archive";
import {
  ARCHIVE_MISSING_SUBREQUESTS,
  type CurrentSourceImport,
  PERSIST_REPLACE_SUBREQUESTS,
  type SourceImportTickContext,
  metaGet,
  metaNumber,
  metaSet,
} from "../../run";
import type { DriveUnit } from "../drive-import-shared";

export async function stepFinalizing(ctx: SourceImportTickContext, current: CurrentSourceImport) {
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

export async function completeDriveImport(
  ctx: SourceImportTickContext,
  current: CurrentSourceImport,
) {
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
