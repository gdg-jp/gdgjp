import type {
  AdapterResult,
  ListOptions,
  ListResult,
  ReadOptions,
  ReadResult,
  SearchOptions,
  SearchResult,
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceManifest,
  WorkspaceResult,
  WorkspaceTool,
  WorkspaceTrace,
} from "./contracts";
import { WORKSPACE_LIMITS } from "./contracts";
import {
  boundedLimit,
  decodeOffsetCursor,
  encodeOffsetCursor,
  mountedPath,
  normaliseAbsoluteWorkspacePath,
  splitMountedPath,
} from "./paths";

type MountedSearchCursor = {
  version: 1;
  mounts: Record<string, string | null>;
};

function decodeMountedSearchCursor(
  cursor: string | undefined,
  mounts: readonly string[],
): ReadonlyMap<string, string | null | undefined> {
  if (!cursor) return new Map();
  try {
    const value = JSON.parse(atob(cursor)) as MountedSearchCursor;
    const expectedMounts = [...mounts].sort();
    const cursorMounts = Object.keys(value.mounts).sort();
    if (
      value.version === 1 &&
      expectedMounts.length === cursorMounts.length &&
      expectedMounts.every((mount, index) => mount === cursorMounts[index]) &&
      Object.values(value.mounts).every(
        (adapterCursor) =>
          adapterCursor === null || (typeof adapterCursor === "string" && adapterCursor.length > 0),
      )
    ) {
      return new Map(Object.entries(value.mounts));
    }
  } catch {
    // Normalize all malformed cursors to the same public error.
  }
  throw new Error("Invalid workspace cursor");
}

function encodeMountedSearchCursor(mounts: ReadonlyMap<string, string | null>): string {
  return btoa(
    JSON.stringify({
      version: 1,
      mounts: Object.fromEntries(mounts),
    } satisfies MountedSearchCursor),
  );
}

export type MountedWorkspaceAdapter = {
  /** Absolute mount path, e.g. `/wiki` or a future `/google-forms`. */
  mount: string;
  adapter: WorkspaceAdapter;
};

/**
 * The only absolute-path API exposed to models. It routes an operation to a
 * mounted adapter, records compact provenance, and never materialises data.
 */
export class MountedWorkspace {
  #traces: WorkspaceTrace[] = [];
  #references: WorkspaceManifest["references"] = [];
  readonly #adapters: ReadonlyMap<string, WorkspaceAdapter>;

  constructor(adapters: readonly MountedWorkspaceAdapter[]) {
    const mounts = new Map<string, WorkspaceAdapter>();
    for (const { mount, adapter } of adapters) {
      const normalisedMount = normaliseAbsoluteWorkspacePath(mount);
      if (normalisedMount === "/" || mounts.has(normalisedMount)) {
        throw new Error("Workspace mounts must be unique non-root absolute paths");
      }
      mounts.set(normalisedMount, adapter);
    }
    if (mounts.size === 0) throw new Error("At least one workspace mount is required");
    this.#adapters = mounts;
  }

  manifest(): WorkspaceManifest {
    return { version: 2, references: [...this.#references], tools: [...this.#traces] };
  }

  async ls(path = "/", options?: ListOptions): Promise<WorkspaceResult<ListResult>> {
    const absolutePath = normaliseAbsoluteWorkspacePath(path);
    if (absolutePath === "/") {
      const allEntries = [...this.#adapters.keys()].sort().map(
        (mount) =>
          ({
            name: mount.slice(1),
            path: mount,
            readable: false,
            hasChildren: true,
          }) satisfies WorkspaceEntry,
      );
      const limit = boundedLimit(
        options?.limit,
        WORKSPACE_LIMITS.maxDirectoryEntries,
        WORKSPACE_LIMITS.defaultDirectoryEntries,
      );
      const offset = decodeOffsetCursor(options?.cursor);
      if (offset > allEntries.length) throw new Error("Workspace cursor is outside resource");
      const end = Math.min(allEntries.length, offset + limit);
      const entries = allEntries.slice(offset, end);
      const nextCursor = end < allEntries.length ? encodeOffsetCursor(end) : null;
      return this.record(
        "ls",
        { path: absolutePath },
        {
          data: { path: "/", entries, nextCursor },
          truncated: nextCursor !== null,
        },
      );
    }
    const resolved = this.resolve(absolutePath);
    const result = await resolved.adapter.ls(resolved.relativePath, options);
    return this.record("ls", { path: absolutePath }, this.absolutiseList(result, resolved.mount));
  }

  async cat(path: string, options?: ReadOptions): Promise<WorkspaceResult<ReadResult>> {
    const absolutePath = normaliseAbsoluteWorkspacePath(path);
    const resolved = this.resolve(absolutePath);
    const result = await resolved.adapter.cat(resolved.relativePath, options);
    const absoluteResult = {
      ...result,
      data: { ...result.data, path: mountedPath(resolved.mount, result.data.path) },
    };
    this.#references.push({
      path: absolutePath,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    });
    return this.record("cat", { path: absolutePath }, absoluteResult);
  }

