import { unzipSync } from "fflate";
import {
  IMAGE_TYPES,
  ZipImportError,
  basename,
  cleanTitle,
  csvToMarkdown,
  dirname,
  extension,
  firstHeading,
  isIgnored,
  normalizePath,
} from "./zip-helpers";

export const MAX_ZIP_SIZE = 20 * 1024 * 1024;
const MAX_ENTRIES = 1_000;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

type ContentKind = "markdown" | "csv";

interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
  extension: string;
  kind: ContentKind | "image" | "ignored";
}

export interface PagePlan {
  key: string;
  sourcePath?: string;
  title: string;
  parentKey: string | null;
  sortOrder: number;
  content: string;
}

export interface ImagePlan {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  ownerKey: string;
}

export interface ZipImportPreview {
  rootTitle: string;
  pageCount: number;
  folderCount: number;
  markdownCount: number;
  csvCount: number;
  imageCount: number;
  skipped: string[];
}

export interface ParsedImport {
  preview: ZipImportPreview;
  pages: PagePlan[];
  images: ImagePlan[];
  rootDirectory: string | null;
}

function archiveEntries(fileName: string, bytes: ArrayBuffer): ArchiveEntry[] {
  if (bytes.byteLength > MAX_ZIP_SIZE) throw new ZipImportError("ZIP file exceeds the 20 MB limit");
  const source = new Uint8Array(bytes);
  if (source[0] !== 0x50 || source[1] !== 0x4b)
    throw new ZipImportError("Please select a ZIP file");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(source);
  } catch {
    throw new ZipImportError("ZIP file is corrupt, encrypted, or unsupported");
  }
  const paths = Object.keys(files);
  if (paths.length > MAX_ENTRIES) throw new ZipImportError("ZIP contains too many files");
  let expanded = 0;
  const entries: ArchiveEntry[] = [];
  for (const rawPath of paths) {
    if (rawPath.endsWith("/")) continue;
    const path = normalizePath(rawPath);
    const body = files[rawPath];
    expanded += body.byteLength;
    if (expanded > MAX_EXPANDED_BYTES)
      throw new ZipImportError("ZIP expands beyond the 100 MB limit");
    const ext = extension(path);
    const kind: ArchiveEntry["kind"] = isIgnored(path)
      ? "ignored"
      : ext === ".md"
        ? "markdown"
        : ext === ".csv"
          ? "csv"
          : IMAGE_TYPES[ext]
            ? "image"
            : "ignored";
    entries.push({ path, bytes: body, extension: ext, kind });
  }
  if (!entries.some((entry) => entry.kind === "markdown" || entry.kind === "csv")) {
    throw new ZipImportError(`No Markdown or CSV files found in ${fileName}`);
  }
  return entries;
}

