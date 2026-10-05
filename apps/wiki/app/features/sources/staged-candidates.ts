import type { GooglePickerDocument } from "~/features/google/picker.client";

export type StagedSource =
  | {
      id: string;
      kind: "google-drive";
      title: string;
      url: string;
    }
  | {
      id: string;
      kind: "google-chat-space";
      title: string;
      url: string;
      externalId: string;
    }
  | {
      id: string;
      kind: "discord-channel";
      title: string;
      url: string;
      externalId: string;
    }
  | {
      id: string;
      kind: "url";
      title: string;
      url: string;
    };

export function titleFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname || raw;
  } catch {
    return raw;
  }
}

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        !candidate.id ||
        ids.has(candidate.id) ||
        typeof candidate.title !== "string" ||
        typeof candidate.url !== "string"
      ) {
        return null;
      }
      ids.add(candidate.id);
      if (candidate.kind === "google-drive") {
        candidates.push({
          id: candidate.id,
          kind: "google-drive",
          title: candidate.title,
          url: candidate.url,
        });
      } else if (
        candidate.kind === "google-chat-space" &&
        typeof candidate.externalId === "string"
      ) {
        candidates.push({
          id: candidate.id,
          kind: "google-chat-space",
          title: candidate.title,
          url: candidate.url,
          externalId: candidate.externalId,
        });
      } else if (candidate.kind === "discord-channel" && typeof candidate.externalId === "string") {
        candidates.push({
          id: candidate.id,
          kind: "discord-channel",
          title: candidate.title,
          url: candidate.url,
          externalId: candidate.externalId,
        });
      } else if (candidate.kind === "url") {
        const url = candidate.url.trim();
        if (!isHttpUrl(url)) return null;
        candidates.push({
          id: candidate.id,
          kind: "url",
          title: candidate.title.trim() || titleFromUrl(url),
          url,
        });
      } else {
        return null;
      }
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
