import type {
  GoogleDocsDocument,
  GoogleDocsStructuralElement,
  GoogleDocsTab,
  GoogleDocsTextRun,
} from "./google-drive.server";

export interface GoogleDocsInlineImage {
  /** Google Docs inline object ID, stable within the source revision. */
  objectId: string;
  /** Authenticated, short-lived Google content URL; download it server-side. */
  sourceUrl: string;
  contentType?: string;
  altText?: string;
}

export interface GoogleDocsMarkdownNode {
  /** `documentId` for the root and a Google Docs tab ID for tabs. */
  externalId: string;
  title: string;
  markdown: string;
  images: GoogleDocsInlineImage[];
  children: GoogleDocsMarkdownNode[];
}

type ConversionContext = Pick<GoogleDocsDocument, "inlineObjects" | "lists">;

function escapeMarkdownText(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/([*_`\[\]])/g, "\\$1");
}

function styledText(content: string, style: GoogleDocsTextRun["textStyle"]): string {
  const text = escapeMarkdownText(content.replace(/\n$/, ""));
  if (!text) return "";
  const textStyle = style;
  let result = text;
  if (textStyle?.bold) result = `**${result}**`;
  if (textStyle?.italic) result = `*${result}*`;
  if (textStyle?.strikethrough) result = `~~${result}~~`;
  // Markdown has no portable underline syntax. Preserve it as HTML.
  if (textStyle?.underline) result = `<u>${result}</u>`;
  if (textStyle?.link?.url) result = `[${result}](${textStyle.link.url})`;
  return result;
}

function imageForObject(
  context: ConversionContext,
  objectId: string,
): GoogleDocsInlineImage | null {
  const object = context.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject;
  const sourceUrl = object?.imageProperties?.contentUri;
  if (!sourceUrl) return null;
  return {
    objectId,
    sourceUrl,
    contentType: object.imageProperties?.contentType,
    altText: object.description || object.title,
  };
}

function convertParagraph(
  paragraph: NonNullable<GoogleDocsStructuralElement["paragraph"]>,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
): string {
  const content = (paragraph.elements ?? [])
    .map((element) => {
      if (element.textRun)
        return styledText(element.textRun.content ?? "", element.textRun.textStyle);
      const objectId = element.inlineObjectElement?.inlineObjectId;
      if (!objectId) return "";
      const image = imageForObject(context, objectId);
      if (!image) return "";
      images.push(image);
      return `![${escapeMarkdownText(image.altText ?? "")}](attachment:${objectId})`;
    })
    .join("");
  if (!content.trim()) return "";

  const namedStyle = paragraph.paragraphStyle?.namedStyleType;
  const heading = namedStyle?.match(/^HEADING_([1-6])$/)?.[1];
  if (heading) return `${"#".repeat(Number(heading))} ${content}`;
  if (!paragraph.bullet) return content;

  const level = paragraph.bullet.nestingLevel ?? 0;
  const glyphType = paragraph.bullet.listId
    ? context.lists?.[paragraph.bullet.listId]?.listProperties?.nestingLevels?.[level]?.glyphType
    : undefined;
  // Docs uses DECIMAL for numbered lists; all other glyphs map to unordered Markdown.
  const marker = glyphType === "DECIMAL" ? "1." : "-";
  return `${"  ".repeat(level)}${marker} ${content}`;
}

function tableCellText(
  content: readonly GoogleDocsStructuralElement[] | undefined,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
): string {
  return convertElements(content, context, images).replace(/\n+/g, "<br>").replaceAll("|", "\\|");
}

function convertTable(
  table: NonNullable<GoogleDocsStructuralElement["table"]>,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
): string {
  const rows = (table.tableRows ?? []).map((row) =>
    (row.tableCells ?? []).map((cell) => tableCellText(cell.content, context, images)),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  if (!width) return "";
  const padded = rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
  const header = padded[0];
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array<string>(width).fill("---").join(" | ")} |`,
    ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function convertElements(
  elements: readonly GoogleDocsStructuralElement[] | undefined,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
): string {
  if (!elements) return "";
  const blocks = elements.flatMap((element) => {
    if (element.paragraph) return [convertParagraph(element.paragraph, context, images)];
    if (element.table) return [convertTable(element.table, context, images)];
    if (element.tableOfContents)
      return [convertElements(element.tableOfContents.content, context, images)];
    return [];
  });
  return blocks.filter(Boolean).join("\n\n").trim();
}

function convertTab(
  tab: GoogleDocsTab,
  document: GoogleDocsDocument,
  fallbackIndex: number,
): GoogleDocsMarkdownNode {
  const images: GoogleDocsInlineImage[] = [];
  const title = tab.tabProperties?.title?.trim() || `Tab ${fallbackIndex + 1}`;
  return {
    externalId: tab.tabProperties?.tabId ?? `tab-${fallbackIndex + 1}`,
    title,
    markdown: convertElements(
      tab.documentTab?.body?.content,
      { ...document, ...tab.documentTab },
      images,
    ),
    images,
    children: (tab.childTabs ?? []).map((child, index) => convertTab(child, document, index)),
  };
}

/**
 * Converts a Docs API response to importable page nodes without fetching image bytes.
 * Image Markdown deliberately uses `attachment:<objectId>` placeholders; the importer
 * replaces those with its persisted attachment URLs after downloading `sourceUrl`.
 */
export function convertGoogleDocsDocument(document: GoogleDocsDocument): GoogleDocsMarkdownNode {
  const images: GoogleDocsInlineImage[] = [];
  return {
    externalId: document.documentId,
    title: document.title?.trim() || "Untitled document",
    markdown: convertElements(document.body?.content, document, images),
    images,
    children: (document.tabs ?? []).map((tab, index) => convertTab(tab, document, index)),
  };
}
