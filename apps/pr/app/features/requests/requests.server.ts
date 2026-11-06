import type { CampaignAccess } from "~/features/campaigns/access.server";
import { jstLabel } from "~/features/dispatch/content";
import { sendStaffReminder, staffReminderText } from "~/features/dispatch/reminders.server";
import { draftForItem, latestVersion } from "~/features/drafts/draft.repository.server";
import type { ScheduleItem } from "~/features/schedule/item";
import {
  getItem,
  listItems,
  setRequestStatus,
  transitionItem,
} from "~/features/schedule/item.repository.server";
import { REQUEST_KINDS } from "~/features/schedule/kinds";

export type RequestRow = {
  id: number;
  kind: "staff_reminder" | "speaker_request" | "request";
  title: string;
  at: string;
  status: string;
  text: string;
  requestStatus: string | null;
  assignee: string | null;
};

const OPEN = (i: ScheduleItem) => i.status !== "done" && i.status !== "skipped";

/** The speaker request's text: the post draft's `speakerRequest`, or what a person wrote. */
async function speakerText(env: Env, item: ScheduleItem) {
  const parent = item.derivedFromItemId ? await draftForItem(env.DB, item.derivedFromItemId) : null;
  const content = parent ? (await latestVersion(env.DB, parent.id))?.content : null;
  const request = (content as { posts?: { speakerRequest?: { text?: string } | null }[] } | null)
    ?.posts?.[0]?.speakerRequest?.text;
  return request ?? item.note ?? "";
}

/** /c/:slug/approvals: what a person sends (Discord, by hand) besides approving drafts. */
export async function requestRows(env: Env, access: CampaignAccess): Promise<RequestRow[]> {
  const names = Object.fromEntries(access.members.map((m) => [m.userId, m.name]));
  const items = (await listItems(env.DB, access.campaign.id)).filter(OPEN);
  const rows: RequestRow[] = [];
  for (const item of items) {
    const base = {
      id: item.id,
      title: item.title,
      at: jstLabel(item.dueAt),
      status: item.status,
      requestStatus: item.requestStatus,
      assignee: item.assigneeUserId ? (names[item.assigneeUserId] ?? null) : null,
    };
    if (item.kind === "staff_reminder" && item.status !== "planned")
      rows.push({
        ...base,
        kind: "staff_reminder",
        text: await staffReminderText(env, access.campaign, item),
      });
    else if (item.kind === "speaker_request")
      rows.push({ ...base, kind: "speaker_request", text: await speakerText(env, item) });
    else if (REQUEST_KINDS.includes(item.kind))
      rows.push({ ...base, kind: "request", text: item.note ?? "" });
  }
  return rows;
}

const FOLLOWUP_DAYS = 3;

export async function requestAction(
  env: Env,
  access: CampaignAccess,
  form: FormData,
): Promise<{ ok: boolean; message?: string; errors?: string[] }> {
  const item = await getItem(env.DB, access.campaign.id, Number(form.get("item")));
  if (!item) return { ok: false, errors: ["項目が見つかりません"] };
  const intent = String(form.get("intent"));
  if (intent === "send-reminder" && item.kind === "staff_reminder") {
    const result = await sendStaffReminder(env, access.campaign, item, true);
    return result === "sent"
      ? { ok: true, message: "Discord に送りました" }
      : {
          ok: false,
          errors: [
            result === "no_webhook"
              ? "Discord の webhook がありません（チャプター設定）"
              : "送れませんでした",
          ],
        };
  }
  if (intent === "mark-sent") {
    if (item.kind === "speaker_request") {
      await transitionItem(env.DB, item.id, [item.status], "done");
      return { ok: true, message: "送ったことにしました" };
    }
    const followup = Math.floor(Date.now() / 1000) + FOLLOWUP_DAYS * 86400;
    await setRequestStatus(env.DB, access.campaign.id, item.id, "sent", followup);
    return {
      ok: true,
      message: `送りました。${FOLLOWUP_DAYS} 日後に返事が無ければ再連絡を促します`,
    };
  }
  if (intent === "replied" || intent === "declined") {
    await setRequestStatus(env.DB, access.campaign.id, item.id, intent, null);
    return { ok: true, message: "返事を記録しました" };
  }
  return { ok: false, errors: ["不明な操作です"] };
}