  async search(
    query: string,
    options: SearchOptions & { path?: string } = {},
  ): Promise<WorkspaceResult<SearchResult>> {
    const requestedPath = options.path ? normaliseAbsoluteWorkspacePath(options.path) : undefined;
    const targets = requestedPath
      ? [this.resolve(requestedPath)]
      : [...this.#adapters.entries()].map(([mount, adapter]) => ({
          mount,
          adapter,
          relativePath: "",
        }));
    const mountedCursors = requestedPath
      ? new Map<string, string | null | undefined>()
      : decodeMountedSearchCursor(
          options.cursor,
          targets.map(({ mount }) => mount),
        );
    const results = await Promise.all(
      targets.map(async ({ mount, adapter, relativePath }) => {
        if (!requestedPath && mountedCursors.get(mount) === null) {
          return { mount, data: { matches: [], nextCursor: null }, truncated: false };
        }
        if (!adapter.search) {
          return { mount, data: { matches: [], nextCursor: null }, truncated: false };
        }
        const result = await adapter.search(relativePath, query, {
          limit: options.limit,
          cursor: requestedPath ? options.cursor : (mountedCursors.get(mount) ?? undefined),
        });
        return {
          mount,
          ...result,
          data: {
            ...result.data,
            matches: result.data.matches.map((match) => ({
              ...match,
              path: mountedPath(mount, match.path),
            })),
          },
        };
      }),
    );
    const nextMountedCursors = new Map(
      results.map((result) => [result.mount, result.data.nextCursor]),
    );
    const hasMore = results.some((result) => result.data.nextCursor !== null);
    const data = {
      matches: results.flatMap((result) => result.data.matches),
      nextCursor: hasMore
        ? requestedPath
          ? results[0].data.nextCursor
          : encodeMountedSearchCursor(nextMountedCursors)
        : null,
    };
    return this.record(
      "search",
      { ...(requestedPath ? { path: requestedPath } : {}), query },
      { data, truncated: results.some((result) => result.truncated) },
    );
  }

  private resolve(absolutePath: string): {
    mount: string;
    adapter: WorkspaceAdapter;
    relativePath: string;
  } {
    const resolved = splitMountedPath(absolutePath, [...this.#adapters.keys()]);
    if (!resolved) throw new Error("Workspace path is not mounted");
    const adapter = this.#adapters.get(resolved.mount);
    if (!adapter) throw new Error("Workspace mount is unavailable");
    return { ...resolved, adapter };
  }

  private absolutiseList(
    result: AdapterResult<ListResult>,
    mount: string,
  ): AdapterResult<ListResult> {
    return {
      ...result,
      data: {
        ...result.data,
        path: mountedPath(mount, result.data.path),
        entries: result.data.entries.map((entry) => ({
          ...entry,
          path: mountedPath(mount, entry.path),
        })),
      },
    };
  }

  private record<T>(
    tool: WorkspaceTool,
    details: Pick<WorkspaceTrace, "path" | "query">,
    result: AdapterResult<T>,
  ): WorkspaceResult<T> {
    this.#traces.push({
      tool,
      ...details,
      truncated: result.truncated,
      at: new Date().toISOString(),
    });
    return { ...result, manifest: this.manifest() };
  }
}

/** A mount which intentionally has no sources yet, while preserving the tree. */
export class EmptyWorkspaceAdapter implements WorkspaceAdapter {
  async ls(path: string): Promise<AdapterResult<ListResult>> {
    if (path) throw new Error("Workspace path not found");
    return { data: { path: "", entries: [], nextCursor: null }, truncated: false };
  }

  async cat(): Promise<AdapterResult<ReadResult>> {
    throw new Error("Workspace resource not found");
  }

  async search(): Promise<AdapterResult<SearchResult>> {
    return { data: { matches: [], nextCursor: null }, truncated: false };
  }
}

export function createMountedWorkspace(options: {
  wiki: WorkspaceAdapter;
  googleDocs?: WorkspaceAdapter;
  websites?: WorkspaceAdapter;
  /** Additional adapters can be mounted without changing the router. */
  additionalMounts?: readonly MountedWorkspaceAdapter[];
}): MountedWorkspace {
  return new MountedWorkspace([
    { mount: "/wiki", adapter: options.wiki },
    { mount: "/google-docs", adapter: options.googleDocs ?? new EmptyWorkspaceAdapter() },
    { mount: "/websites", adapter: options.websites ?? new EmptyWorkspaceAdapter() },
    ...(options.additionalMounts ?? []),
  ]);
}
