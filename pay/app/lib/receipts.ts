export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isAllowedReceiptType(contentType: string): boolean {
  return ALLOWED_TYPES.has(contentType);
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "receipt";
  return base.slice(0, 180);
}

export function receiptObjectKey(claimId: string, filename: string): string {
  return `claims/${claimId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
}
