/** Limits for a single website HTML+CSS capture. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_CSS_BYTES = 2 * 1024 * 1024;
export { MAX_WEBSITE_STYLESHEETS as MAX_STYLESHEETS } from "./subrequest-budget";

const TITLE_RE = /<title\b[^>]*>([^<]*)<\/title>/i;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const REL_ATTR_RE = /(?:^|\s)rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF_ATTR_RE = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const CSS_IMPORT_RE =
  /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)|"([^"]+)"|'([^']+)')[^;]*;/gi;

/** Resolve a possibly-relative href against a page URL. Returns null for non-http(s). */
export function resolveHttpUrl(base: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Extract the document title from HTML, if present. */
export function extractHtmlTitle(html: string): string | null {
  const match = TITLE_RE.exec(html);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title || null;
}

function attrValue(tag: string, pattern: RegExp): string | null {
  const match = pattern.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function isStylesheetLink(tag: string): boolean {
  const rel = attrValue(tag, REL_ATTR_RE);
  if (!rel) return false;
  return rel.toLowerCase().split(/\s+/).includes("stylesheet");
}

/**
 * Collect absolute stylesheet URLs referenced by `<link rel="stylesheet">` tags.
 * Order is document order; duplicates are kept once (first wins).
 */
export function extractStylesheetUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  LINK_TAG_RE.lastIndex = 0;
  let match = LINK_TAG_RE.exec(html);
  while (match) {
    const tag = match[0];
    if (isStylesheetLink(tag)) {
      const href = attrValue(tag, HREF_ATTR_RE);
      if (href) {
        const absolute = resolveHttpUrl(pageUrl, href);
        if (absolute && !seen.has(absolute)) {
          seen.add(absolute);
          urls.push(absolute);
        }
      }
    }
    match = LINK_TAG_RE.exec(html);
  }
  return urls;
}

/**
 * Rewrite stylesheet `href` attributes whose resolved URL is in `urlToPath`.
 * Only `<link rel="stylesheet">` tags are rewritten.
 */
export function rewriteStylesheetHrefs(
  html: string,
  pageUrl: string,
  urlToPath: ReadonlyMap<string, string>,
): string {
  return html.replace(LINK_TAG_RE, (tag) => {
    if (!isStylesheetLink(tag)) return tag;
    const href = attrValue(tag, HREF_ATTR_RE);
    if (!href) return tag;
    const absolute = resolveHttpUrl(pageUrl, href);
    if (!absolute) return tag;
    const replacement = urlToPath.get(absolute);
    if (!replacement) return tag;
    return tag.replace(HREF_ATTR_RE, ` href="${replacement}"`);
  });
}

/** Extract absolute `@import` URLs from a CSS stylesheet (one pass). */
export function extractCssImportUrls(css: string, stylesheetUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  CSS_IMPORT_RE.lastIndex = 0;
  let match = CSS_IMPORT_RE.exec(css);
  while (match) {
    const href = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (href) {
      const absolute = resolveHttpUrl(stylesheetUrl, href);
      if (absolute && !seen.has(absolute)) {
        seen.add(absolute);
        urls.push(absolute);
      }
    }
    match = CSS_IMPORT_RE.exec(css);
  }
  return urls;
}

/** Rewrite `@import` references whose resolved URL is in `urlToPath`. */
export function rewriteCssImports(
  css: string,
  stylesheetUrl: string,
  urlToPath: ReadonlyMap<string, string>,
): string {
  return css.replace(CSS_IMPORT_RE, (statement, ...groups: Array<string | undefined>) => {
    const href = groups[0] ?? groups[1] ?? groups[2] ?? groups[3] ?? groups[4];
    if (!href) return statement;
    const absolute = resolveHttpUrl(stylesheetUrl, href);
    if (!absolute) return statement;
    const replacement = urlToPath.get(absolute);
    if (!replacement) return statement;
    return statement.replace(href, replacement);
  });
}
