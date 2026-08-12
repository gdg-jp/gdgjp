import { unzipSync } from "fflate";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { generateSlug } from "~/features/ingestion/slug";
import { getDb } from "~/lib/db.server";
import { isAutoTranslateEnabled } from "~/lib/queue-processors.server";

export const MAX_ZIP_SIZE = 20 * 1024 * 1024;
const MAX_ENTRIES = 1_000;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

type ContentKind = "markdown" | "csv";

interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
  extension: string;
  kind: ContentKind | "image" | "ignored";
}

interface PagePlan {
  key: string;
  sourcePath?: string;
  title: string;
  parentKey: string | null;
  sortOrder: number;
  content: string;
}

interface ImagePlan {
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

export interface ZipImportResult extends ZipImportPreview {
  rootSlug: string;
  createdPages: number;
  uploadedImages: number;
}

interface ParsedImport {
  preview: ZipImportPreview;
  pages: PagePlan[];
  images: ImagePlan[];
  rootDirectory: string | null;
}

export class ZipImportError extends Error {}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function cleanTitle(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/\s+[a-f\d]{32}$/i, "")
    .trim();
}

function normalizePath(value: string): string {
  const decoded = decodeURIComponentSafe(value).replaceAll("\\", "/");
  if (!decoded || decoded.startsWith("/") || /^[a-z]:/i.test(decoded)) {
    throw new ZipImportError("Archive contains an invalid path");
  }
  const parts = decoded.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ZipImportError("Archive contains an unsafe path");
  }
  return parts.join("/");
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isIgnored(path: string): boolean {
  return (
    path.startsWith("__MACOSX/") ||
    path.split("/").some((part) => part === ".DS_Store" || part.startsWith("._"))
  );
}

function firstHeading(markdown: string): string | null {
  const match = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new ZipImportError("CSV contains an unterminated quoted field");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cellValue) => cellValue.length > 0));
}

function csvToMarkdown(text: string): string {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const format = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? "")).join(" | ")} |`;
  return [
    format(rows[0]),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...rows.slice(1).map(format),
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>").replaceAll("\r", "");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function resolveLocalPath(currentPath: string, href: string): string | null {
  if (!href || href.startsWith("#") || /^(?:[a-z]+:|\/\/)/i.test(href)) return null;
  const [rawPath] = href.split(/[?#]/, 1);
  if (!rawPath) return null;
  const base = `https://zip-import.invalid/${dirname(currentPath)}/`;
  try {
    const resolved = new URL(rawPath, base).pathname.replace(/^\/+|\/+$/g, "");
    if (!resolved) return null;
    return normalizePath(resolved);
  } catch {
    return null;
  }
}

