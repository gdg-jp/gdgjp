import {
  escapeHtml,
  escapeMarkdownText,
  imageForObject,
  nonImageObject,
  paragraphStyleAttributes,
  smartChipLink,
  styledText,
} from "./docs-markdown-inline.server";
import type { GoogleDocsInlineImage } from "./docs-markdown-inline.server";
import type {
  GoogleDocsDocument,
  GoogleDocsDocumentTab,
  GoogleDocsParagraphElement,
  GoogleDocsStructuralElement,
  GoogleDocsTab,
} from "./drive.server";

export type { GoogleDocsInlineImage } from "./docs-markdown-inline.server";

export interface GoogleDocsMarkdownNode {
  externalId: string;
  title: string;
  markdown: string;
  images: GoogleDocsInlineImage[];
  /** Non-fatal API limitations and unavailable non-image objects. */
  warnings: string[];
  children: GoogleDocsMarkdownNode[];
}

/** Resolves deferred Docs-internal link targets after Wiki slugs are allocated. */
export function resolveGoogleDocsInternalLinks(
  markdown: string,
  slugsByTabId: ReadonlyMap<string, string>,
  documentId: string,
): { markdown: string; unresolvedBookmarks: number; unresolvedTargets: number } {
  let unresolvedBookmarks = 0;
  let unresolvedTargets = 0;
  const markdownWithLinks = markdown.replace(
    /google-docs:\/\/(tab|heading|bookmark)\/([^/\s)]+)(?:\/([^\s)]+))?/g,
    (_, kind: string, encodedTabId: string, encodedTargetId: string | undefined) => {
      const tabId = decodeURIComponent(encodedTabId);
      const targetId = encodedTargetId ? decodeURIComponent(encodedTargetId) : undefined;
      const slug = slugsByTabId.get(tabId);
      if (!slug) {
        unresolvedTargets++;
        return `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`;
      }
      if (kind === "tab") return `/wiki/${encodeURIComponent(slug)}`;
      if (kind === "heading" && targetId)
        return `/wiki/${encodeURIComponent(slug)}#${encodeURIComponent(targetId)}`;
      // The response exposes bookmark link IDs but not their anchor locations.
      // Keep the source document as a working fallback rather than a dead Wiki hash.
      unresolvedBookmarks++;
      return `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`;
    },
  );
  return { markdown: markdownWithLinks, unresolvedBookmarks, unresolvedTargets };
}

type ConversionContext = Pick<
  GoogleDocsDocumentTab,
  "footnotes" | "headers" | "footers" | "inlineObjects" | "lists" | "positionedObjects"
>;

function convertParagraph(
  paragraph: NonNullable<GoogleDocsStructuralElement["paragraph"]>,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
  warnings: string[],
): string {
  const content = (paragraph.elements ?? [])
    .map((element: GoogleDocsParagraphElement) => {
      if (element.textRun)
        return styledText(element.textRun.content ?? "", element.textRun.textStyle);
      if (element.autoText)
        return element.autoText.type === "PAGE_COUNT" ? "{{PAGE_COUNT}}" : "{{PAGE_NUMBER}}";
      if (element.pageBreak) return "<!-- google-docs:page-break -->";
      if (element.columnBreak) return "<!-- google-docs:column-break -->";
      if (element.horizontalRule) return "\n\n---\n\n";
      if (element.equation) {
        warnings.push("equation_content_unavailable");
        return "`N/A`";
      }
      if (element.footnoteReference) {
        const id = element.footnoteReference.footnoteId;
        const number = element.footnoteReference.footnoteNumber ?? "?";
        return id ? `[^${escapeMarkdownText(id)}]` : `[^${escapeMarkdownText(number)}]`;
      }
      if (element.person) {
        const { name, email } = element.person.personProperties ?? {};
        return smartChipLink(
          name || email,
          email ? `mailto:${email}` : undefined,
          element.person.textStyle,
        );
      }
      if (element.richLink) {
        const { title, uri } = element.richLink.richLinkProperties ?? {};
        return smartChipLink(title, uri, element.richLink.textStyle);
      }
      if (element.dateElement)
        return styledText(
          element.dateElement.dateElementProperties?.displayText ?? "",
          element.dateElement.textStyle,
        );
      const objectId = element.inlineObjectElement?.inlineObjectId;
      if (!objectId) return "";
      const object = context.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject;
      const image = imageForObject(objectId, object);
      if (!image) return nonImageObject(object);
      images.push(image);
      return `![${escapeMarkdownText(image.altText ?? "")}](attachment:${objectId})`;
    })
    .join("");
  const positioned = (paragraph.positionedObjectIds ?? [])
    .map((objectId) => {
      const object =
        context.positionedObjects?.[objectId]?.positionedObjectProperties?.embeddedObject;
      const image = imageForObject(objectId, object);
      if (image) {
        images.push(image);
        return `![${escapeMarkdownText(image.altText ?? "")}](attachment:${objectId})`;
      }
      warnings.push("positioned_object_not_image");
      return nonImageObject(object);
    })
    .join("\n\n");
  const value = `${content}${content && positioned ? "\n\n" : ""}${positioned}`.trim();
  if (!value) return "";
  const style = paragraph.paragraphStyle;
  const heading = style?.namedStyleType?.match(/^HEADING_([1-6])$/)?.[1];
  const anchor = style?.headingId ? `<a id="${escapeHtml(style.headingId)}"></a>` : "";
  if (heading) return `${anchor}${"#".repeat(Number(heading))} ${value}`;
  if (paragraph.bullet) {
    const level = paragraph.bullet.nestingLevel ?? 0;
    const properties = paragraph.bullet.listId
      ? context.lists?.[paragraph.bullet.listId]?.listProperties?.nestingLevels?.[level]
      : undefined;
    const ordered = [
      "DECIMAL",
      "ZERO_DECIMAL",
      "UPPER_ALPHA",
      "ALPHA",
      "UPPER_ROMAN",
      "ROMAN",
    ].includes(properties?.glyphType ?? "");
    const marker = ordered ? `${properties?.startNumber ?? 1}.` : "-";
    return `${"  ".repeat(level)}${marker} ${value}`;
  }
  if (style?.pageBreakBefore)
    return `<!-- google-docs:page-break-before -->\n\n${anchor}<p${paragraphStyleAttributes(paragraph)}>${value}</p>`;
  const attrs = paragraphStyleAttributes(paragraph);
  return attrs ? `${anchor}<p${attrs}>${value}</p>` : `${anchor}${value}`;
}

