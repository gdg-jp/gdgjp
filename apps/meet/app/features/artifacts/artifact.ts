import type { GoogleWorkspaceBrand } from "~/components/GoogleWorkspaceLogo";

/** 会議の生成ファイル種別。文字起こしと Gemini メモは同一ドキュメントのため `notes` に統合する。 */
export type ArtifactKind = "recording" | "notes" | "chat_log";

/** 会議の開催回（`conference_records`）ドメインモデル。 */
export type ConferenceRecord = {
  name: string;
  meetingId: string;
  startTime: string | null;
  endTime: string | null;
};

/** 会議の生成ファイル（`artifacts`）ドメインモデル。 */
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

/** 会議詳細で閲覧者全員に渡す生成ファイルの項目（エラー内容や試行回数は含めない）。 */
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

/** 管理画面（`/admin/google`）に表示する失敗・未完了 artifact の一覧項目。 */
export type FailedArtifactItem = ArtifactRecord & {
  meetingTitle: string;
};

/** `artifact_share_failures` と `artifacts` の結合レコード。 */
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

/** 会議詳細画面で招待者ごとにまとめて表示する Drive 共有失敗情報。 */
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
    // 招待者から外した人の行は、次の共有ジョブで消えるまでの間も表示しない。
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
    tone: "info" | "success" | "neutral";
    icon: "Play" | "FileText" | "MessageSquare";
    driveLogo: Extract<GoogleWorkspaceBrand, "docs" | "drive-video">;
  }
> = {
  recording: { label: "録画", tone: "info", icon: "Play", driveLogo: "drive-video" },
  notes: { label: "文字起こし・Gemini メモ", tone: "success", icon: "FileText", driveLogo: "docs" },
  chat_log: { label: "チャットの記録", tone: "neutral", icon: "MessageSquare", driveLogo: "docs" },
};

/** ISO 8601 日時文字列を JST の日本語表記へ整形する。 */
export function formatArtifactDateTimeJst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}
