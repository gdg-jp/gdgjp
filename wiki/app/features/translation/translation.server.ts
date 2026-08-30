import { canonicalMarkdown } from "~/features/editor/content-format";

export interface TranslatePageInput {
  contentJa: string;
  summaryJa: string;
  titleJa: string;
}

export interface TranslatedPage {
  contentEn: string;
  summaryEn: string;
  titleEn: string;
}

export interface TranslationStats {
  cacheHits: number;
  cacheMisses: number;
}

export interface TranslationSegmentStore {
  getMany(cacheKeys: string[]): Promise<Map<string, string>>;
  put(cacheKey: string, translatedText: string): Promise<void>;
}

export type TranslationSegmentTranslator = (text: string, cacheKey: string) => Promise<string>;

interface TranslationSegment {
  cacheSource: string;
  text: string;
}

interface PreparedText {
  segments: TranslationSegment[];
  render(translations: string[]): string;
}

type RenderPart = { literal: string } | { segmentIndex: number };

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;
const FORMAT_VERSION = "2026-08-30.markdown.v2";
const TRANSLATION_PROMPT_VERSION = FORMAT_VERSION;

function sha256(value: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

function linkEnd(value: string, start: number): { labelEnd: number; linkEnd: number } | undefined {
  const labelStart = value.startsWith("![", start) ? start + 2 : start + 1;
  let bracketDepth = 0;
  for (let labelEnd = labelStart; labelEnd < value.length; labelEnd += 1) {
    if (value[labelEnd] === "\\") {
      labelEnd += 1;
      continue;
    }
    if (value[labelEnd] === "[") bracketDepth += 1;
    if (value[labelEnd] !== "]") continue;
    if (bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (value[labelEnd + 1] !== "(") return undefined;
    let depth = 1;
    let end = labelEnd + 2;
    for (; end < value.length; end += 1) {
      if (value[end] === "\\") {
        end += 1;
        continue;
      }
      if (value[end] === "(") depth += 1;
      if (value[end] === ")") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          return { labelEnd, linkEnd: end };
        }
      }
    }
  }
  return undefined;
}

function tokenizeInline(value: string, segments: TranslationSegment[]): RenderPart[] {
  const parts: RenderPart[] = [];
  const literal = (text: string) => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous && "literal" in previous) previous.literal += text;
    else parts.push({ literal: text });
  };
  const text = (source: string) => {
    if (!source) return;
    if (!JAPANESE_TEXT.test(source)) {
      literal(source);
      return;
    }
    parts.push({ segmentIndex: segments.length });
    segments.push({ cacheSource: source, text: source });
  };

  let cursor = 0;
  let proseStart = 0;
  const flushProse = () => {
    text(value.slice(proseStart, cursor));
  };

  while (cursor < value.length) {
    if (value[cursor] === "`") {
      const delimiter = /^`+/u.exec(value.slice(cursor))?.[0] ?? "`";
      const end = value.indexOf(delimiter, cursor + delimiter.length);
      if (end !== -1) {
        flushProse();
        const tokenEnd = end + delimiter.length;
        literal(value.slice(cursor, tokenEnd));
        cursor = tokenEnd;
        proseStart = cursor;
        continue;
      }
    }
    if (value.startsWith("<!--", cursor)) {
      const commentStart = cursor;
      const end = value.indexOf("-->", cursor + 4);
      if (end !== -1) {
        flushProse();
        cursor = end + 3;
        literal(value.slice(commentStart, cursor));
        proseStart = cursor;
        continue;
      }
    }
    if (value[cursor] === "<") {
      const tag = /^<\/?[A-Za-z][^>]*>/u.exec(value.slice(cursor))?.[0];
      if (tag) {
        flushProse();
        literal(tag);
        cursor += tag.length;
        proseStart = cursor;
        continue;
      }
    }
    if (value[cursor] === "[" || value.startsWith("![", cursor)) {
      const match = linkEnd(value, cursor);
      if (match) {
        flushProse();
        const openerLength = value.startsWith("![", cursor) ? 2 : 1;
        literal(value.slice(cursor, cursor + openerLength));
        parts.push(...tokenizeInline(value.slice(cursor + openerLength, match.labelEnd), segments));
        literal(value.slice(match.labelEnd, match.linkEnd));
        cursor = match.linkEnd;
        proseStart = cursor;
        continue;
      }
    }
    if (value.startsWith("https://", cursor) || value.startsWith("http://", cursor)) {
      flushProse();
      const match = /^https?:\/\/[^\s<]+/u.exec(value.slice(cursor))?.[0] ?? "";
      literal(match);
      cursor += match.length;
      proseStart = cursor;
      continue;
    }
    if (value[cursor] === "\\") {
      flushProse();
      literal(value.slice(cursor, cursor + 2));
      cursor += 2;
      proseStart = cursor;
      continue;
    }
    if ("*_~|[]".includes(value[cursor])) {
      flushProse();
      const marker = /^[*_~|\[\]]+/u.exec(value.slice(cursor))?.[0] ?? value[cursor];
      literal(marker);
      cursor += marker.length;
      proseStart = cursor;
      continue;
    }
    cursor += 1;
  }
  flushProse();
  return parts;
}

