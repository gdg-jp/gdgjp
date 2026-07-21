import type { IngestionSessionRepository } from "../d1/ingestion-session-repository";
import type { SourceArtifactReference } from "../serialization/context-manifest-codec";

export const MAX_NORMALIZED_SOURCE_BYTES = 5 * 1024 * 1024;

export interface SourceArtifactStore {
  persist(sessionId: string, text: string): Promise<SourceArtifactReference | undefined>;
  load(key: string | undefined): Promise<string | undefined>;
}

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

export class R2SourceArtifactStore implements SourceArtifactStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly sessions: IngestionSessionRepository,
  ) {}

  async persist(sessionId: string, text: string): Promise<SourceArtifactReference | undefined> {
    if (!text) return undefined;
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > MAX_NORMALIZED_SOURCE_BYTES) throw sourceTooLargeError();
    const key = `ingestion/${sessionId}/normalized/sources.md`;
    const reference: SourceArtifactReference = {
      key,
      sha256: await sha256(bytes),
      bytes: bytes.byteLength,
      mimeType: "text/markdown",
      provenance: "normalized_ingestion_sources",
    };
    await this.bucket.put(key, bytes, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { sha256: reference.sha256 },
    });
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new Error("Ingestion session not found");
    await this.sessions.updateContextManifest(sessionId, {
      ...session.contextManifest,
      sourceArtifact: reference,
    });
    return reference;
  }

  async load(key: string | undefined): Promise<string | undefined> {
    if (!key) return undefined;
    const object = await this.bucket.get(key);
    if (!object) throw new Error("Normalized ingestion source not found");
    if (object.size > MAX_NORMALIZED_SOURCE_BYTES) throw sourceTooLargeError();
    return object.text();
  }
}
