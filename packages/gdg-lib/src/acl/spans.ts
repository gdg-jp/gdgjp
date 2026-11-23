import type { AclSpan } from "./types";
export type { AclSpan } from "./types";

const REDACTION = "⬛︎⬛︎⬛︎";

const OPEN_TAG_RE = /<acl\b([^>]*)>/gi;
const CLOSE_TAG = "</acl>";

type Attrs = { src: string | null; level: string | null; error: string | null };

function parseAttrs(raw: string): Attrs {
  let src: string | null = null;
  let level: string | null = null;
  const attrRe = /\b(src|level)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of raw.matchAll(attrRe)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "src") {
      if (src !== null) return { src: null, level: null, error: "acl_malformed" };
      src = value;
    } else if (name === "level") {
      if (level !== null) return { src: null, level: null, error: "acl_malformed" };
      level = value;
    }
  }
  if ((src === null) === (level === null)) {
    return { src: null, level: null, error: "acl_malformed" };
  }
  if (src !== null) {
    const ids = src
      .trim()
      .split(/\s+/)
      .filter((id) => id.length > 0);
    if (ids.length === 0) return { src: null, level: null, error: "acl_malformed" };
  }
  if (level !== null && level.trim() === "") {
    return { src: null, level: null, error: "acl_malformed" };
  }
  return { src, level, error: null };
}

function codeFenceRanges(markdown: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < markdown.length) {
    const open = markdown.indexOf("```", i);
    if (open < 0) break;
    const close = markdown.indexOf("```", open + 3);
    if (close < 0) {
      ranges.push({ start: open, end: markdown.length });
      break;
    }
    ranges.push({ start: open, end: close + 3 });
    i = close + 3;
  }
  return ranges;
}

function inRanges(index: number, ranges: readonly { start: number; end: number }[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function lineBounds(markdown: string, index: number): { lineStart: number; lineEnd: number } {
  const lineStart = markdown.lastIndexOf("\n", index - 1) + 1;
  const nextNl = markdown.indexOf("\n", index);
  const lineEnd = nextNl < 0 ? markdown.length : nextNl;
  return { lineStart, lineEnd };
}

function isAloneOnLine(markdown: string, start: number, end: number): boolean {
  const { lineStart, lineEnd } = lineBounds(markdown, start);
  return (
    markdown.slice(lineStart, start).trim() === "" && markdown.slice(end, lineEnd).trim() === ""
  );
}

type ParseResult =
  | { ok: true; spans: AclSpan[] }
  | { ok: false; error: "acl_malformed"; spans: AclSpan[] };

function walkAclSpans(markdown: string, strict: boolean): ParseResult {
  const fences = codeFenceRanges(markdown);
  const spans: AclSpan[] = [];
  let i = 0;

  while (i < markdown.length) {
    if (inRanges(i, fences)) {
      const fence = fences.find((range) => i >= range.start && i < range.end);
      i = fence ? fence.end : i + 1;
      continue;
    }

    if (markdown.startsWith(CLOSE_TAG, i)) {
      if (strict) return { ok: false, error: "acl_malformed", spans };
      i += CLOSE_TAG.length;
      continue;
    }

    if (!markdown.slice(i).match(/^<acl\b/i)) {
      i += 1;
      continue;
    }

    OPEN_TAG_RE.lastIndex = i;
    const match = OPEN_TAG_RE.exec(markdown);
    if (!match || match.index !== i) {
      i += 1;
      continue;
    }

    const tagStart = match.index;
    const tagEnd = tagStart + match[0].length;
    const attrs = parseAttrs(match[1] ?? "");
    if (attrs.error) {
      if (strict) return { ok: false, error: "acl_malformed", spans };
      i = tagEnd;
      continue;
    }

    let depth = 1;
    let cursor = tagEnd;
    let closeIdx = -1;
    while (cursor < markdown.length) {
      if (inRanges(cursor, fences)) {
        const fence = fences.find((range) => cursor >= range.start && cursor < range.end);
        cursor = fence ? fence.end : cursor + 1;
        continue;
      }
      if (markdown.startsWith(CLOSE_TAG, cursor)) {
        depth -= 1;
        if (depth === 0) {
          closeIdx = cursor;
          break;
        }
        cursor += CLOSE_TAG.length;
        continue;
      }
      if (markdown.slice(cursor).match(/^<acl\b/i)) {
        if (strict) return { ok: false, error: "acl_malformed", spans };
        closeIdx = -2;
        break;
      }
      cursor += 1;
    }

    if (closeIdx === -2) {
      i = tagEnd;
      continue;
    }
    if (closeIdx < 0) {
      if (strict) return { ok: false, error: "acl_malformed", spans };
      i = tagEnd;
      continue;
    }

    let closeEnd = closeIdx + CLOSE_TAG.length;
    const block =
      isAloneOnLine(markdown, tagStart, tagEnd) && isAloneOnLine(markdown, closeIdx, closeEnd);
    const body = markdown.slice(tagEnd, closeIdx);
    const srcIds =
      attrs.src === null
        ? []
        : attrs.src
            .trim()
            .split(/\s+/)
            .filter((id) => id.length > 0);

    if (block && markdown[closeEnd] === "\n") closeEnd += 1;

    spans.push({
      start: tagStart,
      end: closeEnd,
      srcIds,
      level: attrs.level,
      block,
      body: block ? body.replace(/^\n/, "").replace(/\n$/, "") : body,
    });
    i = closeEnd;
  }

  return { ok: true, spans };
}

/**
 * Parse ACL spans. Never throws. Malformed regions are skipped so callers can
 * still inspect whatever well-formed spans were found; use validateAclSpans for
 * rejection.
 */
export function parseAclSpans(markdown: string): AclSpan[] {
  return walkAclSpans(markdown, false).spans;
}

export function aclSpanSourceIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const span of parseAclSpans(markdown)) {
    for (const id of span.srcIds) ids.add(id);
  }
  return [...ids];
}

