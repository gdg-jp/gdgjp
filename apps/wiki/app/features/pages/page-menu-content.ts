import { marked } from "marked";

export function displayedMarkdown(
  content: { contentJa: string; contentEn: string },
  lang: "ja" | "en",
) {
  const primary = lang === "en" ? content.contentEn : content.contentJa;
  return primary.trim() ? primary : lang === "en" ? content.contentJa : content.contentEn;
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
