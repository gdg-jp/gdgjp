import type { Brief } from "~/features/briefs/brief";

/** R2 key of a campaign's design file: `photos/<speakerId>.<ext>` or `logo.<ext>`. */
export const photoKey = (campaignId: number, ref: string) => `design/${campaignId}/${ref}`;

const MAX_BYTES = 2_500_000;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function fetchImage(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    // img.gdgs.jp serves the original; a webp variant is cheaper for Codex and the renderer.
    if (u.hostname === "img.gdgs.jp" && !u.searchParams.has("f")) u.searchParams.set("f", "webp");
    const response = await fetch(u, {
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!TYPES[type]) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 2_000) return null;
    return { bytes, type };
  } catch {
    return null;
  }
}

/**
 * The speakers' photos (brief.speakers[].imageUrl) and the event's logo (brief.skin.logoUrl),
 * fetched once into R2 so the bundle and the Worker's renderer use the same bytes. Returns the
 * `assets/…` references that exist.
 */
export async function ensureDesignFiles(
  env: Env,
  campaignId: number,
  brief: Brief,
  speakerIds: string[],
): Promise<{ refs: string[]; bytes: Record<string, ArrayBuffer> }> {
  const refs: string[] = [];
  const bytes: Record<string, ArrayBuffer> = {};
  const wanted: { ref: (ext: string) => string; url: string; id: string }[] = [];
  for (const speaker of brief.speakers)
    if (speakerIds.includes(speaker.id) && speaker.imageUrl)
      wanted.push({
        id: `photos/${speaker.id}`,
        url: speaker.imageUrl,
        ref: (ext) => `photos/${speaker.id}.${ext}`,
      });
  const logoUrl = (brief.skin as { logoUrl?: string } | undefined)?.logoUrl;
  if (logoUrl) wanted.push({ id: "logo", url: logoUrl, ref: (ext) => `logo.${ext}` });
  for (const item of wanted.slice(0, 12)) {
    // Already fetched? The key carries the extension, so look for any of them.
    let found: { ref: string; bytes: ArrayBuffer } | null = null;
    for (const ext of Object.values(TYPES)) {
      const ref = item.ref(ext);
      const object = await env.IMAGES.get(photoKey(campaignId, ref));
      if (object) {
        found = { ref, bytes: await object.arrayBuffer() };
        break;
      }
    }
    if (!found) {
      const fetched = await fetchImage(item.url);
      if (!fetched) continue;
      const ref = item.ref(TYPES[fetched.type] as string);
      await env.IMAGES.put(photoKey(campaignId, ref), fetched.bytes, {
        httpMetadata: { contentType: fetched.type },
      });
      found = { ref, bytes: fetched.bytes };
    }
    refs.push(found.ref);
    bytes[found.ref] = found.bytes;
  }
  return { refs, bytes };
}
