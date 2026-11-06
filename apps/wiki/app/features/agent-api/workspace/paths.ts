import { WORKSPACE_LIMITS } from "./contracts";

export function normaliseAbsoluteWorkspacePath(input: string): string {
  if (!input || !input.startsWith("/") || input.includes("\\") || input.includes("\0")) {
    throw new Error("Workspace paths must be absolute POSIX paths");
  }
  const segments = input.split("/").filter(Boolean);
  if (
    segments.length > WORKSPACE_LIMITS.maxPathDepth ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    throw new Error("Workspace path traversal is not allowed");
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** Adapters deliberately cannot receive a path rooted outside their mount. */
export function normaliseRelativeWorkspacePath(input: string): string {
  if (input.startsWith("/") || input.includes("\\") || input.includes("\0")) {
    throw new Error("Workspace adapter paths must be relative");
  }
  const segments = input.split("/").filter(Boolean);
  if (
    segments.length > WORKSPACE_LIMITS.maxPathDepth ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    throw new Error("Workspace path traversal is not allowed");
  }
  return segments.join("/");
}

export function mountedPath(mount: string, relativePath: string): string {
  const normalisedMount = normaliseAbsoluteWorkspacePath(mount);
  const normalisedRelative = normaliseRelativeWorkspacePath(relativePath);
  return normalisedRelative ? `${normalisedMount}/${normalisedRelative}` : normalisedMount;
}

export function splitMountedPath(
  absolutePath: string,
  mounts: readonly string[],
): { mount: string; relativePath: string } | null {
  const path = normaliseAbsoluteWorkspacePath(absolutePath);
  const mount = [...mounts]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => path === candidate || path.startsWith(`${candidate}/`));
  if (!mount) return null;
  return { mount, relativePath: path.slice(mount.length).replace(/^\//, "") };
}

export function boundedLimit(value: number | undefined, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid workspace limit");
  return Math.min(value, maximum);
}

export function cleanQuery(query: string): string {
  const cleaned = query.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("Workspace query must not be empty");
  return cleaned.slice(0, WORKSPACE_LIMITS.maxQueryLength);
}

type OffsetCursor = { offset: number };

export function decodeOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(atob(cursor)) as OffsetCursor;
    if (Number.isSafeInteger(value.offset) && value.offset >= 0) return value.offset;
  } catch {
    // Normalize all malformed cursors to the same public error.
  }
  throw new Error("Invalid workspace cursor");
}

export function encodeOffsetCursor(offset: number): string {
  return btoa(JSON.stringify({ offset } satisfies OffsetCursor));
}
