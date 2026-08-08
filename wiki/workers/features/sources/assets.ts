import type { GoogleDocsInlineImage } from "../../../app/lib/google-docs-markdown.server";
import { sha256Hex } from "./persist";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ResolvedSourceAsset {
  /** Clone-relative path, identical to the R2 key so the raw tree mirrors the bucket. */
  path: string;
  r2Key: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export interface ResolveAssetsResult {
  markdown: string;
  assets: ResolvedSourceAsset[];
}

/**
 * Download the inline images a Google Doc references, store them under
 * `raw/<sourceId>/assets/`, and rewrite the converter's `attachment:<objectId>`
 * placeholders to the stored path.
 *
 * Keys are content-addressed (`<objectId>-<contentHash>.<ext>`) rather than
 * randomly named on purpose: a random id would change the rewritten markdown on
 * every refresh, which would change the document's content_hash and defeat the
 * "same content → skip the write" rule that keeps raw immutable.
 */
export async function resolveSourceAssets(
  env: Env,
  input: {
    sourceId: string;
    markdown: string;
    images: readonly GoogleDocsInlineImage[];
    accessToken: string;
  },
): Promise<ResolveAssetsResult> {
  let markdown = input.markdown;
  const assets: ResolvedSourceAsset[] = [];

  for (const image of input.images) {
    const response = await fetch(image.sourceUrl, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    if (response.status === 404) {
      // Docs content URIs are short-lived and individual embeds can vanish.
      // A missing image must never discard the surrounding text.
      markdown = removeImagePlaceholder(markdown, image.objectId);
      console.warn("[sources] inline image unavailable", image.objectId);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Unable to download an image from Google Docs (${response.status})`);
    }

    const mimeType =
      response.headers.get("Content-Type")?.split(";")[0] || image.contentType || "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      throw new Error("Google Docs returned an invalid image type");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("A Google Docs image exceeds the 10 MB limit");
    }

    const contentHash = await sha256Hex(bytes);
    const r2Key = assetR2Key(input.sourceId, image.objectId, contentHash, mimeType);
    await env.BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { sha256: contentHash, objectId: image.objectId },
    });

    assets.push({
      path: r2Key,
      r2Key,
      mimeType,
      byteSize: bytes.byteLength,
      contentHash,
    });
    markdown = markdown.replaceAll(`attachment:${image.objectId}`, r2Key);
  }

  return { markdown, assets };
}

export function assetR2Key(
  sourceId: string,
  objectId: string,
  contentHash: string,
  mimeType: string,
): string {
  return `raw/${sourceId}/assets/${sanitizeObjectId(objectId)}-${contentHash}.${extensionFor(mimeType)}`;
}

function sanitizeObjectId(objectId: string): string {
  const cleaned = objectId.replace(/[^A-Za-z0-9_-]/g, "_");
  return cleaned || "image";
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return "jpg";
}

function removeImagePlaceholder(markdown: string, objectId: string): string {
  const escaped = objectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(`!\\[(?:\\\\.|[^\\]])*\\]\\(attachment:${escaped}\\)`, "g"),
    "",
  );
}
