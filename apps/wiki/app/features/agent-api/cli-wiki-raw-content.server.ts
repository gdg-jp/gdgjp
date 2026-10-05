/**
 * Content-Type for hash-verified CLI raw downloads.
 *
 * Cloudflare zone features (Web Analytics beacon injection, email obfuscation,
 * etc.) rewrite responses advertised as `text/html`. `gdg wiki raw pull`
 * SHA-256-checks these bytes against the manifest, so HTML must not be served
 * as `text/html` here. OpenAPI already documents `application/octet-stream`.
 */
export function rawDownloadContentType(mediaType: string): string {
  if (mediaType === "text/html" || mediaType.startsWith("text/html;")) {
    return "application/octet-stream";
  }
  return mediaType.startsWith("text/") ? `${mediaType}; charset=utf-8` : mediaType;
}
