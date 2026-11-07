/**
 * A short window of text around the first term, from the first field that contains it, with
 * Markdown noise stripped. Empty when the terms only match the title.
 */
export function matchSnippet(fields: readonly string[], terms: readonly string[]): string {
  const [first] = terms;
  if (!first) return "";
  for (const field of fields) {
    const text = field
      // links and images keep their text, lose their targets
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/[#>*_`|\-[\]]{1,}/g, " ")
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