/** Keeps Markdown syntax local and exposes only visible plain text to the translator. */
function prepareMarkdownLine(
  line: string,
  segments: TranslationSegment[],
): RenderPart[] | undefined {
  if (!JAPANESE_TEXT.test(line)) return undefined;
  const prefixMatch = /^(\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+))/u.exec(line);
  const prefix = prefixMatch?.[1] ?? "";
  const parts: RenderPart[] = [];
  if (prefix) parts.push({ literal: prefix });
  parts.push(...tokenizeInline(line.slice(prefix.length), segments));
  return parts.some((part) => "segmentIndex" in part) ? parts : undefined;
}

export function prepareMarkdownTranslation(markdown: string): PreparedText {
  const canonical = canonicalMarkdown(markdown);
  const lines = canonical.split("\n");
  const partsByLine = new Map<number, RenderPart[]>();
  const segments: TranslationSegment[] = [];
  let fence: "```" | "~~~" | undefined;
  let frontMatter = lines[0]?.trim() === "---";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (frontMatter) {
      if (index > 0 && line.trim() === "---") frontMatter = false;
      continue;
    }
    const fenceMatch = /^\s{0,3}(```|~~~)/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] as "```" | "~~~";
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence || /^\s*<[^>]+>\s*$/u.test(line)) continue;

    const parts = prepareMarkdownLine(line, segments);
    if (parts) partsByLine.set(index, parts);
  }

  return {
    segments,
    render(translations: string[]): string {
      if (translations.length !== segments.length) {
        throw new Error("Translation segment count does not match the prepared Markdown.");
      }
      return lines
        .map((line, index) => {
          const parts = partsByLine.get(index);
          if (!parts) return line;
          return parts
            .map((part) => ("literal" in part ? part.literal : translations[part.segmentIndex]))
            .join("");
        })
        .join("\n");
    },
  };
}

export async function translationSourceHash(input: TranslatePageInput): Promise<string> {
  return sha256(
    JSON.stringify({
      titleJa: input.titleJa,
      summaryJa: input.summaryJa,
      contentJa: canonicalMarkdown(input.contentJa),
    }),
  );
}

async function translatePrepared(
  prepared: PreparedText,
  modelId: string,
  translator: TranslationSegmentTranslator,
  store?: TranslationSegmentStore,
): Promise<{ text: string; stats: TranslationStats }> {
  const translations: string[] = [];
  const stats = { cacheHits: 0, cacheMisses: 0 };
  const cacheKeys = await Promise.all(
    prepared.segments.map((segment) =>
      sha256(`${FORMAT_VERSION}\n${modelId}\nja\nen\n${segment.cacheSource}`),
    ),
  );
  const cachedSegments = store ? await store.getMany(cacheKeys) : new Map<string, string>();
  for (let index = 0; index < prepared.segments.length; index += 1) {
    const segment = prepared.segments[index];
    const cacheKey = cacheKeys[index];
    const cached = cachedSegments.get(cacheKey);
    if (cached !== undefined) {
      translations.push(cached);
      stats.cacheHits += 1;
      continue;
    }
    const translated = await translator(segment.text, cacheKey);
    await store?.put(cacheKey, translated);
    cachedSegments.set(cacheKey, translated);
    translations.push(translated);
    stats.cacheMisses += 1;
  }
  return { text: prepared.render(translations), stats };
}

/** Provider-neutral page translation with durable segment-level reuse. */
export async function translatePage(
  input: TranslatePageInput,
  options: {
    modelId: string;
    translator: TranslationSegmentTranslator;
    store?: TranslationSegmentStore;
  },
): Promise<TranslatedPage & { stats: TranslationStats }> {
  // Keep calls sequential: it avoids duplicate misses when title/summary/body share a segment and
  // prevents a burst of concurrent requests from briefly overshooting the Gateway spend limit.
  const title = await translatePrepared(
    prepareMarkdownTranslation(input.titleJa),
    options.modelId,
    options.translator,
    options.store,
  );
  const summary = await translatePrepared(
    prepareMarkdownTranslation(input.summaryJa),
    options.modelId,
    options.translator,
    options.store,
  );
  const content = await translatePrepared(
    prepareMarkdownTranslation(input.contentJa),
    options.modelId,
    options.translator,
    options.store,
  );
  return {
    titleEn: title.text,
    summaryEn: summary.text,
    contentEn: content.text,
    stats: {
      cacheHits: title.stats.cacheHits + summary.stats.cacheHits + content.stats.cacheHits,
      cacheMisses: title.stats.cacheMisses + summary.stats.cacheMisses + content.stats.cacheMisses,
    },
  };
}

export { FORMAT_VERSION, TRANSLATION_PROMPT_VERSION };
