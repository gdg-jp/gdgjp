/** Build a browser URL for a wiki page from root→leaf slug segments. */
export function wikiPagePath(slugSegments: readonly string[]): string {
  return `/wiki/${slugSegments.map(encodeURIComponent).join("/")}`;
}

/**
 * Classify a requested wiki path against the page's canonical ancestor chain.
 *
 * - exact match → render
 * - bare flat slug (length 1) for a nested page → 301 to canonical
 * - anything else (wrong / partial / reordered segments) → 404
 */
export function classifyWikiRequestPath(
  requested: readonly string[],
  canonical: readonly string[],
): "match" | "redirect" | "not-found" {
  if (
    requested.length === canonical.length &&
    requested.every((segment, i) => segment === canonical[i])
  ) {
    return "match";
  }
  if (requested.length === 1) {
    return "redirect";
  }
  return "not-found";
}