function rewriteLinks(
  markdown: string,
  sourcePath: string,
  pageUrls: Map<string, string>,
  imageUrls: Map<string, string>,
  referencedImages: Set<string>,
): string {
  return markdown.replace(
    /(!?)\[([^\]]*)\]\(([^\s)]+)([^)]*)\)/g,
    (whole, image, label, href, tail) => {
      const localPath = resolveLocalPath(sourcePath, href);
      if (!localPath) return whole;
      const suffixIndex = href.search(/[?#]/);
      const suffix = suffixIndex === -1 ? "" : href.slice(suffixIndex);
      if (image) {
        const url = imageUrls.get(localPath);
        if (!url) return whole;
        referencedImages.add(localPath);
        return `![${label}](${url}${suffix}${tail})`;
      }
      const url = pageUrls.get(localPath);
      return url ? `[${label}](${url}${suffix}${tail})` : whole;
    },
  );
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

function parseImport(fileName: string, bytes: ArrayBuffer): ParsedImport {
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

async function uniqueSlug(env: Env, title: string, reserved: Set<string>): Promise<string> {
  const db = getDb(env);
  const base = generateSlug(title);
  let slug = base;
  while (
    reserved.has(slug) ||
    (await db.query.pages.findFirst({ where: (pages, { eq }) => eq(pages.slug, slug) }))
  ) {
    slug = `${base}-${nanoid(6)}`;
  }
  reserved.add(slug);
  return slug;
}

export async function importZip(
  env: Env,
  userId: string,
  fileName: string,
  bytes: ArrayBuffer,
): Promise<ZipImportResult> {
  const parsed = parseImport(fileName, bytes);
  const db = getDb(env);
  const ids = new Map<string, string>();
  const slugs = new Map<string, string>();
  const reserved = new Set<string>();
  for (const page of parsed.pages) {
    ids.set(page.key, nanoid());
    slugs.set(page.key, await uniqueSlug(env, page.title, reserved));
  }
  const imageUrls = new Map<string, string>();
  const uploadErrors: string[] = [];
  const uploaded: Array<{ image: ImagePlan; r2Key: string }> = [];
  for (const image of parsed.images) {
    const ownerId = ids.get(image.ownerKey) as string;
    const safeName = basename(image.path).replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key = `wiki/${ownerId}/zip-import/${nanoid(8)}-${safeName}`;
    try {
      await env.BUCKET.put(r2Key, image.bytes, { httpMetadata: { contentType: image.mimeType } });
      imageUrls.set(image.path, `/api/images/${r2Key}`);
      if (parsed.rootDirectory)
        imageUrls.set(`${parsed.rootDirectory}/${image.path}`, `/api/images/${r2Key}`);
      uploaded.push({ image, r2Key });
    } catch {
      uploadErrors.push(`${image.path} (upload failed)`);
    }
  }
  const pageUrls = new Map<string, string>();
  for (const page of parsed.pages) {
    const url = `/wiki/${slugs.get(page.key)}`;
    pageUrls.set(page.key, url);
    if (page.sourcePath) pageUrls.set(page.sourcePath, url);
    if (parsed.rootDirectory) {
      if (page.key === "") pageUrls.set(parsed.rootDirectory, url);
      pageUrls.set(`${parsed.rootDirectory}/${page.key}`, url);
      if (page.sourcePath) pageUrls.set(`${parsed.rootDirectory}/${page.sourcePath}`, url);
    }
  }
  const references = new Map<string, Set<string>>();
  for (const page of parsed.pages) {
    if (!page.sourcePath || !page.content) continue;
    const referenced = new Set<string>();
    page.content = rewriteLinks(page.content, page.sourcePath, pageUrls, imageUrls, referenced);
    references.set(page.key, referenced);
  }
  for (const page of parsed.pages) {
    await db.insert(schema.pages).values({
      id: ids.get(page.key) as string,
      titleJa: page.title,
      titleEn: "",
      slug: slugs.get(page.key) as string,
      contentJa: page.content,
      contentEn: "",
      status: "published",
      visibility: "restricted",
      generalRole: "viewer",
      parentId: page.parentKey === null ? null : (ids.get(page.parentKey) ?? null),
      aclSyncedWithParent: page.parentKey === null,
      sortOrder: page.sortOrder,
      origin: "human",
      chapterId: null,
      authorId: userId,
      lastEditedBy: userId,
    });
  }
  for (const { image, r2Key } of uploaded) {
    const attachedTo = new Set<string>([image.ownerKey]);
    for (const [pageKey, referencesForPage] of references) {
      if (
        referencesForPage.has(image.path) ||
        (parsed.rootDirectory && referencesForPage.has(`${parsed.rootDirectory}/${image.path}`))
      ) {
        attachedTo.add(pageKey);
      }
    }
    for (const pageKey of attachedTo) {
      await db.insert(schema.pageAttachments).values({
        id: nanoid(),
        pageId: ids.get(pageKey) as string,
        r2Key,
        fileName: basename(image.path),
        mimeType: image.mimeType,
        createdAt: new Date(),
      });
    }
  }
  if (isAutoTranslateEnabled(env)) {
    for (const page of parsed.pages) {
      try {
        await env.TRANSLATION_QUEUE.send({ pageId: ids.get(page.key) as string });
      } catch {
        // Imported Japanese content remains usable when translation is temporarily unavailable.
      }
    }
  }
  return {
    ...parsed.preview,
    skipped: [...parsed.preview.skipped, ...uploadErrors],
    rootSlug: slugs.get("") as string,
    createdPages: parsed.pages.length,
    uploadedImages: uploaded.length,
  };
}
