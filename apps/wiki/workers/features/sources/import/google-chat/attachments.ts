import { driveFilesUrl } from "../../../../../app/features/google/drive.server";
import { type ResolvedSourceAsset, assetR2Key } from "../../assets";
import { type ChatMessageAttachment, warnGoogleChat } from "../../google-chat";
import { sha256Hex } from "../../persist";
import { ATTACHMENT_PARALLELISM } from "../../subrequest-budget";
import { metaSet } from "../run";
import {
  type ChatImportTickContext,
  type Current,
  MAX_ATTACHMENT_BYTES,
  type StepOutcome,
  fetchWithTimeout,
  requireAccessToken,
} from "./shared";

function contentLength(response: Response): number | null {
  const value = response.headers.get("Content-Length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

class AttachmentTooLargeError extends Error {
  constructor(readonly byteSize: number) {
    super("Google Chat attachment exceeds the 10 MB limit");
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
  ctx: ChatImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  const token = requireAccessToken(ctx);

  while (true) {
    const pending = ctx.sql
      .exec<{
        id: number;
        object_id: string;
        drive_file_id: string | null;
        media_resource_name: string | null;
        content_type: string | null;
        content_name: string | null;
      }>(
        `SELECT id, object_id, drive_file_id, media_resource_name, content_type, content_name
         FROM attachments WHERE status = 'pending' ORDER BY id LIMIT ?`,
        ATTACHMENT_PARALLELISM,
      )
      .toArray();
    if (pending.length === 0) return { phaseComplete: true };

    // 2 subrequests per attachment; progress is object-local.
    const batchSize = Math.min(
      pending.length,
      Math.floor(ctx.budget.remaining() / 2),
      ATTACHMENT_PARALLELISM,
    );
    if (batchSize <= 0) return { phaseComplete: false };
    const batch = pending.slice(0, batchSize);

    await Promise.all(
      batch.map(async (row) => {
        const attachment: ChatMessageAttachment = {
          contentName: row.content_name ?? row.object_id,
          contentType: row.content_type ?? undefined,
          driveDataRef: row.drive_file_id ? { driveFileId: row.drive_file_id } : undefined,
          attachmentDataRef: row.media_resource_name
            ? { resourceName: row.media_resource_name }
            : undefined,
        };
        const asset = await downloadAttachment(
          ctx,
          current.source.id,
          token,
          row.object_id,
          attachment,
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

    const done = ctx.sql
      .exec<{ c: number }>(
        "SELECT COUNT(*) AS c FROM attachments WHERE status IN ('done', 'skipped')",
      )
      .one().c;
    metaSet(ctx.sql, "attachments_done", String(done));
  }
}

async function downloadAttachment(
  ctx: ChatImportTickContext,
  sourceId: string,
  token: string,
  objectId: string,
  attachment: ChatMessageAttachment,
): Promise<ResolvedSourceAsset | null> {
  const driveId = attachment.driveDataRef?.driveFileId;
  const media = attachment.attachmentDataRef?.resourceName;
  if (!driveId && !media) return null;
  const url = driveId
    ? driveFilesUrl(driveId, { alt: "media" })
    : `https://chat.googleapis.com/v1/media/${media}?alt=media`;

  ctx.budget.spend(1);
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" },
  });
  if (response.status === 403 || response.status === 404) {
    warnGoogleChat("attachment_unavailable", {
      sourceId,
      attachmentId: objectId,
      attachmentKind: driveId ? "drive" : "chat-media",
      status: response.status,
    });
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to download a Google Chat attachment (${response.status})`);
  }
  const declaredByteSize = contentLength(response);
  if (declaredByteSize === null) {
    warnGoogleChat("attachment_size_unknown", {
      sourceId,
      attachmentId: objectId,
    });
    return null;
  }
  if (declaredByteSize > MAX_ATTACHMENT_BYTES) {
    warnGoogleChat("attachment_too_large", {
      sourceId,
      attachmentId: objectId,
      byteSize: declaredByteSize,
    });
    return null;
  }
  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    attachment.contentType ||
    "application/octet-stream";
  if (!response.body) throw new Error("Google Chat attachment response has no body");
  let bytes: Uint8Array;
  try {
    bytes = await readAttachmentBytes(response.body);
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      warnGoogleChat("attachment_too_large", {
        sourceId,
        attachmentId: objectId,
        byteSize: error.byteSize,
      });
      return null;
    }
    throw error;
  }
  if (bytes.byteLength !== declaredByteSize) {
    throw new Error("Google Chat attachment Content-Length does not match its body");
  }
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  ctx.budget.spend(1);
  await ctx.env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sha256: contentHash, objectId },
  });
  return { path: r2Key, r2Key, mimeType, byteSize: declaredByteSize, contentHash };
}
