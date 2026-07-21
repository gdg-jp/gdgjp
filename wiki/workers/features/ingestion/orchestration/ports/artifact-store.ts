export interface WorkspaceSourceArtifact {
  path: string;
  parentPath: string;
  content?: string;
}

export interface WorkspaceSourceStore {
  saveNodes(sessionId: string, nodes: readonly WorkspaceSourceArtifact[]): Promise<void>;
}

export interface AttachmentReference {
  key: string;
  mediaType: string;
  filename?: string;
}

export interface AttachmentStore {
  list(keys: readonly string[], limit?: number): Promise<AttachmentReference[]>;
}