function convertTable(
  table: NonNullable<GoogleDocsStructuralElement["table"]>,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
  warnings: string[],
): string {
  const rows = (table.tableRows ?? []).map((row) =>
    (row.tableCells ?? []).map((cell) =>
      convertElements(cell.content, context, images, warnings)
        .replace(/\n+/g, "<br>")
        .replaceAll("|", "\\|"),
    ),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  if (!width) return "";
  const padded = rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
  return [
    `| ${padded[0].join(" | ")} |`,
    `| ${Array<string>(width).fill("---").join(" | ")} |`,
    ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function convertSection(section: NonNullable<GoogleDocsStructuralElement["sectionBreak"]>): string {
  const style = section.sectionStyle;
  if (style?.sectionType === "CONTINUOUS") return "";
  const details = [
    style?.sectionType,
    style?.pageNumberStart ? `page ${style.pageNumberStart}` : undefined,
    style?.columnProperties?.length ? `${style.columnProperties.length} columns` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return `---\n\n> **Google Docs section${details ? `: ${escapeMarkdownText(details)}` : ""}**`;
}

function convertElements(
  elements: readonly GoogleDocsStructuralElement[] | undefined,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
  warnings: string[],
): string {
  if (!elements) return "";
  return elements
    .flatMap((element) => {
      if (element.paragraph)
        return [convertParagraph(element.paragraph, context, images, warnings)];
      if (element.sectionBreak) return [convertSection(element.sectionBreak)];
      if (element.table) return [convertTable(element.table, context, images, warnings)];
      if (element.tableOfContents)
        return [convertElements(element.tableOfContents.content, context, images, warnings)];
      return [];
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function appendPeripheralContent(
  markdown: string,
  context: ConversionContext,
  images: GoogleDocsInlineImage[],
  warnings: string[],
): string {
  const footnotes = Object.entries(context.footnotes ?? {}).map(
    ([id, value]) =>
      `[^${id}]: ${convertElements(value.content, context, images, warnings).replace(/\n+/g, " ")}`,
  );
  const headers = Object.entries(context.headers ?? {}).map(
    ([id, value]) =>
      `> **Google Docs header (${escapeMarkdownText(id)}):** ${convertElements(value.content, context, images, warnings).replace(/\n+/g, " ")}`,
  );
  const footers = Object.entries(context.footers ?? {}).map(
    ([id, value]) =>
      `> **Google Docs footer (${escapeMarkdownText(id)}):** ${convertElements(value.content, context, images, warnings).replace(/\n+/g, " ")}`,
  );
  return [markdown, ...footnotes, ...headers, ...footers].filter(Boolean).join("\n\n").trim();
}

function convertTab(
  tab: GoogleDocsTab,
  document: GoogleDocsDocument,
  fallbackIndex: number,
): GoogleDocsMarkdownNode {
  const images: GoogleDocsInlineImage[] = [];
  const warnings: string[] = [];
  const context = { ...document, ...tab.documentTab };
  const title = tab.tabProperties?.title?.trim() || `Tab ${fallbackIndex + 1}`;
  return {
    externalId: tab.tabProperties?.tabId ?? `tab-${fallbackIndex + 1}`,
    title,
    markdown: appendPeripheralContent(
      convertElements(tab.documentTab?.body?.content, context, images, warnings),
      context,
      images,
      warnings,
    ),
    images,
    warnings,
    children: (tab.childTabs ?? []).map((child, index) => convertTab(child, document, index)),
  };
}

export function convertGoogleDocsDocument(document: GoogleDocsDocument): GoogleDocsMarkdownNode {
  const images: GoogleDocsInlineImage[] = [];
  const warnings: string[] = [];
  return {
    externalId: document.documentId,
    title: document.title?.trim() || "Untitled document",
    markdown: appendPeripheralContent(
      convertElements(document.body?.content, document, images, warnings),
      document,
      images,
      warnings,
    ),
    images,
    warnings,
    children: (document.tabs ?? []).map((tab, index) => convertTab(tab, document, index)),
  };
}
