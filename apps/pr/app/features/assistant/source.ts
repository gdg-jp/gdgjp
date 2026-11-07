/** Something the assistant reads: a public page, a shared Google file, or an uploaded file. */
export type SourceImage = { id: string; type: string; size: number; src?: string };

export type Source = {
  id: number;
  campaignId: number;
  url: string;
  title: string;
  textKey: string | null;
  images: SourceImage[];
  status: "pending" | "ok" | "error";
  error: string | null;
  fetchedAt: number | null;
  createdBy: string | null;
  createdAt: number;
};

export type GoogleTarget =
  | { kind: "doc"; id: string }
  | { kind: "slides"; id: string }
  | { kind: "sheet"; id: string }
  | { kind: "file"; id: string }
  | { kind: "folder"; id: string };

/** Google Docs / Slides / Sheets / Drive links, by the id in their URL. */
export function googleTarget(raw: string): GoogleTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const path = url.pathname;
  if (url.hostname === "docs.google.com") {
    const m = path.match(/^\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
    if (!m) return null;
    const kind = m[1] === "document" ? "doc" : m[1] === "presentation" ? "slides" : "sheet";
    return { kind, id: m[2] as string };
  }
  if (url.hostname === "drive.google.com") {
    const file = path.match(/^\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get("id");
    if (path.startsWith("/drive/folders/") || path.startsWith("/drive/u/")) {
      const folder = path.match(/folders\/([\w-]+)/)?.[1];
      if (folder) return { kind: "folder", id: folder };
    }
    if (file) return { kind: "file", id: file };
  }
  return null;
}

/** Where the text (and, for Docs, the images) of a Google file can be read without signing in. */
export function googleExportUrl(target: GoogleTarget): string | null {
  switch (target.kind) {
    case "doc":
      return `https://docs.google.com/document/d/${target.id}/export?format=html`;
    case "slides":
      return `https://docs.google.com/presentation/d/${target.id}/export/txt`;
    case "sheet":
      return `https://docs.google.com/spreadsheets/d/${target.id}/export?format=csv`;
    case "file":
      return `https://drive.google.com/uc?export=download&id=${target.id}`;
    default:
      return null;
  }
}

const BLOCK = /<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol|header|footer|br)>|<br\s*\/?>/gi;

/** HTML to readable text: scripts, styles and markup go; block ends become line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(BLOCK, "\n")
      .replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, " [画像: $1] ")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, lines) => line || lines[i - 1])
    .join("\n")
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return named[code.toLowerCase()] ?? whole;
  });
}

export function titleOf(html: string): string {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decodeEntities((og ?? title ?? "").trim()).slice(0, 200);
}

/**
 * Images worth reading on a page: og:image first, then <img> in the body, absolute, without
 * icons, avatars, tracking pixels or SVG. Event pages put the timetable and speakers in images.
 */
export function imagesIn(html: string, base: string, limit = 8): string[] {
  const out: string[] = [];
  const add = (raw: string | undefined) => {
    if (!raw || raw.startsWith("data:")) return;
    let url: string;
    try {
      url = new URL(decodeEntities(raw), base).toString();
    } catch {
      return;
    }
    if (/\.svg(\?|$)|favicon|sprite|avatar|icon|logo|gravatar|pixel|1x1|emoji/i.test(url)) return;
    if (!out.includes(url)) out.push(url);
  };
  add(html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1]);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const width = Number(tag.match(/\bwidth="?(\d+)/i)?.[1] ?? 0);
    if (width && width < 120) continue;
    add(tag.match(/\b(?:data-src|src)="([^"]+)"/i)?.[1]);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/** The text from `from` up to the first `until` after it (both regexes), or "". */
function between(html: string, from: RegExp, until: RegExp): string {
  const start = html.search(from);
  if (start < 0) return "";
  const rest = html.slice(start);
  const end = rest.slice(1).search(until);
  return end < 0 ? rest.slice(0, 200_000) : rest.slice(0, end + 1);
}

/**
 * The parts of a connpass event page that describe the event: title, dates, venue, the
 * participation table without its applicant list, and the description. The rest of the page
 * lists participants, which the assistant must not read.
 */
export function connpassMain(html: string): string | null {
  const description = between(
    html,
    /<span class="icon_gray_desc">/,
    /<h3 class="event_detail_title">|<div class="group_box">\s*<h3/,
  );
  if (!description) return null;
  const times = [
    ...html.matchAll(/<span class="(dtstart|dtend)">\s*<span class="value-title" title="([^"]+)"/g),
  ]
    .map((m) => `${m[1] === "dtstart" ? "開始" : "終了"}（UTC）: ${m[2]}`)
    .join("\n");
  const participation = between(
    html,
    /<div class="group_inner event_ptype_area">/,
    /<\/table>/,
  ).replace(/<div class="participants_area">[\s\S]*?<\/td>/g, "</td>");
  return [
    between(html, /<div class="current_event_title">/, /<\/h2>/),
    `<p>${times}</p>`,
    between(html, /<div class="group_inner event_place_area">/, /<div class="map_image/),
    participation,
    description,
  ].join("\n");
}

/** Contact details never reach the assistant (or R2): emails and phone numbers are masked. */
export function maskContacts(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "［メール］")
    .replace(/(?<!\d)0\d{1,4}-\d{1,4}-\d{3,4}(?!\d)/g, "［電話］");
}
