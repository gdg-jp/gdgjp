import type { CampaignMember } from "~/features/campaigns/campaign";
import type { ItemInput } from "~/features/schedule/item";
import { isScheduleKind } from "~/features/schedule/kinds";
import type { PlanBody, PlanItem } from "./plan";

/**
 * Turn a plan's schedule into item inputs: parents first, each derived item attached to its
 * parent's ref. Unknown kinds and unreadable times are reported, not silently dropped.
 */
export function planToItems(
  body: PlanBody,
  planVersion: number,
  members: CampaignMember[],
): {
  roots: { ref: string; input: ItemInput }[];
  children: { parentRef: string; input: ItemInput }[];
  problems: string[];
} {
  const problems: string[] = [];
  const assignee = (role: string | null) =>
    role ? (members.find((m) => m.roles.includes(role as never))?.userId ?? null) : null;
  const toInput = (item: PlanItem): ItemInput | null => {
    if (!isScheduleKind(item.kind)) {
      problems.push(`${item.ref}: 未知の種類 ${item.kind}`);
      return null;
    }
    const ms = Date.parse(item.dueAt);
    if (Number.isNaN(ms)) {
      problems.push(`${item.ref}: 日時が読めない ${item.dueAt}`);
      return null;
    }
    return {
      kind: item.kind,
      channel: item.channel,
      dueAt: Math.floor(ms / 1000),
      title: item.title,
      speakerId: item.speakerId,
      sessionId: item.sessionId,
      blockedBy: item.blockedBy,
      offsetMinutes: item.offsetMinutes,
      purpose: item.purpose,
      variant: item.variant,
      planVersion,
      assigneeUserId: assignee(item.assigneeRole),
      requiresApproval: item.kind !== "staff_reminder",
      note: item.suggestionOnly ? "提案のみ（tier: high。自動で依頼しない）" : null,
    };
  };
  const refs = new Set(body.scheduleItems.map((i) => i.ref));
  const roots: { ref: string; input: ItemInput }[] = [];
  const children: { parentRef: string; input: ItemInput }[] = [];
  for (const item of body.scheduleItems) {
    const input = toInput(item);
    if (!input) continue;
    if (item.derivedFrom && refs.has(item.derivedFrom))
      children.push({ parentRef: item.derivedFrom, input });
    else roots.push({ ref: item.ref, input });
  }
  return { roots, children, problems };
}
