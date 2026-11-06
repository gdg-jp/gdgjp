import type { GooglePickerDocument } from "~/features/google/picker.client";
import { type StagedSource, registrationSpec } from "./kinds";

export type { StagedSource } from "./kinds";
export { isHttpUrl, titleFromUrl } from "./kinds";

export function buildDiscordSourceTitle(
  guildName: string,
  categoryName: string | null,
  channelName: string,
): string {
  return categoryName
    ? `${guildName}-${categoryName}#${channelName}`
    : `${guildName}#${channelName}`;
}

export function parseBatchCandidates(raw: FormDataEntryValue | null): StagedSource[] | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
    const ids = new Set<string>();
    const candidates: StagedSource[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const candidate = registrationSpec(record.kind)?.parseCandidate(record);
      if (!candidate || ids.has(candidate.id)) return null;
      ids.add(candidate.id);
      candidates.push(candidate);
    }
    return candidates;
  } catch {
    return null;
  }
}

export const SOURCE_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
].join(",");

export function sourceUrlFromGoogleDocument(document: GooglePickerDocument): string | null {
  switch (document.mimeType) {
    case "application/vnd.google-apps.document":
      return `https://docs.google.com/document/d/${document.id}/edit`;
    case "application/vnd.google-apps.presentation":
      return `https://docs.google.com/presentation/d/${document.id}/edit`;
    case "application/vnd.google-apps.spreadsheet":
      return `https://docs.google.com/spreadsheets/d/${document.id}/edit`;
    default:
      return null;
  }
}
