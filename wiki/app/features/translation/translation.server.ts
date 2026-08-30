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

interface ProtectedSegment {
  cacheSource: string;
  maskedText: string;
  restore(translatedText: string): string;
}

interface PreparedText {
  segments: ProtectedSegment[];
  render(translations: string[]): string;
}

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;
const PLACEHOLDER_PATTERN = /ZXQPH\d+QXZ/g;
const FORMAT_VERSION = "2026-08-30.markdown.v1";
const TRANSLATION_PROMPT_VERSION = FORMAT_VERSION;

function sha256(value: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let offset = 0;
  let found = value.indexOf(search, offset);
  while (found !== -1) {
    count += 1;
    offset = found + search.length;
    found = value.indexOf(search, offset);
  }
  return count;
}

function protectLinkDestinations(
  value: string,
  protect: (protectedValue: string) => string,
): string {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("](", cursor);
    if (start === -1) return output + value.slice(cursor);
    let depth = 1;
    let end = start + 2;
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
          break;
        }
      }
    }
    if (depth !== 0) return output + value.slice(cursor);
    output += value.slice(cursor, start) + protect(value.slice(start, end));
    cursor = end;
  }
  return output;
}

/** Protects non-prose Markdown tokens while leaving labels and visible prose translatable. */
function protectMarkdownLine(line: string): ProtectedSegment | undefined {
  if (!JAPANESE_TEXT.test(line)) return undefined;

  const protectedValues: string[] = [];
  const protect = (value: string): string => {
    const marker = `ZXQPH${protectedValues.length}QXZ`;
    protectedValues.push(value);
    return marker;
  };

  const prefixMatch = /^(\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+))/u.exec(line);
  const prefix = prefixMatch?.[1] ?? "";
  let prose = line.slice(prefix.length);

  // Order matters: protect large opaque constructs before their punctuation.
  prose = prose.replace(/`+[^`\n]*?`+/g, protect);
  prose = prose.replace(/<\/?acl\b[^>]*>/gi, protect);
  prose = prose.replace(/<!--[\s\S]*?-->/g, protect);
  prose = prose.replace(/<\/?[A-Za-z][^>]*>/g, protect);
  prose = protectLinkDestinations(prose, protect);
  prose = prose.replace(/https?:\/\/[^\s<]+/g, protect);
  prose = prose.replace(/!\[|\[|\]|[*_~]{1,3}|\\./g, protect);
  prose = prose.replace(/\|/g, protect);

  if (!JAPANESE_TEXT.test(prose)) return undefined;
  const expectedMarkers = prose.match(PLACEHOLDER_PATTERN) ?? [];

  return {
    cacheSource: `${prefix}\n${prose}`,
    maskedText: prose,
    restore(translatedText: string): string {
      let previousMarkerOffset = -1;
      for (const marker of expectedMarkers) {
        if (countOccurrences(translatedText, marker) !== 1) {
          throw new Error(`Translation changed protected Markdown marker ${marker}.`);
        }
        const markerOffset = translatedText.indexOf(marker);
        if (markerOffset <= previousMarkerOffset) {
          throw new Error("Translation reordered protected Markdown markers.");
        }
        previousMarkerOffset = markerOffset;
      }
      const unexpected = translatedText.match(PLACEHOLDER_PATTERN) ?? [];
      if (unexpected.length !== expectedMarkers.length) {
        throw new Error("Translation introduced an unexpected Markdown marker.");
      }
      let restored = translatedText;
      for (let index = 0; index < protectedValues.length; index += 1) {
        restored = restored.replace(`ZXQPH${index}QXZ`, protectedValues[index]);
      }
      return `${prefix}${restored}`;
    },
  };
}

export function prepareMarkdownTranslation(markdown: string): PreparedText {
  const canonical = canonicalMarkdown(markdown);
  const lines = canonical.split("\n");
  const segmentByLine = new Map<number, number>();
  const segments: ProtectedSegment[] = [];
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

    const segment = protectMarkdownLine(line);
    if (!segment) continue;
    segmentByLine.set(index, segments.length);
    segments.push(segment);
  }

  return {
    segments,
    render(translations: string[]): string {
      if (translations.length !== segments.length) {
        throw new Error("Translation segment count does not match the prepared Markdown.");
      }
      return lines
        .map((line, index) => {
          const segmentIndex = segmentByLine.get(index);
          return segmentIndex === undefined
            ? line
            : segments[segmentIndex].restore(translations[segmentIndex]);
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
    const translated = await translator(segment.maskedText, cacheKey);
    segment.restore(translated);
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
