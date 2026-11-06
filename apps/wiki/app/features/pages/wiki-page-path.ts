/**
 * Build a browser URL for a wiki page from root→leaf slug segments. Pages live in a space;
 * omitting the space slug means the migrated default space `gdg-jp`.
 */
export function wikiPagePath(slugSegments: readonly string[], spaceSlug = "gdg-jp"): string {
  return `/s/${encodeURIComponent(spaceSlug)}/wiki/${slugSegments.map(encodeURIComponent).join("/")}`;
}

/** Edit / history screens are keyed by the leaf slug inside a space. */
export function wikiPageActionPath(
  leafSlug: string,
  action: "edit" | "history",
  spaceSlug = "gdg-jp",
): string {
  return `/s/${encodeURIComponent(spaceSlug)}/wiki/${encodeURIComponent(leafSlug)}/${action}`;
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
