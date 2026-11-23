export const WORKSPACE_LIMITS = {
  defaultDirectoryEntries: 25,
  maxDirectoryEntries: 50,
  defaultReadCharacters: 12_000,
  maxReadCharacters: 24_000,
  defaultSearchResults: 12,
  maxSearchResults: 20,
  maxPathDepth: 16,
  maxQueryLength: 160,
} as const;

export type WorkspaceEntry = {
  name: string;
  path: string;
  readable: boolean;
  hasChildren: boolean | "unknown";
  title?: string;
  summary?: string;
};

export type ListOptions = { limit?: number; cursor?: string };
export type ReadOptions = { maxChars?: number; cursor?: string };
export type SearchOptions = { limit?: number; cursor?: string };

export type ListResult = {
  path: string;
  entries: WorkspaceEntry[];
  nextCursor: string | null;
};

export type ReadResult = {
  path: string;
  content: string;
  nextCursor: string | null;
};

export type SearchMatch = {
  path: string;
  title: string;
  snippet?: string;
};

export type SearchResult = { matches: SearchMatch[]; nextCursor: string | null };

export type AdapterResult<T> = { data: T; truncated: boolean };

export interface WorkspaceAdapter {
  ls(path: string, options?: ListOptions): Promise<AdapterResult<ListResult>>;
  cat(path: string, options?: ReadOptions): Promise<AdapterResult<ReadResult>>;
  search?(
    path: string,
    query: string,
    options?: SearchOptions,
  ): Promise<AdapterResult<SearchResult>>;
}

export type WorkspaceTool = "ls" | "cat" | "search";

export type WorkspaceTrace = {
  tool: WorkspaceTool;
  path?: string;
  query?: string;
  truncated: boolean;
  at: string;
};

export type WorkspaceManifest = {
  version: 2;
  references: Array<{ path: string; cursor?: string }>;
  tools: WorkspaceTrace[];
};

export type WorkspaceResult<T> = AdapterResult<T> & { manifest: WorkspaceManifest };
