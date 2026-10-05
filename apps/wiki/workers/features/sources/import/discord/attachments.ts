import { type ResolvedSourceAsset, assetR2Key } from "../../assets";
import { warnDiscord } from "../../discord";
import { sha256Hex } from "../../persist";
import { ATTACHMENT_PARALLELISM } from "../../subrequest-budget";
import {
  type Current,
  type DiscordImportTickContext,
  MAX_ATTACHMENT_BYTES,
  type StepOutcome,
  fetchWithTimeout,
} from "./shared";

class AttachmentTooLargeError extends Error {
  constructor(readonly byteSize: number) {
    super("Discord attachment exceeds the 10 MB limit");
  }
}

async function readAttachmentBytes(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError(byteLength);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function stepAttachments(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  while (true) {
    const pending = ctx.sql
      .exec<{
        id: number;
        object_id: string;
        media_resource_name: string | null;
        content_type: string | null;
        content_name: string | null;
      }>(
        `SELECT id, object_id, media_resource_name, content_type, content_name
         FROM attachments WHERE status = 'pending' ORDER BY id LIMIT ?`,
        ATTACHMENT_PARALLELISM,
      )
      .toArray();
    if (pending.length === 0) return { phaseComplete: true };

    const batchSize = Math.min(
      pending.length,
      Math.floor(ctx.budget.remaining() / 2),
      ATTACHMENT_PARALLELISM,
    );
    if (batchSize <= 0) return { phaseComplete: false };
    const batch = pending.slice(0, batchSize);

    await Promise.all(
      batch.map(async (row) => {
        const asset = await downloadAttachment(
          ctx,
          current.source.id,
          row.object_id,
          row.media_resource_name,
          row.content_type,
        );
        if (asset) {
          ctx.sql.exec(
            "UPDATE attachments SET status = 'done', asset_json = ? WHERE id = ?",
            JSON.stringify(asset),
            row.id,
          );
        } else {
          ctx.sql.exec("UPDATE attachments SET status = 'skipped' WHERE id = ?", row.id);
        }
      }),
    );
  }
}

async function downloadAttachment(
  ctx: DiscordImportTickContext,
  sourceId: string,
  objectId: string,
  url: string | null,
  contentType: string | null,
): Promise<ResolvedSourceAsset | null> {
  if (!url) return null;
  ctx.budget.spend(1);
  const response = await fetchWithTimeout(url, { headers: { "Accept-Encoding": "identity" } });
  if (response.status === 403 || response.status === 404) {
    warnDiscord("attachment_unavailable", {
      sourceId,
      attachmentId: objectId,
      status: response.status,
    });
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to download a Discord attachment (${response.status})`);
  }
  const declared = Number(response.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isSafeInteger(declared) && declared > MAX_ATTACHMENT_BYTES) {
    warnDiscord("attachment_too_large", {
      sourceId,
      attachmentId: objectId,
      byteSize: declared,
    });
    return null;
  }
  if (!response.body) throw new Error("Discord attachment response has no body");
  let bytes: Uint8Array;
  try {
    bytes = await readAttachmentBytes(response.body);
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      warnDiscord("attachment_too_large", {
        sourceId,
        attachmentId: objectId,
        byteSize: error.byteSize,
      });
      return null;
    }
    throw error;
  }
  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    contentType ||
    "application/octet-stream";
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  ctx.budget.spend(1);
  await ctx.env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sha256: contentHash, objectId },
  });
  return {
    path: r2Key,
    r2Key,
    mimeType,
    byteSize: bytes.byteLength,
    contentHash,
  };
}
