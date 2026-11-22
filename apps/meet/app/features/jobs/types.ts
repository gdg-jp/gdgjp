export type ArtifactJobKind = "recording" | "transcript" | "smartNote";

/**
 * `MEET_JOBS` Queue メッセージの契約型。
 */
export type MeetJobMessage =
  | {
      type: "sync_members";
      meetingId: string;
    }
  | {
      type: "cleanup_meeting";
      meetingId: string;
    }
  | {
      type: "process_artifact";
      meetingId: string;
      kind: ArtifactJobKind;
      conferenceRecord: string;
      resourceName: string;
    }
  | {
      type: "share_artifact";
      artifactId: string;
    }
  | {
      type: "collect_conference_stats";
      conferenceRecord: string;
      cursor?: string;
    }
  | {
      type: "collect_transcript_stats";
      conferenceRecord: string;
      transcript: string;
      pageToken?: string;
    };

export type MeetJobType = MeetJobMessage["type"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isArtifactJobKind(value: unknown): value is ArtifactJobKind {
  return value === "recording" || value === "transcript" || value === "smartNote";
}

/** 受信した Queue メッセージ本文が既知の `MeetJobMessage` か判定する。 */
export function isMeetJobMessage(value: unknown): value is MeetJobMessage {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.type === "sync_members" || obj.type === "cleanup_meeting") {
    return isNonEmptyString(obj.meetingId);
  }
  if (obj.type === "process_artifact") {
    return (
      isNonEmptyString(obj.meetingId) &&
      isArtifactJobKind(obj.kind) &&
      isNonEmptyString(obj.conferenceRecord) &&
      isNonEmptyString(obj.resourceName)
    );
  }
  if (obj.type === "share_artifact") {
    return isNonEmptyString(obj.artifactId);
  }
  if (obj.type === "collect_conference_stats") {
    return (
      isNonEmptyString(obj.conferenceRecord) &&
      (obj.cursor === undefined || typeof obj.cursor === "string")
    );
  }
  if (obj.type === "collect_transcript_stats") {
    return (
      isNonEmptyString(obj.conferenceRecord) &&
      isNonEmptyString(obj.transcript) &&
      (obj.pageToken === undefined || isNonEmptyString(obj.pageToken))
    );
  }
  return false;
}
