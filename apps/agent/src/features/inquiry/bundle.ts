import type { PageRead, SearchResult } from "./wiki";

export const MAX_BUNDLE_PAGES = 8;

/**
 * The answer bundle the runner sees. Page bodies are ONLY the wiki's `/api/agent/page`
 * output (already redacted for the reader); raw hits contribute only the search snippet
 * (`hit.text`), never a document — there is no raw-read API for agents.
 */
export function buildBundle(input: {
  question: string;
  search: SearchResult;
  pages: readonly PageRead[];
  indexes: readonly PageRead[];
}): Record<string, string> {
  const files: Record<string, string> = {};
  files["question.md"] = `${input.question.trim()}\n`;
  files["INSTRUCTIONS.md"] = INSTRUCTIONS;
  for (const index of input.indexes) files[`index/${index.space}.md`] = pageFile(index);
  input.pages.forEach((page, i) => {
    files[`hits/${String(i + 1).padStart(2, "0")}-${page.space}-${safe(page.slug)}.md`] =
      pageFile(page);
  });
  input.search.raw.forEach((hit, i) => {
    files[`raw/${String(i + 1).padStart(2, "0")}-${hit.space}-${safe(hit.sourceId)}.md`] =
      `---\nsource: ${JSON.stringify(hit.source)}\ntitle: ${JSON.stringify(hit.title)}\nurl: ${JSON.stringify(hit.url ?? "")}\n---\n\n${hit.snippet}\n`;
  });
  return files;
}

function pageFile(page: PageRead): string {
  return `---\nspace: ${page.space}\nslug: ${JSON.stringify(page.slug)}\ntitle: ${JSON.stringify(page.title)}\nurl: ${JSON.stringify(page.url)}\n---\n\n${page.content}\n`;
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60);
}

/** Every URL the runner may cite: pages and raw hits that are in the bundle. */
export function bundleUrls(search: SearchResult, pages: readonly PageRead[]): string[] {
  return [
    ...new Set([
      ...pages.map((page) => page.url),
      ...search.raw.map((hit) => hit.url).filter((u): u is string => !!u),
    ]),
  ];
}

const INSTRUCTIONS = `Answer \`question.md\` from this bundle (and the wiki MCP tools if available).

- Read \`index/\` first, then \`hits/\`. \`raw/\` are short excerpts: use them to confirm, cite pages first.
- Use page URLs exactly as given; never guess pages that are not in the bundle or tool results.
- Do not retry a page that returned not found.
- Never state something without a citation. If the answer is not here, set "unanswered": true
  and say "the pages readable here do not cover …" — never that the wiki has no such information:
  the bundle holds only what this reader may see, and other pages may exist.
- Answer in the language of the question. Keep it under 1500 characters.
- Output JSON only: {"answer": string, "citations": [{"url": string, "quote": string}],
  "confidence": "high" | "medium" | "low", "unanswered": boolean}.
`;
