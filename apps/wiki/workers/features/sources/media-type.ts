/** Media types persisted as first-class source documents. */
export const MARKDOWN_MEDIA_TYPE = "text/markdown";
export const PDF_MEDIA_TYPE = "application/pdf";
export const HTML_MEDIA_TYPE = "text/html";

/** Return the canonical filename extension for a persisted source document. */
export function extensionFor(mediaType: string): string {
  switch (mediaType) {
    case MARKDOWN_MEDIA_TYPE:
      return ".md";
    case PDF_MEDIA_TYPE:
      return ".pdf";
    case HTML_MEDIA_TYPE:
      return ".html";
    default:
      throw new Error(`Unsupported source document media type: ${mediaType}`);
  }
}

/** Ensure a source-document path is a filename for the given media type. */
export function pathForMediaType(path: string, mediaType: string): string {
  const extension = extensionFor(mediaType);
  return path.endsWith(extension) ? path : `${path}${extension}`;
}

/** Encode Markdown consistently at the source-document boundary. */
export function markdownBody(markdown: string): Uint8Array {
  return new TextEncoder().encode(markdown);
}
