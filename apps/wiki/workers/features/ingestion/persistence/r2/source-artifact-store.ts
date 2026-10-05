import type { IngestionSessionRepository } from "../d1/ingestion-session-repository";
import type {
  WorkspaceSourceKind,
  WorkspaceSourceReference,
} from "../serialization/context-manifest-codec";

export const MAX_WORKSPACE_NODE_BYTES = 5 * 1024 * 1024;

export interface PersistWorkspaceSourceNode {
  path: string;
  parentPath: string;
  title: string;
  kind: WorkspaceSourceKind;
  content?: string;
  mimeType?: string;
  sourceUrl?: string;
  externalId?: string;
}

function sourceTooLargeError(): Error & { code: string } {
  return Object.assign(new Error("Workspace node exceeds the ingestion artifact limit"), {
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

function artifactKey(sessionId: string, path: string): string {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `ingestion/${sessionId}/workspace/${encodedPath}`;
}

export class R2WorkspaceSourceStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly sessions: IngestionSessionRepository,
  ) {}

  async persistWorkspaceNodes(
    sessionId: string,
    nodes: readonly PersistWorkspaceSourceNode[],
  ): Promise<WorkspaceSourceReference[]> {
    const references = await Promise.all(
      nodes.map(async (node): Promise<WorkspaceSourceReference> => {
        if (node.content === undefined) {
          return {
            path: node.path,
            parentPath: node.parentPath,
            title: node.title,
            kind: node.kind,
            sourceUrl: node.sourceUrl,
            externalId: node.externalId,
          };
        }
        const bytes = new TextEncoder().encode(node.content);
        if (bytes.byteLength > MAX_WORKSPACE_NODE_BYTES) throw sourceTooLargeError();
        const key = artifactKey(sessionId, node.path);
        const digest = await sha256(bytes);
        const mimeType = node.mimeType ?? "text/plain; charset=utf-8";
        await this.bucket.put(key, bytes, {
          httpMetadata: { contentType: mimeType },
          customMetadata: { sha256: digest, workspacePath: node.path },
        });
        return {
          path: node.path,
          parentPath: node.parentPath,
          title: node.title,
          kind: node.kind,
          artifactKey: key,
          sha256: digest,
          bytes: bytes.byteLength,
          mimeType,
          sourceUrl: node.sourceUrl,
          externalId: node.externalId,
        };
      }),
    );
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new Error("Ingestion session not found");
    const sourceNodes = new Map(
      (session.contextManifest.sourceNodes ?? []).map((reference) => [reference.path, reference]),
    );
    for (const reference of references) sourceNodes.set(reference.path, reference);
    await this.sessions.updateContextManifest(sessionId, {
      ...session.contextManifest,
      sourceNodes: [...sourceNodes.values()],
    });
    return references;
  }
}