export function scrubResidualAclMarkup(markdown: string): string {
  if (!/<\/?acl\b/i.test(markdown)) return markdown;
  return markdown.replace(/<\/?acl\b[^>]*>/gi, "").replace(/\n{3,}/g, "\n\n");
}

export function stripAclSpans(markdown: string): string {
  const spans = parseAclSpans(markdown);
  if (spans.length === 0) return scrubResidualAclMarkup(markdown);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += markdown.slice(cursor, span.start);
    if (span.block) {
      const needsLead = out.length > 0 && !out.endsWith("\n");
      out += `${needsLead ? "\n" : ""}${span.body}`;
      if (!out.endsWith("\n")) out += "\n";
    } else {
      out += span.body;
    }
    cursor = span.end;
  }
  out += markdown.slice(cursor);
  return scrubResidualAclMarkup(out);
}

export function removeAclSpans(markdown: string): string {
  const spans = parseAclSpans(markdown);
  if (spans.length === 0) return scrubResidualAclMarkup(markdown);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += markdown.slice(cursor, span.start);
    cursor = span.end;
  }
  out += markdown.slice(cursor);
  return scrubResidualAclMarkup(out.replace(/\n{3,}/g, "\n\n"));
}

/**
 * Redact denied spans. Always strips tags from the output so `<acl` never
 * reaches MdPreview — even when access is allowed, and even for malformed
 * regions the non-strict parser skipped.
 */
export function redactAclSpans(
  markdown: string,
  allow: (span: AclSpan) => boolean,
): { markdown: string; redactedCount: number } {
  const spans = parseAclSpans(markdown);
  if (spans.length === 0) {
    return { markdown: scrubResidualAclMarkup(markdown), redactedCount: 0 };
  }
  let out = "";
  let cursor = 0;
  let redactedCount = 0;
  for (const span of spans) {
    out += markdown.slice(cursor, span.start);
    if (allow(span)) {
      if (span.block) {
        const needsLead = out.length > 0 && !out.endsWith("\n");
        out += `${needsLead ? "\n" : ""}${span.body}`;
        if (!out.endsWith("\n")) out += "\n";
      } else {
        out += span.body;
      }
    } else {
      if (span.block) {
        const needsLead = out.length > 0 && !out.endsWith("\n");
        out += `${needsLead ? "\n" : ""}${REDACTION}\n`;
      } else {
        out += REDACTION;
      }
      redactedCount += 1;
    }
    cursor = span.end;
  }
  out += markdown.slice(cursor);
  return { markdown: scrubResidualAclMarkup(out), redactedCount };
}

export function validateAclSpans(markdown: string): { ok: true } | { ok: false; error: string } {
  const result = walkAclSpans(markdown, true);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export function metadataContainsAclTag(value: string): boolean {
  return /<\/?acl\b/i.test(value);
}

export function computeAclSourceIdsJson(
  contentJa: string | null | undefined,
  contentEn: string | null | undefined,
): string {
  const ids = new Set<string>([
    ...aclSpanSourceIds(contentJa ?? ""),
    ...aclSpanSourceIds(contentEn ?? ""),
  ]);
  return JSON.stringify([...ids].sort());
}

export const ACL_REDACTION_PLACEHOLDER = REDACTION;
