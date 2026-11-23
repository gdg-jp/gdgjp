export function wikiPagePath(slugSegments: readonly string[], spaceSlug = "gdg-jp"): string {
  return `/s/${encodeURIComponent(spaceSlug)}/wiki/${slugSegments.map(encodeURIComponent).join("/")}`;
}

export function wikiPageActionPath(
  leafSlug: string,
  action: "edit" | "history",
  spaceSlug = "gdg-jp",
): string {
  return `/s/${encodeURIComponent(spaceSlug)}/wiki/${encodeURIComponent(leafSlug)}/${action}`;
}

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
