/**
 * A short window of text around the first term, from the first field that contains it, with
 * Markdown noise stripped. Empty when the terms only match the title.
 */
export function matchSnippet(fields: readonly string[], terms: readonly string[]): string {
  const [first] = terms;
  if (!first) return "";
  for (const field of fields) {
    const text = field
      // provenance notes are for the page view, not a search card
      .replace(/[（(]\s*source:\s*[A-Za-z0-9_-]+\s*[）)]/g, "")
      .replace(/\(?sourceId:\s*[A-Za-z0-9_-]+\)?/g, "")
      // links and images keep their text, lose their targets
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      // block markers at line starts, emphasis and table pipes
      .replace(/^\s*(?:[#>]+|[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_`|[\]]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const index = text.toLowerCase().indexOf(first.toLowerCase());
    if (index === -1) continue;
    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + first.length + 80);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }
  return "";
}
