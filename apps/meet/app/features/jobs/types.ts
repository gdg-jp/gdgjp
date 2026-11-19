/**
 * `MEET_JOBS` Queue メッセージの契約型。
 * Stage 05（`cleanup_meeting`）・Stage 06（`process_artifact` / `share_artifact`）では
 * このユニオンに種別を 1 行ずつ追加する。
 */
export type MeetJobMessage = {
  type: "sync_members";
  meetingId: string;
};

export type MeetJobType = MeetJobMessage["type"];

/** 受信した Queue メッセージ本文が既知の `MeetJobMessage` か判定する。 */
export function isMeetJobMessage(value: unknown): value is MeetJobMessage {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.type === "sync_members") {
    return typeof obj.meetingId === "string" && obj.meetingId.length > 0;
  }
  return false;
}
