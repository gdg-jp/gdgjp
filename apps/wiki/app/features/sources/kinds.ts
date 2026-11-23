import type { IconName } from "@gdgjp/design-system";
import {
  type ClassifiedSource,
  classifyDiscordGuild,
  classifyGoogleChatSpace,
  classifySourceUrl,
} from "./classify";
import type { SourceKind, SourceRefreshPolicy } from "./shared";

export type SourceImportKind =
  | "google-chat-space"
  | "google-drive"
  | "website"
  | "discord-channel"
  | "discord-guild";

export interface SourceKindSpec {
  kind: SourceKind;
  driver: SourceImportKind | null;
  refreshable: boolean;
  refreshPolicies: readonly SourceRefreshPolicy[];
  defaultRefreshPolicy: SourceRefreshPolicy;
  candidateId(externalId: string): string;
  provisionalTitle(classified: Extract<ClassifiedSource, { ok: true }>): string;
  labelKey: string;
}

const SCHEDULED: readonly SourceRefreshPolicy[] = ["manual", "daily", "weekly"];

function hostnameOr(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function driveKind(
  kind: SourceKind,
  labelKey: string,
  fallbackTitle: (externalId: string) => string = (id) => `Google Doc ${id}`,
): SourceKindSpec {
  return {
    kind,
    driver: "google-drive",
    refreshable: true,
    refreshPolicies: SCHEDULED,
    defaultRefreshPolicy: "manual",
    candidateId: (externalId) => `drive:${externalId}`,
    provisionalTitle: (c) => c.title ?? fallbackTitle(c.externalId ?? ""),
    labelKey,
  };
}

function inlineKind(kind: SourceKind, labelKey: string): SourceKindSpec {
  return {
    kind,
    driver: null,
    refreshable: false,
    refreshPolicies: ["manual"],
    defaultRefreshPolicy: "manual",
    candidateId: (externalId) => `drive:${externalId}`,
    provisionalTitle: (c) => c.title ?? hostnameOr(c.url),
    labelKey,
  };
}

export const SOURCE_KINDS: Record<SourceKind, SourceKindSpec> = {
  "google-doc": driveKind("google-doc", "sources.kind.google-doc"),
  "google-sheet": driveKind("google-sheet", "sources.kind.google-sheet"),
  "google-slides": driveKind("google-slides", "sources.kind.google-slides"),
  "google-drive-folder": driveKind(
    "google-drive-folder",
    "sources.kind.google-drive-folder",
    (id) => `Google Drive folder ${id}`,
  ),
  "google-chat-space": {
    kind: "google-chat-space",
    driver: "google-chat-space",
    refreshable: true,
    refreshPolicies: SCHEDULED,
    defaultRefreshPolicy: "manual",
    candidateId: (externalId) => `chat:${externalId}`,
    provisionalTitle: (c) => c.title ?? `Google Chat ${c.externalId}`,
    labelKey: "sources.kind.google-chat-space",
  },
  "discord-channel": {
    kind: "discord-channel",
    driver: "discord-channel",
    refreshable: true,
    refreshPolicies: ["manual", "hourly", "daily", "weekly"],
    defaultRefreshPolicy: "hourly",
    candidateId: (externalId) => `discord:${externalId}`,
    provisionalTitle: (c) => c.title ?? `Discord #${c.externalId}`,
    labelKey: "sources.kind.discord-channel",
  },
  "discord-guild": {
    kind: "discord-guild",
    driver: "discord-guild",
    refreshable: true,
    refreshPolicies: ["manual", "hourly", "daily", "weekly"],
    defaultRefreshPolicy: "hourly",
    candidateId: (externalId) => `discord-guild:${externalId}`,
    provisionalTitle: (c) => c.title ?? `Discord ${c.externalId}`,
    labelKey: "sources.kind.discord-guild",
  },
  website: {
    kind: "website",
    driver: "website",
    refreshable: true,
    refreshPolicies: SCHEDULED,
    defaultRefreshPolicy: "manual",
    candidateId: (externalId) => `drive:${externalId}`,
    provisionalTitle: (c) => c.title ?? hostnameOr(c.url),
    labelKey: "sources.kind.website",
  },
  upload: inlineKind("upload", "sources.kind.upload"),
  text: inlineKind("text", "sources.kind.text"),
  conversation: inlineKind("conversation", "sources.kind.conversation"),
};

export function sourceKindSpec(kind: string): SourceKindSpec | null {
  return Object.hasOwn(SOURCE_KINDS, kind) ? SOURCE_KINDS[kind as SourceKind] : null;
}

export const IMPORT_FIRST_PHASE: Record<SourceImportKind, string> = {
  "google-chat-space": "listing",
  "discord-channel": "listing",
  "discord-guild": "discover",
  "google-drive": "start",
  website: "start",
};

export type RegistrationKind = "url" | "google-drive" | "google-chat-space" | "discord-guild";

export type StagedSource = {
  id: string;
  kind: RegistrationKind;
  title: string;
  url: string;
  externalId?: string;
  config?: string;
};

export type RegistrationInput = {
  kind: RegistrationKind;
  url?: unknown;
  externalId?: unknown;
  title?: unknown;
  config?: unknown;
};

export interface RegistrationSpec {
  registration: RegistrationKind;
  parseCandidate(raw: Record<string, unknown>): StagedSource | null;
  validate(candidate: StagedSource): string | null;
  classify(input: RegistrationInput): ClassifiedSource;
  toCreateInput(candidate: StagedSource): RegistrationInput;
  icon: IconName;
  editableUrl: boolean;
  dedupeStaged: boolean;
  labelKey: string;
}

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

function base(raw: Record<string, unknown>): { id: string; title: string; url: string } | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.title !== "string" || typeof raw.url !== "string") return null;
  return { id: raw.id, title: raw.title, url: raw.url };
}

