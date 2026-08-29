import type { TocItem } from "~/features/pages/components/WikiRightSidebar";

/** Extract level-2/3 Markdown headings for the initial SSR table of contents. */
export function parseMdHeadings(md: string): TocItem[] {
  const lines = md.split("\n");
  return lines.flatMap((line) => {
    const m = line.match(/^(#{1,6}) (.+)/);
    if (!m) return [];
    const level = m[1].length;
    if (level !== 2 && level !== 3) return [];
    const text = m[2].trim();
    return [{ id: text, text, level }];
  });
}
