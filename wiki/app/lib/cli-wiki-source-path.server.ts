export type RawManifestPathEntry = {
  documentId: string;
  path: string;
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
