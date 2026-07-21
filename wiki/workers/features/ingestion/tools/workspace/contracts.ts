/**
 * Read-only virtual filesystem contracts exposed to the generation model.
 *
 * Adapters receive paths relative to their mount ("" is their root). The
 * router is the only component which accepts absolute workspace paths.
 */

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
  /** One segment, never an absolute path. */
  name: string;
  /** Absolute path as visible to the model. The router adds the mount. */
  path: string;
  /** A resource can be both readable and contain descendants. */
  readable: boolean;
  /** `unknown` preserves lazy hierarchy resolution without N+1 reads. */
  hasChildren: boolean | "unknown";
  title?: string;
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

/**
 * An adapter owns one mounted source. All of its paths are relative and may
 * not begin with `/`; this prevents one adapter from escaping into another.
 */
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
