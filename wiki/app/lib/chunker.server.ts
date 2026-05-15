import { tiptapToMarkdown } from "./tiptap-convert";

export interface ContentChunk {
  text: string;
  pageId: string;
  language: "ja" | "en";
  chunkIndex: number;
  sectionHeading: string | null;
  slug: string;
}

interface ChunkableContent {
  pageId: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  contentJa: string;
  contentEn: string;
}

const MAX_CHUNK_CHARS = 2000;
const MIN_CHUNK_CHARS = 20;
const HEADING_RE = /^#{1,3}\s+(.+)/;

function splitMarkdownBySections(md: string): { heading: string | null; text: string }[] {
  const lines = md.split("\n");
  const sections: { heading: string | null; text: string }[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      if (current.heading !== null || current.lines.length > 0) {
        sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      }
      current = { heading: match[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading !== null || current.lines.length > 0) {
    sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
  }

  return sections;
}

function splitLargeSection(text: string, heading: string | null): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const paragraphs = text.split("\n\n");
  const chunks: string[] = [];
  let buffer = heading ? `## ${heading}\n\n` : "";

  for (const para of paragraphs) {
    if (
      buffer.length + para.length + 2 > MAX_CHUNK_CHARS &&
      buffer.trim().length >= MIN_CHUNK_CHARS
    ) {
      chunks.push(buffer.trim());
      buffer = "";
    }
    buffer += `${para}\n\n`;
  }
  if (buffer.trim().length >= MIN_CHUNK_CHARS) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function chunkLanguage(
  content: string,
  title: string,
  summary: string,
  pageId: string,
  slug: string,
  language: "ja" | "en",
): ContentChunk[] {
  if (!content) return [];

  const md = tiptapToMarkdown(content);
  if (!md.trim()) return [];

  const fullMd = `# ${title}\n\n${summary}\n\n${md}`;
  const sections = splitMarkdownBySections(fullMd);
  const chunks: ContentChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionText = section.heading ? `## ${section.heading}\n\n${section.text}` : section.text;

    if (sectionText.length < MIN_CHUNK_CHARS) continue;

    const parts = splitLargeSection(sectionText, section.heading);
    for (const part of parts) {
      chunks.push({
        text: part,
        pageId,
        language,
        chunkIndex,
        sectionHeading: section.heading,
        slug,
      });
      chunkIndex++;
    }
  }

  return chunks;
}

export function chunkPageContent(page: ChunkableContent): ContentChunk[] {
  const jaChunks = chunkLanguage(
    page.contentJa,
    page.titleJa,
    page.summaryJa,
    page.pageId,
    page.slug,
    "ja",
  );
  const enChunks = chunkLanguage(
    page.contentEn,
    page.titleEn,
    page.summaryEn,
    page.pageId,
    page.slug,
    "en",
  );
  return [...jaChunks, ...enChunks];
}
