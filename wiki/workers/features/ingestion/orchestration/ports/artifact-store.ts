export interface SourceArtifactStore {
  load(key: string | undefined): Promise<string | undefined>;
  save(sessionId: string, text: string): Promise<{ key: string; sha256: string } | undefined>;
}

export interface AttachmentReference {
  key: string;
  mediaType: string;
  filename?: string;
}

export interface AttachmentStore {
  list(keys: readonly string[], limit?: number): Promise<AttachmentReference[]>;
}