export function parseImport(fileName: string, bytes: ArrayBuffer): ParsedImport {
  const entries = archiveEntries(fileName, bytes);
  const skipped = entries
    .filter((entry) => entry.kind === "ignored" && !isIgnored(entry.path))
    .map((entry) => entry.path);
  const contentEntries = entries.filter(
    (entry): entry is ArchiveEntry & { kind: ContentKind } =>
      entry.kind === "markdown" || entry.kind === "csv",
  );
  const topDirectories = [
    ...new Set(
      entries
        .filter((entry) => entry.kind !== "ignored" && entry.path.includes("/"))
        .map((entry) => entry.path.split("/")[0]),
    ),
  ];
  const rootDirectory = topDirectories.length === 1 ? topDirectories[0] : null;
  const stripRoot = (path: string) =>
    rootDirectory && path.startsWith(`${rootDirectory}/`)
      ? path.slice(rootDirectory.length + 1)
      : path;
  const normalizedContent = contentEntries.map((entry) => ({
    ...entry,
    path: stripRoot(entry.path),
  }));
  const folderPaths = new Set<string>();
  for (const entry of entries.filter((entry) => entry.kind !== "ignored")) {
    const path = stripRoot(entry.path);
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1)
      folderPaths.add(parts.slice(0, depth).join("/"));
  }
  const contentByFolder = new Map<string, (typeof normalizedContent)[number]>();
  for (const entry of normalizedContent) {
    const parent = dirname(entry.path);
    const candidate = parent
      ? `${parent}/${cleanTitle(basename(entry.path))}`
      : cleanTitle(basename(entry.path));
    if (folderPaths.has(candidate)) contentByFolder.set(candidate, entry);
  }
  const rootContent = normalizedContent.find(
    (entry) =>
      rootDirectory &&
      !entry.path.includes("/") &&
      cleanTitle(basename(entry.path)) === cleanTitle(rootDirectory),
  );
  let rootContentTitle: string | null = null;
  if (rootContent) {
    try {
      rootContentTitle = firstHeading(
        new TextDecoder("utf-8", { fatal: true }).decode(rootContent.bytes),
      );
    } catch {
      skipped.push(`${rootContent.path} (not valid UTF-8)`);
    }
  }
  const rootTitle =
    rootContentTitle ||
    (rootContent ? cleanTitle(basename(rootContent.path)) : null) ||
    (rootDirectory ? cleanTitle(rootDirectory) : cleanTitle(fileName));
  const pages = new Map<string, PagePlan>();
  pages.set("", {
    key: "",
    title: rootTitle || "Imported Wiki",
    parentKey: null,
    sortOrder: 0,
    content: "",
  });
  const folderKeys = [...folderPaths].sort();
  for (const folderPath of folderKeys) {
    const content = contentByFolder.get(folderPath);
    const parentFolder = dirname(folderPath);
    pages.set(folderPath, {
      key: folderPath,
      sourcePath: content?.path,
      title: content ? "" : cleanTitle(basename(folderPath)),
      parentKey: parentFolder || "",
      sortOrder: 0,
      content: "",
    });
  }
  for (const entry of normalizedContent) {
    let key = entry.path;
    if (rootContent?.path === entry.path) key = "";
    else {
      const candidate = `${dirname(entry.path) ? `${dirname(entry.path)}/` : ""}${cleanTitle(basename(entry.path))}`;
      if (contentByFolder.get(candidate)?.path === entry.path) key = candidate;
    }
    const existing = pages.get(key);
    if (!existing) {
      pages.set(key, {
        key,
        sourcePath: entry.path,
        title: "",
        parentKey: dirname(entry.path) || "",
        sortOrder: 0,
        content: "",
      });
    } else {
      existing.sourcePath = entry.path;
    }
  }
  if (pages.size > MAX_PAGES) throw new ZipImportError("ZIP would create too many wiki pages");
  const pageList = [...pages.values()].sort((a, b) => a.key.localeCompare(b.key));
  const textDecoder = new TextDecoder("utf-8", { fatal: true });
  for (const page of pageList) {
    if (!page.sourcePath) continue;
    const entry = normalizedContent.find((value) => value.path === page.sourcePath);
    if (!entry) continue;
    try {
      const text = textDecoder.decode(entry.bytes);
      page.content = entry.kind === "csv" ? csvToMarkdown(text) : text;
      page.title = firstHeading(page.content) || cleanTitle(basename(entry.path));
    } catch {
      page.content = "";
      page.title ||= cleanTitle(basename(entry.path));
      skipped.push(`${entry.path} (could not be imported)`);
    }
  }
  const images: ImagePlan[] = [];
  for (const entry of entries.filter((value) => value.kind === "image")) {
    const path = stripRoot(entry.path);
    if (entry.bytes.byteLength > MAX_IMAGE_SIZE) {
      skipped.push(`${path} (image exceeds 10 MB)`);
      continue;
    }
    let ownerKey = "";
    let candidate = dirname(path);
    while (candidate) {
      if (pages.has(candidate)) {
        ownerKey = candidate;
        break;
      }
      candidate = dirname(candidate);
    }
    images.push({ path, bytes: entry.bytes, mimeType: IMAGE_TYPES[entry.extension], ownerKey });
  }
  let sort = 0;
  for (const page of pageList) page.sortOrder = sort++;
  return {
    pages: pageList,
    images,
    rootDirectory,
    preview: {
      rootTitle,
      pageCount: pageList.length,
      folderCount: folderKeys.length,
      markdownCount: normalizedContent.filter((entry) => entry.kind === "markdown").length,
      csvCount: normalizedContent.filter((entry) => entry.kind === "csv").length,
      imageCount: images.length,
      skipped,
    },
  };
}

export function previewZipImport(fileName: string, bytes: ArrayBuffer): ZipImportPreview {
  return parseImport(fileName, bytes).preview;
}
