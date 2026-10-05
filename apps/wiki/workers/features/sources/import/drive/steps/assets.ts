import { type ResolvedSourceAsset, assetR2Key } from "../../../assets";
import { sha256Hex } from "../../../persist";
import { ATTACHMENT_PARALLELISM } from "../../../subrequest-budget";
import type { CurrentSourceImport, SourceImportTickContext } from "../../run";
import { type DriveImage, MAX_IMAGE_BYTES, requireToken } from "../drive-import-shared";

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

export async function stepAssets(ctx: SourceImportTickContext, current: CurrentSourceImport) {
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
