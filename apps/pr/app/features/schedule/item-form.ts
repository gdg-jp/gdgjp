import { parseConditions } from "./blocked-by";
import { fromJstLocal } from "./calendar";
import type { ItemInput, RequestStatus } from "./item";
import { ITEM_STATUSES, type ItemStatus, isScheduleKind } from "./kinds";

export const NONE = "__none__";

export type ItemFormErrors = Partial<
  Record<"kind" | "dueAt" | "title" | "status" | "followup", string>
>;

const opt = (value: FormDataEntryValue | null): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== NONE ? text : null;
};

/** The schedule item dialog's fields → ItemInput. */
export function parseItemForm(
  form: FormData,
): { ok: true; input: ItemInput } | { ok: false; errors: ItemFormErrors } {
  const errors: ItemFormErrors = {};
  const kind = form.get("kind");
  if (!isScheduleKind(kind)) errors.kind = "種類を選んでください";
  const dueAt = fromJstLocal(String(form.get("dueAt") ?? ""));
  if (dueAt === null) errors.dueAt = "日時を入れてください";
  const title = String(form.get("title") ?? "").trim();
  if (!title || title.length > 200) errors.title = "1〜200 文字で入力してください";
  const status = opt(form.get("status"));
  if (status && !(ITEM_STATUSES as readonly string[]).includes(status))
    errors.status = "状態が不正です";
  const request = opt(form.get("requestStatus"));
  const followupRaw = opt(form.get("requestFollowupAt"));
  const followup = followupRaw ? fromJstLocal(followupRaw) : null;
  if (followupRaw && followup === null) errors.followup = "日時が読めません";
  if (Object.keys(errors).length || !isScheduleKind(kind) || dueAt === null)
    return { ok: false, errors };
  return {
    ok: true,
    input: {
      kind,
      channel: opt(form.get("channel")),
      dueAt,
      title,
      note: opt(form.get("note")),
      assigneeUserId: opt(form.get("assignee")),
      reviewerUserId: opt(form.get("reviewer")),
      blockedBy: parseConditions(String(form.get("blockedBy") ?? "")),
      requestStatus: (request as RequestStatus | null) ?? null,
      requestFollowupAt: followup,
      speakerId: opt(form.get("speakerId")),
      sessionId: opt(form.get("sessionId")),
      variant: opt(form.get("variant")),
      status: (status as ItemStatus | null) ?? undefined,
    },
  };
}
