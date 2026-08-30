import type { DeriveTransform } from "~/lib/img-transform";
import { renditionPrefixForImage, renditionPrefixForSource } from "./rendition-key";
import type { SourceVariant } from "./variant";

export function getRendition(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.DERIVED.get(key);
}

export async function putRendition(
  env: Env,
  key: string,
  bytes: ArrayBuffer,
  transform: DeriveTransform,
): Promise<void> {
  await env.DERIVED.put(key, bytes, {
    httpMetadata: { contentType: `image/${transform.format}` },
  });
}

export async function putPassthroughMarker(env: Env, key: string): Promise<void> {
  await env.DERIVED.put(key, new ArrayBuffer(0), { customMetadata: { passthrough: "1" } });
}

export function deleteRenditionsForImage(env: Env, id: string): Promise<void> {
  return deleteByPrefix(env, renditionPrefixForImage(id));
}

export function deleteRenditionsForSource(
  env: Env,
  id: string,
  source: Pick<SourceVariant, "variant" | "sourceVersion">,
): Promise<void> {
  return deleteByPrefix(env, renditionPrefixForSource(id, source));
}

async function deleteByPrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.DERIVED.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((object) => object.key);
    if (keys.length) await env.DERIVED.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
