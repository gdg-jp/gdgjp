import type { Brief } from "~/features/briefs/brief";
import type { PlaybookConstants } from "~/features/playbook/playbook";
import type { ItemInput } from "./item";

/**
 * Items the Playbook derives from a parent item (REMIND-STAFF-BEFORE-POST,
 * SPEAKER-REQUEST-BEFORE-POST, SPEAKER-TIER-HIGH-NO-ASK). Pure; the repository writes them in the
 * parent's batch and moves them when the parent moves.
 */
export function deriveItems(
  parent: ItemInput,
  brief: Brief | null,
  constants: PlaybookConstants,
): ItemInput[] {
  const out: ItemInput[] = [];
  const minutes = (m: number) => parent.dueAt - m * 60;
  if (parent.kind === "x_post" || parent.kind === "ig_post" || parent.kind === "live_post") {
    const offset = constants.reminders.staffOffsetMinutes;
    out.push({
      kind: "staff_reminder",
      channel: "gdg_discord",
      dueAt: minutes(offset),
      title: `スタッフへいいね・リポストの依頼（${parent.title}）`,
      offsetMinutes: -offset,
      requiresApproval: false,
      purpose: "like_repost",
    });
  }
  if (parent.kind === "x_post" && parent.speakerId) {
    const offset = constants.reminders.speakerOffsetMinutes;
    const speaker = brief?.speakers.find((s) => s.id === parent.speakerId);
    const high = speaker?.tier === "high";
    out.push({
      kind: "speaker_request",
      dueAt: minutes(offset),
      title: `${speaker?.name ?? parent.speakerId} さんへ引用の依頼`,
      speakerId: parent.speakerId,
      sessionId: parent.sessionId ?? null,
      offsetMinutes: -offset,
      purpose: "quote",
      requiresApproval: true,
      note: high ? "提案のみ（tier: high。自動で依頼しない）" : null,
    });
  }
  return out;
}
