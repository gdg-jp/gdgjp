import type { GoogleDocsStructuralElement, GoogleDocsTextStyle } from "./drive.server";

/**
 * Inline-level Google Docs → Markdown conversion: text-run styling, smart chips,
 * embedded/inline objects, and paragraph-style CSS. Block-level assembly
 * (paragraphs, tables, tabs, the document walker) lives in `docs-markdown.server.ts`.
 */

export interface GoogleDocsInlineImage {
  objectId: string;
  sourceUrl: string;
  contentType?: string;
  altText?: string;
}

export function escapeMarkdownText(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/([*_`\[\]])/g, "\\$1");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssColor(value: GoogleDocsTextStyle["foregroundColor"]): string | undefined {
  const rgb = value?.color?.rgbColor;
  if (!rgb) return undefined;
  const channel = (part: number | undefined) =>
    Math.round(Math.max(0, Math.min(1, part ?? 0)) * 255);
  return `rgb(${channel(rgb.red)}, ${channel(rgb.green)}, ${channel(rgb.blue)})`;
}

function cssDimension(
  value: { magnitude?: number; unit?: string } | undefined,
): string | undefined {
  if (!value || value.unit !== "PT" || !Number.isFinite(value.magnitude)) return undefined;
  return `${Math.max(0, Math.min(1000, value.magnitude as number))}pt`;
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value || /[\r\n]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function linkDestination(link: GoogleDocsTextStyle["link"]): string | undefined {
  if (!link) return undefined;
  if (link.url) return safeExternalUrl(link.url);
  if (link.tabId) return `google-docs://tab/${encodeURIComponent(link.tabId)}`;
  const bookmarkId = link.bookmark?.id ?? link.bookmarkId;
  if (bookmarkId) {
    const tabId = link.bookmark?.tabId ?? "";
    return `google-docs://bookmark/${encodeURIComponent(tabId)}/${encodeURIComponent(bookmarkId)}`;
  }
  const headingId = link.heading?.id ?? link.headingId;
  if (headingId) {
    const tabId = link.heading?.tabId ?? "";
    return `google-docs://heading/${encodeURIComponent(tabId)}/${encodeURIComponent(headingId)}`;
  }
  return undefined;
}

export function styledText(content: string, style: GoogleDocsTextStyle | undefined): string {
  const text = escapeMarkdownText(content.replace(/\n$/, ""));
  if (!text) return "";
  let result = text;
  if (style?.bold) result = `**${result}**`;
  if (style?.italic) result = `*${result}*`;
  if (style?.strikethrough) result = `~~${result}~~`;
  if (style?.underline) result = `<u>${result}</u>`;
  if (style?.baselineOffset === "SUPERSCRIPT") result = `<sup>${result}</sup>`;
  if (style?.baselineOffset === "SUBSCRIPT") result = `<sub>${result}</sub>`;
  const declarations: string[] = [];
  const foreground = cssColor(style?.foregroundColor);
  const background = cssColor(style?.backgroundColor);
  const fontSize = cssDimension(style?.fontSize);
  const family = style?.weightedFontFamily?.fontFamily;
  const weight = style?.weightedFontFamily?.weight;
  if (foreground) declarations.push(`color:${foreground}`);
  if (background) declarations.push(`background-color:${background}`);
  if (fontSize) declarations.push(`font-size:${fontSize}`);
  if (family && /^[\w .,'-]{1,100}$/.test(family)) declarations.push(`font-family:${family}`);
  if (typeof weight === "number" && weight >= 100 && weight <= 900 && weight % 100 === 0)
    declarations.push(`font-weight:${weight}`);
  if (style?.smallCaps) declarations.push("font-variant:small-caps");
  if (declarations.length) result = `<span style="${declarations.join(";")}">${result}</span>`;
  const destination = linkDestination(style?.link);
  return destination ? `[${result}](${destination.replaceAll(")", "%29")})` : result;
}

export function smartChipLink(
  label: string | undefined,
  url: string | undefined,
  style: GoogleDocsTextStyle | undefined,
): string {
  if (!label) return "";
  const text = styledText(label, style ? { ...style, link: undefined } : undefined);
  const destination = safeExternalUrl(url);
  return destination ? `[${text}](${destination.replaceAll(")", "%29")})` : text;
}

export function imageForObject(
  objectId: string,
  object:
    | {
        title?: string;
        description?: string;
        imageProperties?: { contentUri?: string; contentType?: string };
      }
    | undefined,
): GoogleDocsInlineImage | null {
  const sourceUrl = object?.imageProperties?.contentUri;
  if (!sourceUrl) return null;
  return {
    objectId,
    sourceUrl,
    contentType: object.imageProperties?.contentType,
    altText: object.description || object.title,
  };
}

export function nonImageObject(
  object:
    | {
        title?: string;
        description?: string;
        imageProperties?: { sourceUri?: string };
        linkedContentReference?: {
          sheetsChartReference?: { spreadsheetId?: string; chartId?: number };
        };
      }
    | undefined,
): string {
  const label = object?.title || object?.description || "Google Docs embedded object";
  const source = object?.imageProperties?.sourceUri;
  const chart = object?.linkedContentReference?.sheetsChartReference;
  const destination = safeExternalUrl(source);
  if (destination)
    return `> **Embedded object:** [${escapeMarkdownText(label)}](${destination.replaceAll(")", "%29")})`;
  if (chart)
    return `> **Embedded Sheets chart:** ${escapeMarkdownText(label)} (spreadsheet ${escapeMarkdownText(chart.spreadsheetId ?? "N/A")}, chart ${chart.chartId ?? "N/A"})`;
  return `> **Embedded object:** ${escapeMarkdownText(label)}`;
}

export function paragraphStyleAttributes(
  paragraph: NonNullable<GoogleDocsStructuralElement["paragraph"]>,
): string {
  const style = paragraph.paragraphStyle;
  if (!style) return "";
  const declarations: string[] = [];
  const align = { CENTER: "center", END: "end", JUSTIFIED: "justify", START: "start" }[
    style.alignment ?? ""
  ];
  if (align) declarations.push(`text-align:${align}`);
  if (style.direction === "RIGHT_TO_LEFT") declarations.push("direction:rtl");
  const first = cssDimension(style.indentFirstLine);
  const start = cssDimension(style.indentStart);
  const end = cssDimension(style.indentEnd);
  const above = cssDimension(style.spaceAbove);
  const below = cssDimension(style.spaceBelow);
  const shade = cssColor(style.shading?.backgroundColor);
  if (first) declarations.push(`text-indent:${first}`);
  if (start) declarations.push(`margin-inline-start:${start}`);
  if (end) declarations.push(`margin-inline-end:${end}`);
  if (above) declarations.push(`margin-top:${above}`);
  if (below) declarations.push(`margin-bottom:${below}`);
  if (shade) declarations.push(`background-color:${shade}`);
  if (typeof style.lineSpacing === "number" && style.lineSpacing >= 50 && style.lineSpacing <= 500)
    declarations.push(`line-height:${style.lineSpacing / 100}`);
  return declarations.length ? ` style="${declarations.join(";")}"` : "";
}
