const MAX_SEGMENT_LENGTH = 160;

function segment(value: string): string {
  const normalized = value.normalize("NFKC").replaceAll("/", "_").trim();
  return (normalized || "_").slice(0, MAX_SEGMENT_LENGTH);
}

function canonicalQuery(url: URL): string {
  const sorted = [...url.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
  );
  return new URLSearchParams(sorted).toString();
}

function querySuffix(query: string): string {
  if (!query) return "";
  // Query values can be sensitive and arbitrarily large. Keep them out of the
  // model-visible path while retaining a deterministic collision suffix.
  let hash = 2166136261;
  for (let index = 0; index < query.length; index++) {
    hash ^= query.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `~q-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export interface WebsiteWorkspacePath {
  canonicalUrl: string;
  path: string;
  parentPath: string;
  title: string;
}

/** Maps a canonical URL to a readable node in the /websites mount. */
export function websiteWorkspacePath(input: string): WebsiteWorkspacePath {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Website workspace only supports HTTP URLs");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  const query = canonicalQuery(url);
  url.search = query;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.pathname = pathname;
  const pathSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((value) => segment(decodeURIComponent(value)));
  const host = segment(url.host);
  const last = pathSegments.at(-1);
  const suffix = querySuffix(query);
  if (last) pathSegments[pathSegments.length - 1] = `${last}${suffix}`;
  else if (suffix) pathSegments.push(suffix.slice(1));
  const path = ["", "websites", host, ...pathSegments].join("/");
  const parts = path.split("/");
  const parentPath = parts.length > 3 ? parts.slice(0, -1).join("/") : "/websites";
  return {
    canonicalUrl: url.toString(),
    path,
    parentPath,
    title: pathSegments.at(-1) ?? host,
  };
}
