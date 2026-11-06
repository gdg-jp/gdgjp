import type { CampaignAccess } from "~/features/campaigns/access.server";
import { deliveryAction } from "~/features/dispatch/delivery.server";
import { afterDraftApproval, prepareDraftApproval } from "~/features/dispatch/dispatch.server";
import { EnqueueError, enqueueCopy, enqueuePosts } from "~/features/jobs/enqueue.server";
import { autoFold } from "./content";
import type { Draft } from "./draft";
import { getDraft, latestVersion, updateDraftPeople } from "./draft.repository.server";
import { currentContent, editDraft, reviewDraft } from "./review.server";

export type DetailActionResult = { ok: boolean; message?: string; errors?: string[] };

const opt = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "__none__" ? s : null;
};

/** Every form on the draft page posts here, discriminated by `intent`. */
export async function draftAction(
  env: Env,
  access: CampaignAccess,
  draftId: number,
  form: FormData,
): Promise<DetailActionResult> {
  const draft = await getDraft(env.DB, access.campaign.id, draftId);
  if (!draft) throw new Response(null, { status: 404 });
  const intent = String(form.get("intent"));
  const comment = opt(form.get("comment"));
  if (
    intent === "review_ok" ||
    intent === "request_changes" ||
    intent === "approve" ||
    intent === "reject"
  ) {
    if (intent === "approve") {
      const ready = await prepareDraftApproval(env, access, draft);
      if (!ready.ok) return { ok: false, errors: ready.errors };
    }
    const result = await reviewDraft(env.DB, access, draft, intent, comment);
    if (!result.ok) return { ok: false, errors: [result.error] };
    if (intent === "approve")
      await afterDraftApproval(env, access.campaign, { ...draft, status: "approved" });
    return { ok: true, message: "更新しました" };
  }
  const delivery = await deliveryAction(env, access, draft, intent, form);
  if (delivery) return delivery;
  if (intent === "edit-text")
    return editPostText(env, access, draft, String(form.get("text") ?? ""));
  if (intent === "edit-json") {
    let content: unknown;
    try {
      content = JSON.parse(String(form.get("json") ?? ""));
    } catch {
      return { ok: false, errors: ["JSON として読めません"] };
    }
    const result = await editDraft(env.DB, access, draft, content);
    return result.ok
      ? { ok: true, message: `版 ${result.version} を保存しました` }
      : { ok: false, errors: result.errors };
  }
  if (intent === "people") {
    await updateDraftPeople(env.DB, draft.id, {
      assigneeUserId: opt(form.get("assignee")),
      reviewerUserId: opt(form.get("reviewer")),
    });
    return { ok: true, message: "担当を更新しました" };
  }
  if (intent === "regenerate") {
    const instructions = opt(form.get("instructions")) ?? undefined;
    try {
      if (draft.kind === "copy")
        await enqueueCopy(env.DB, access.campaign.id, access.user.id, {
          draftId: draft.id,
          instructions,
        });
      else if (draft.scheduleItemId)
        await enqueuePosts(
          env.DB,
          access.campaign.id,
          access.user.id,
          [draft.scheduleItemId],
          instructions,
        );
      else return { ok: false, errors: ["この下書きは作り直せません"] };
    } catch (error) {
      if (error instanceof EnqueueError) return { ok: false, errors: [error.message] };
      throw error;
    }
    return { ok: true, message: "作り直しのジョブを積みました" };
  }
  return { ok: false, errors: ["不明な操作です"] };
}

/** Edit the post body only; the fold split follows the text. */
async function editPostText(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  text: string,
): Promise<DetailActionResult> {
  const content = structuredClone(
    (await currentContent(env.DB, draft)) as { posts: Record<string, unknown>[] } | null,
  );
  if (!content?.posts?.[0]) return { ok: false, errors: ["投稿がありません"] };
  const normalized = text.replace(/\r\n/g, "\n");
  content.posts[0] = { ...content.posts[0], text: normalized, ...autoFold(normalized) };
  const result = await editDraft(env.DB, access, draft, content);
  return result.ok
    ? { ok: true, message: `版 ${result.version} を保存しました` }
    : { ok: false, errors: result.errors };
}

export { latestVersion };
