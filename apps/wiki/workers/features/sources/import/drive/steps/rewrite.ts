import type { ResolvedSourceAsset } from "../../../assets";
import { markdownBody } from "../../../media-type";
import type { SourceImportTickContext } from "../../run";
import type { DriveUnit } from "../drive-import-shared";

function removePlaceholder(markdown: string, objectId: string): string {
  const escaped = objectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(`!\\[(?:\\\\.|[^\\]])*\\]\\(attachment:${escaped}\\)`, "g"),
    "",
  );
}

export async function stepRewrite(ctx: SourceImportTickContext) {
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
