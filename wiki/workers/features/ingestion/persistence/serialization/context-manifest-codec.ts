export interface SourceArtifactReference {
  key: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  provenance: "normalized_ingestion_sources";
}

/**
 * Preserve unknown manifest fields so existing audit records remain forwards
 * compatible while giving ingestion code a typed source-artifact reference.
 */
export type IngestionContextManifest = Record<string, unknown> & {
  sourceArtifact?: SourceArtifactReference;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSourceArtifact(value: unknown): SourceArtifactReference | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.key !== "string" ||
    typeof value.sha256 !== "string" ||
    typeof value.bytes !== "number" ||
    typeof value.mimeType !== "string" ||
    value.provenance !== "normalized_ingestion_sources"
  ) {
    return undefined;
  }
  return {
    key: value.key,
    sha256: value.sha256,
    bytes: value.bytes,
    mimeType: value.mimeType,
    provenance: value.provenance,
  };
}

export function parseIngestionContextManifest(value: string | null): IngestionContextManifest {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return {};
    const sourceArtifact = parseSourceArtifact(parsed.sourceArtifact);
    return sourceArtifact ? { ...parsed, sourceArtifact } : { ...parsed };
  } catch {
    return {};
  }
}

export function stringifyIngestionContextManifest(manifest: IngestionContextManifest): string {
  return JSON.stringify(manifest);
}
