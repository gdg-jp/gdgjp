/** Pure path / text helpers for ZIP wiki import. No I/O. */

export class ZipImportError extends Error {}

export const IMAGE_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function cleanTitle(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/\s+[a-f\d]{32}$/i, "")
    .trim();
}

export function normalizePath(value: string): string {
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

export function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isIgnored(path: string): boolean {
  return (
    path.startsWith("__MACOSX/") ||
    path.split("/").some((part) => part === ".DS_Store" || part.startsWith("._"))
  );
}

export function firstHeading(markdown: string): string | null {
  const match = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

export function parseCsv(text: string): string[][] {
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

export function csvToMarkdown(text: string): string {
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

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function basename(path: string): string {
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

export function rewriteLinks(
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
