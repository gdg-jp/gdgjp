export const MARKDOWN_MEDIA_TYPE = "text/markdown";
export const PDF_MEDIA_TYPE = "application/pdf";
export const HTML_MEDIA_TYPE = "text/html";

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

export function pathForMediaType(path: string, mediaType: string): string {
  const extension = extensionFor(mediaType);
  return path.endsWith(extension) ? path : `${path}${extension}`;
}

export function markdownBody(markdown: string): Uint8Array {
  return new TextEncoder().encode(markdown);
}
