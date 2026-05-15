import { IMAGE_ATTACHMENT_HINT, PDF_ATTACHMENT_HINT } from "./prompts";

export type GeminiPart = { text: string } | { fileData: { mimeType: string; fileUri: string } };

export function pushFilePartsWithHint(
  parts: GeminiPart[],
  fileUris: { uri: string; mimeType: string }[],
): void {
  if (fileUris.length === 0) return;

  const pdfs = fileUris.filter((f) => f.mimeType === "application/pdf");
  const images = fileUris.filter((f) => f.mimeType !== "application/pdf");

  if (pdfs.length > 0) {
    parts.push({ text: PDF_ATTACHMENT_HINT });
    for (const f of pdfs) {
      parts.push({ fileData: { mimeType: f.mimeType, fileUri: f.uri } });
    }
  }

  if (images.length > 0) {
    parts.push({ text: IMAGE_ATTACHMENT_HINT });
    for (const f of images) {
      parts.push({ fileData: { mimeType: f.mimeType, fileUri: f.uri } });
    }
  }
}