export const REGISTRATIONS: Record<RegistrationKind, RegistrationSpec> = {
  url: {
    registration: "url",
    parseCandidate(raw) {
      const b = base(raw);
      if (!b) return null;
      const url = b.url.trim();
      if (!isHttpUrl(url)) return null;
      return { ...b, kind: "url", url, title: b.title.trim() || titleFromUrl(url) };
    },
    validate: (c) => (isHttpUrl(c.url) ? null : "invalid_url"),
    classify: (input) =>
      typeof input.url === "string"
        ? classifySourceUrl(input.url, input.title)
        : { ok: false, error: "url_required" },
    toCreateInput: (c) => ({ kind: "url", url: c.url, title: c.title }),
    icon: "Link2",
    editableUrl: true,
    dedupeStaged: false,
    labelKey: "sources.add_url",
  },
  "google-drive": {
    registration: "google-drive",
    parseCandidate(raw) {
      const b = base(raw);
      return b ? { ...b, kind: "google-drive" } : null;
    },
    validate: () => null,
    classify(input) {
      if (typeof input.url !== "string") return { ok: false, error: "url_required" };
      const classified = classifySourceUrl(input.url, input.title);
      return classified.ok && SOURCE_KINDS[classified.kind].driver !== "google-drive"
        ? { ok: false, error: "unsupported_url" }
        : classified;
    },
    toCreateInput: (c) => ({ kind: "google-drive", url: c.url, title: c.title }),
    icon: "FileText",
    editableUrl: false,
    dedupeStaged: false,
    labelKey: "sources.add_google_drive",
  },
  "google-chat-space": {
    registration: "google-chat-space",
    parseCandidate(raw) {
      const b = base(raw);
      if (!b || typeof raw.externalId !== "string") return null;
      return { ...b, kind: "google-chat-space", externalId: raw.externalId };
    },
    validate: () => null,
    classify: (input) => classifyGoogleChatSpace(input.externalId, input.title),
    toCreateInput: (c) => ({
      kind: "google-chat-space",
      externalId: c.externalId,
      title: c.title,
    }),
    icon: "MessageSquare",
    editableUrl: false,
    dedupeStaged: true,
    labelKey: "sources.add_google_chat",
  },
  "discord-guild": {
    registration: "discord-guild",
    parseCandidate(raw) {
      const b = base(raw);
      if (!b || typeof raw.externalId !== "string" || typeof raw.config !== "string") return null;
      return { ...b, kind: "discord-guild", externalId: raw.externalId, config: raw.config };
    },
    validate: () => null,
    classify: (input) => classifyDiscordGuild(input.externalId, input.title, input.config),
    toCreateInput: (c) => ({
      kind: "discord-guild",
      externalId: c.externalId,
      title: c.title,
      config: c.config,
    }),
    icon: "Hash",
    editableUrl: false,
    dedupeStaged: true,
    labelKey: "sources.add_discord_server",
  },
};

export function registrationSpec(registration: unknown): RegistrationSpec | null {
  return typeof registration === "string" && Object.hasOwn(REGISTRATIONS, registration)
    ? REGISTRATIONS[registration as RegistrationKind]
    : null;
}

export const NON_REFRESHABLE_KINDS: readonly SourceKind[] = Object.values(SOURCE_KINDS)
  .filter((spec) => !spec.refreshable)
  .map((spec) => spec.kind);
