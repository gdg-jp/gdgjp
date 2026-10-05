import {
  type AdapterResult,
  type ListOptions,
  type ListResult,
  type ReadOptions,
  type ReadResult,
  type SearchOptions,
  type SearchResult,
  WORKSPACE_LIMITS,
  type WorkspaceAdapter,
  type WorkspaceEntry,
} from "../../tools/workspace/contracts";
import {
  boundedLimit,
  cleanQuery,
  decodeOffsetCursor,
  encodeOffsetCursor,
  normaliseRelativeWorkspacePath,
} from "../../tools/workspace/paths";
import type { WorkspaceSourceReference } from "../serialization/context-manifest-codec";

type Node = {
  path: string;
  name: string;
  title: string;
  reference?: WorkspaceSourceReference;
  children: Set<string>;
};

export type WorkspaceSourceContentLoader = (
  reference: WorkspaceSourceReference,
) => Promise<string | undefined>;

function relativeToMount(path: string, mount: string): string | null {
  if (path === mount) return "";
  return path.startsWith(`${mount}/`) ? path.slice(mount.length + 1) : null;
}

function parentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}

/** Rehydrates persisted external-source nodes as one mounted read-only adapter. */
export class ManifestWorkspaceAdapter implements WorkspaceAdapter {
  readonly #nodes = new Map<string, Node>();

  constructor(
    mount: `/${string}`,
    references: readonly WorkspaceSourceReference[],
    private readonly loadContent: WorkspaceSourceContentLoader,
  ) {
    this.#nodes.set("", {
      path: "",
      name: mount.slice(1),
      title: mount.slice(1),
      children: new Set(),
    });
    for (const reference of references) {
      const relativePath = relativeToMount(reference.path, mount);
      if (relativePath === null || !relativePath) continue;
      const segments = relativePath.split("/");
      for (let index = 0; index < segments.length; index++) {
        const path = segments.slice(0, index + 1).join("/");
        const parent = segments.slice(0, index).join("/");
        const existing = this.#nodes.get(path);
        this.#nodes.set(path, {
          path,
          name: segments[index],
          title:
            index === segments.length - 1 ? reference.title : (existing?.title ?? segments[index]),
          reference: index === segments.length - 1 ? reference : existing?.reference,
          children: existing?.children ?? new Set(),
        });
        this.#nodes.get(parent)?.children.add(path);
      }
    }
  }

  async ls(path: string, options: ListOptions = {}): Promise<AdapterResult<ListResult>> {
    const normalized = normaliseRelativeWorkspacePath(path);
    const node = this.#nodes.get(normalized);
    if (!node) throw new Error("Workspace path not found");
    const limit = boundedLimit(
      options.limit,
      WORKSPACE_LIMITS.maxDirectoryEntries,
      WORKSPACE_LIMITS.defaultDirectoryEntries,
    );
    const offset = decodeOffsetCursor(options.cursor);
    const children = [...node.children]
      .map((child) => this.#nodes.get(child))
      .filter((child): child is Node => Boolean(child))
      .sort((left, right) => left.name.localeCompare(right.name));
    const page = children.slice(offset, offset + limit);
    const entries: WorkspaceEntry[] = page.map((child) => ({
      name: child.name,
      path: child.path,
      title: child.title,
      readable: Boolean(child.reference?.artifactKey),
      hasChildren: child.children.size > 0,
    }));
    const nextOffset = offset + page.length;
    return {
      data: {
        path: normalized,
        entries,
        nextCursor: nextOffset < children.length ? encodeOffsetCursor(nextOffset) : null,
      },
      truncated: nextOffset < children.length,
    };
  }

  async cat(path: string, options: ReadOptions = {}): Promise<AdapterResult<ReadResult>> {
    const normalized = normaliseRelativeWorkspacePath(path);
    const reference = this.#nodes.get(normalized)?.reference;
    if (!reference?.artifactKey) throw new Error("Workspace resource is not readable");
    const content = await this.loadContent(reference);
    if (content === undefined) throw new Error("Workspace source artifact not found");
    const offset = decodeOffsetCursor(options.cursor);
    const maxChars = boundedLimit(
      options.maxChars,
      WORKSPACE_LIMITS.maxReadCharacters,
      WORKSPACE_LIMITS.defaultReadCharacters,
    );
    const chunk = content.slice(offset, offset + maxChars);
    const nextOffset = offset + chunk.length;
    return {
      data: {
        path: normalized,
        content: chunk,
        nextCursor: nextOffset < content.length ? encodeOffsetCursor(nextOffset) : null,
      },
      truncated: nextOffset < content.length,
    };
  }

  async search(
    path: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<AdapterResult<SearchResult>> {
    const scope = normaliseRelativeWorkspacePath(path);
    const cleaned = cleanQuery(query).toLocaleLowerCase();
    const limit = boundedLimit(
      options.limit,
      WORKSPACE_LIMITS.maxSearchResults,
      WORKSPACE_LIMITS.defaultSearchResults,
    );
    const offset = decodeOffsetCursor(options.cursor);
    const matches = [...this.#nodes.values()]
      .filter(
        (node) =>
          node.path &&
          (!scope || node.path === scope || node.path.startsWith(`${scope}/`)) &&
          `${node.title} ${node.path}`.toLocaleLowerCase().includes(cleaned),
      )
      .sort((left, right) => left.path.localeCompare(right.path));
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      data: {
        matches: page.map((node) => ({ path: node.path, title: node.title })),
        nextCursor: nextOffset < matches.length ? encodeOffsetCursor(nextOffset) : null,
      },
      truncated: nextOffset < matches.length,
    };
  }
}

export function createR2ManifestWorkspaceAdapter(
  bucket: R2Bucket,
  mount: `/${string}`,
  references: readonly WorkspaceSourceReference[],
): ManifestWorkspaceAdapter {
  return new ManifestWorkspaceAdapter(mount, references, async (reference) => {
    if (!reference.artifactKey) return undefined;
    const object = await bucket.get(reference.artifactKey);
    return object?.text();
  });
}
