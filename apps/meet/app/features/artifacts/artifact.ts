import type { GoogleWorkspaceBrand } from "~/components/GoogleWorkspaceLogo";

export type ArtifactKind = "recording" | "notes" | "chat_log";

export type ConferenceRecord = {
  name: string;
  meetingId: string;
  startTime: string | null;
  endTime: string | null;
  expireTime?: string | null;
};

export type ArtifactRecord = {
  id: string;
  meetingId: string;
  conferenceRecord: string;
  kind: ArtifactKind;
  driveFileId: string;
  title: string;
  mimeType: string;
  webViewLink: string;
  createdAt: string;
  sharedAt: string | null;
  attachedAt: string | null;
  lastError: string | null;
  attempts: number;
};

export type PublicArtifact = Pick<
  ArtifactRecord,
  "id" | "kind" | "title" | "webViewLink" | "createdAt" | "sharedAt" | "attachedAt"
>;

export function toPublicArtifact(artifact: ArtifactRecord): PublicArtifact {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    webViewLink: artifact.webViewLink,
    createdAt: artifact.createdAt,
    sharedAt: artifact.sharedAt,
    attachedAt: artifact.attachedAt,
  };
}

export type FailedArtifactItem = ArtifactRecord & {
  meetingTitle: string;
};

export type ArtifactShareFailureRecord = {
  artifactId: string;
  artifactKind: ArtifactKind;
  artifactTitle: string;
  emailNormalized: string;
  httpStatus: number;
  apiStatus: string | null;
  failedAt: string;
};

export type InviteeShareFailureArtifact = {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  httpStatus: number;
  apiStatus: string | null;
};

export type InviteeShareFailure = {
  emailNormalized: string;
  email: string;
  displayName: string | null;
  artifacts: InviteeShareFailureArtifact[];
};

export function groupInviteeShareFailures(
  rows: readonly ArtifactShareFailureRecord[],
  invitees: readonly { emailNormalized: string; email: string; displayName: string | null }[],
): InviteeShareFailure[] {
  const inviteeByEmail = new Map(invitees.map((inv) => [inv.emailNormalized, inv]));
  const grouped = new Map<string, InviteeShareFailure>();

  for (const row of rows) {
    const invitee = inviteeByEmail.get(row.emailNormalized);
    if (!invitee) continue;
    let entry = grouped.get(row.emailNormalized);
    if (!entry) {
      entry = {
        emailNormalized: row.emailNormalized,
        email: invitee.email,
        displayName: invitee.displayName,
        artifacts: [],
      };
      grouped.set(row.emailNormalized, entry);
    }
    if (!entry.artifacts.some((a) => a.artifactId === row.artifactId)) {
      entry.artifacts.push({
        artifactId: row.artifactId,
        kind: row.artifactKind,
        title: row.artifactTitle,
        httpStatus: row.httpStatus,
        apiStatus: row.apiStatus,
      });
    }
  }

  return [...grouped.values()];
}

export const ARTIFACT_KIND_META: Record<
  ArtifactKind,
  {
    label: string;
    calendarTitle: string;
    tone: "info" | "success" | "neutral";
    icon: "Play" | "FileText" | "MessageSquare";
    driveLogo: Extract<GoogleWorkspaceBrand, "docs" | "drive-video">;
  }
> = {
  recording: {
    label: "録画",
    calendarTitle: "録画",
    tone: "info",
    icon: "Play",
    driveLogo: "drive-video",
  },
  notes: {
    label: "文字起こし・Gemini メモ",
    calendarTitle: "要約・文字起こし",
    tone: "success",
    icon: "FileText",
    driveLogo: "docs",
  },
  chat_log: {
    label: "チャットの記録",
    calendarTitle: "チャットの記録",
    tone: "neutral",
    icon: "MessageSquare",
    driveLogo: "docs",
  },
};

export function getCalendarAttachmentTitle(kind: ArtifactKind): string {
  return ARTIFACT_KIND_META[kind].calendarTitle;
}

export function formatArtifactDateTimeJst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}
