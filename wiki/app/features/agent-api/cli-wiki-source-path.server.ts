export type RawManifestPathEntry = {
  documentId: string;
  path: string;
};

export type WikiHumanPagePathEntry = {
  id: string;
  slug: string;
  parentId: string | null;
};

/** Returns a readable, single path segment for a source's raw clone directory. */
export function rawSourceDirectory(title: string): string {
  const cleaned = title.trim().replaceAll("/", "／").replaceAll("\\", "＼").replace(/\0/g, "");
  const name = !cleaned || cleaned === "." || cleaned === ".." ? "Untitled source" : cleaned;
  return `[${name}]`;
}

/**
 * Assigns stable source directories. IDs are added only when multiple ready
 * sources share the same readable title, so their contents cannot merge.
 */
export function rawSourceDirectories(
  sources: readonly { id: string; title: string }[],
): Map<string, string> {
  const directories = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const source of sources) {
    const directory = rawSourceDirectory(source.title);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  for (const source of sources) {
    const directory = rawSourceDirectory(source.title);
    directories.set(
      source.id,
      counts.get(directory) === 1 ? directory : `${directory} [${source.id}]`,
    );
  }
  return directories;
}

/**
 * Returns the raw-clone location for a human-authored page, using the same
 * directory hierarchy and page.md convention as the authored Wiki tree.
 */
export function wikiHumanRawPath(
  page: WikiHumanPagePathEntry,
  pagesByID: ReadonlyMap<string, WikiHumanPagePathEntry>,
): string {
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: WikiHumanPagePathEntry | undefined = page;

  while (current) {
    if (visited.has(current.id)) {
      throw new Error(`human page hierarchy contains a cycle at ${current.id}`);
    }
    visited.add(current.id);
    segments.unshift(current.slug);

    const parentID = current.parentId;
    if (parentID === null) break;
    current = pagesByID.get(parentID);
    if (!current) {
      throw new Error(`human page ${page.id} has missing parent ${parentID}`);
    }
  }

  return `raw/${segments.join("/")}/page.md`;
}

/**
 * Makes manifest paths unique without exposing IDs unless their readable paths
 * collide. IDs are inserted before a filename extension when present.
 */
export function disambiguateRawManifestPaths<T extends RawManifestPathEntry>(entries: T[]): T[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1);
  }
  return entries.map((entry) =>
    counts.get(entry.path) === 1
      ? entry
      : { ...entry, path: appendDocumentID(entry.path, entry.documentId) },
  );
}

function appendDocumentID(path: string, documentID: string): string {
  const slash = path.lastIndexOf("/");
  const directory = slash === -1 ? "" : path.slice(0, slash + 1);
  const fileName = slash === -1 ? path : path.slice(slash + 1);
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  return `${directory}${stem} [${documentID}]${extension}`;
}
