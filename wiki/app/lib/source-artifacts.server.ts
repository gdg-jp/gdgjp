import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

type Db = ReturnType<typeof drizzle>;
const MAX_NORMALIZED_SOURCE_BYTES = 5 * 1024 * 1024;

function sourceTooLargeError(): Error & { code: string } {
  return Object.assign(new Error("Normalized source exceeds the ingestion artifact limit"), {
    code: "source_context_too_large",
  });
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function persistNormalizedSource(
  env: Env,
  db: Db,
  sessionId: string,
  text: string,
): Promise<string | undefined> {
  if (!text) return undefined;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_NORMALIZED_SOURCE_BYTES) {
    throw sourceTooLargeError();
  }
  const key = `ingestion/${sessionId}/normalized/sources.md`;
  const hash = await sha256(bytes);
  await env.BUCKET.put(key, bytes, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: { sha256: hash },
  });

  const row = await db
    .select({ manifest: schema.ingestionSessions.contextManifestJson })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, sessionId))
    .get();
  let manifest: Record<string, unknown> = {};
  try {
    manifest = row?.manifest ? JSON.parse(row.manifest) : {};
  } catch {
    manifest = {};
  }
  manifest.sourceArtifact = {
    key,
    sha256: hash,
    bytes: bytes.byteLength,
    mimeType: "text/markdown",
    provenance: "normalized_ingestion_sources",
  };
  await db
    .update(schema.ingestionSessions)
    .set({ contextManifestJson: JSON.stringify(manifest), updatedAt: new Date() })
    .where(eq(schema.ingestionSessions.id, sessionId));
  return key;
}

export async function loadNormalizedSource(env: Env, key?: string): Promise<string | undefined> {
  if (!key) return undefined;
  const object = await env.BUCKET.get(key);
  if (!object) throw new Error("Normalized ingestion source not found");
  if (object.size > MAX_NORMALIZED_SOURCE_BYTES) throw sourceTooLargeError();
  return new TextDecoder().decode(await object.arrayBuffer());
}
