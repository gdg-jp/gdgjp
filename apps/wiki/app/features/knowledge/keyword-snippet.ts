export function matchSnippet(fields: readonly string[], terms: readonly string[]): string {
  const [first] = terms;
  if (!first) return "";
  for (const field of fields) {
    const text = field
      .replace(/[（(]\s*source:\s*[A-Za-z0-9_-]+\s*[）)]/g, "")
      .replace(/\(?sourceId:\s*[A-Za-z0-9_-]+\)?/g, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
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
