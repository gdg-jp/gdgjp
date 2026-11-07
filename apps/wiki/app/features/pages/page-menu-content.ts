import { marked } from "marked";

export function displayedMarkdown(
  content: { contentJa: string; contentEn: string },
  lang: "ja" | "en",
) {
  const primary = lang === "en" ? content.contentEn : content.contentJa;
  return primary.trim() ? primary : lang === "en" ? content.contentJa : content.contentEn;
}

/**
 * Agent-written pages repeat the title as a leading `# Heading`; the reader already shows the
 * title above the body, so that first heading is dropped when it says the same thing.
 */
export function stripLeadingTitleHeading(markdown: string, title: string): string {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(markdown);
  if (!match) return markdown;
  const normalize = (text: string) => text.replace(/\s+/g, "").toLowerCase();
  if (normalize(match[1]) !== normalize(title)) return markdown;
  return markdown.slice(match[0].length).replace(/^\s*\n/, "");
}

type SourceRef = { sourceId: string | null; url: string; title: string };

/**
 * Agent pages cite their provenance inline as `(source: <id>)`. Known ids become a link to the
 * source (with its title as tooltip); unknown ids point at the page's source list.
 */
export function linkInlineSourceRefs(
  markdown: string,
  refs: readonly SourceRef[],
  label: string,
): string {
  const byId = new Map(refs.filter((ref) => ref.sourceId).map((ref) => [ref.sourceId, ref]));
  return markdown.replace(
    /[（(]\s*source:\s*([A-Za-z0-9_-]{6,})\s*[）)]/g,
    (_whole, id: string) => {
      const ref = byId.get(id);
      if (!ref) return `[${label}](#page-sources)`;
      const title = ref.title.replace(/["\\]/g, "").slice(0, 120);
      return `[${label}](${ref.url} "${title}")`;
    },
  );
}

/** Preserve source Markdown, including code examples, while remapping local URLs. */
export function rewriteCopiedLinks(markdown: string, links: Map<string, string>, origin: string) {
  const paths = new Map(
    [...links].map(([source, destination]) => [
      new URL(source, origin).pathname,
      new URL(destination, origin).pathname,
    ]),
  );
  const rewrite = (text: string) =>
    text.replace(
      /(?:https?:\/\/[^\s<>()[\]"']+|\/(?:wiki|api\/images)\/[^\s<>()[\]"']+)/g,
      (raw) => {
        let url: URL;
        try {
          url = new URL(raw, origin);
        } catch {
          return raw;
        }
        if (url.origin !== origin) return raw;
        const replacement = paths.get(url.pathname);
        return replacement ? `${replacement}${url.search}${url.hash}` : raw;
      },
    );
  return marked
    .lexer(markdown)
    .map((token) =>
      token.type === "code"
        ? token.raw
        : token.raw
            .split(/(`+[^`]*`+)/g)
            .map((part) => (part.startsWith("`") ? part : rewrite(part)))
            .join(""),
    )
    .join("");
}
