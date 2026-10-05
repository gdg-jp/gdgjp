export type WorkspaceSourceKind = "google_document" | "google_tab" | "google_form" | "website";

/** A persisted external-source node mounted directly below the workspace root. */
export interface WorkspaceSourceReference {
  path: string;
  parentPath: string;
  title: string;
  kind: WorkspaceSourceKind;
  artifactKey?: string;
  sha256?: string;
  bytes?: number;
  mimeType?: string;
  sourceUrl?: string;
  externalId?: string;
}

/**
 * Preserve unknown manifest fields so existing audit records remain forwards
 * compatible while giving ingestion code a typed source-artifact reference.
 */
export type IngestionContextManifest = Record<string, unknown> & {
  sourceNodes?: WorkspaceSourceReference[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSourceNode(value: unknown): WorkspaceSourceReference | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    typeof value.parentPath !== "string" ||
    typeof value.title !== "string" ||
    !["google_document", "google_tab", "google_form", "website"].includes(String(value.kind))
  ) {
    return undefined;
  }
  return {
    path: value.path,
    parentPath: value.parentPath,
    title: value.title,
    kind: value.kind as WorkspaceSourceKind,
    ...(typeof value.artifactKey === "string" ? { artifactKey: value.artifactKey } : {}),
    ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
    ...(typeof value.bytes === "number" ? { bytes: value.bytes } : {}),
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    ...(typeof value.sourceUrl === "string" ? { sourceUrl: value.sourceUrl } : {}),
    ...(typeof value.externalId === "string" ? { externalId: value.externalId } : {}),
  };
}

export function parseIngestionContextManifest(value: string | null): IngestionContextManifest {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return {};
    const sourceNodes = Array.isArray(parsed.sourceNodes)
      ? parsed.sourceNodes.flatMap((node) => {
          const parsedNode = parseSourceNode(node);
          return parsedNode ? [parsedNode] : [];
        })
      : undefined;
    return {
      ...parsed,
      ...(sourceNodes ? { sourceNodes } : {}),
    };
  } catch {
    return {};
  }
}

export function stringifyIngestionContextManifest(manifest: IngestionContextManifest): string {
  return JSON.stringify(manifest);
}
