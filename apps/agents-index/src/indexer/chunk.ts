export type MarkdownChunk = {
  startLine: number;
  endLine: number;
  text: string;
};

const FRONT_MATTER = /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;
const HEADING = /^#{1,6}\s+/;

/** Split body markdown on headings while keeping chunks useful to an embedding model. */
export function chunkMarkdown(markdown: string, minChars = 200, maxChars = 800): MarkdownChunk[] {
  const body = markdown.replace(FRONT_MATTER, "");
  const frontMatterLines = markdown.slice(0, markdown.length - body.length).split("\n").length - 1;
  const lines = body.split("\n");
  const chunks: MarkdownChunk[] = [];
  let current: string[] = [];
  let start = 1;

  const flush = () => {
    const lines = [...current];
    while (lines.at(-1)?.trim() === "") lines.pop();
    const text = lines.join("\n").trim();
    if (text)
      chunks.push({
        startLine: frontMatterLines + start,
        endLine: frontMatterLines + start + lines.length - 1,
        text,
      });
    current = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const prospective = [...current, line].join("\n");
    if (current.length > 0 && (HEADING.test(line) || prospective.length > maxChars)) {
      if (
        prospective.length > maxChars &&
        current.join("\n").length < minChars &&
        !HEADING.test(line)
      ) {
        // A long paragraph is still more useful as one coherent chunk than a tiny fragment.
      } else {
        flush();
        start = index + 1;
      }
    }
    current.push(line);
  }
  flush();
  return chunks;
}
