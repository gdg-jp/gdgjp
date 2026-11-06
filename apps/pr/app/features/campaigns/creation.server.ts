import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import { fromJstLocal } from "~/features/schedule/calendar";
import { getCampaignBySlug, insertCampaign } from "./campaign.repository.server";
import { normalizeSlug } from "./slug";

export type CreateErrors = Partial<
  Record<"name" | "slug" | "chapter" | "eventAt" | "budget" | "parent", string>
>;

export async function createCampaignFromForm(
  env: Env,
  request: Request,
  user: AuthUser,
  chapters: UserChapter[],
): Promise<{ errors: CreateErrors } | Response> {
  const form = await request.formData();
  const errors: CreateErrors = {};
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 120) errors.name = "1〜120 文字で入力してください";
  const slug = normalizeSlug(String(form.get("slug") ?? ""));
  if (!slug) errors.slug = "英小文字・数字・ハイフンの 3〜40 文字にしてください";
  const chapterId = Number(form.get("chapterId"));
  const chapter = chapters.find((c) => c.chapterId === chapterId);
  if (!chapter) errors.chapter = "所属しているチャプターを選んでください";
  const eventRaw = String(form.get("eventAt") ?? "");
  const eventAt = eventRaw ? fromJstLocal(eventRaw) : null;
  if (eventRaw && eventAt === null) errors.eventAt = "日時が読めません";
  const budget = Number(String(form.get("budget") ?? "0").replace(/[,，]/g, "") || 0);
  if (!Number.isInteger(budget) || budget < 0) errors.budget = "0 以上の整数（円）にしてください";
  const parentSlug = normalizeSlug(String(form.get("parent") ?? ""));
  let parentId: number | null = null;
  if (String(form.get("parent") ?? "").trim()) {
    const parent = parentSlug ? await getCampaignBySlug(env.DB, parentSlug) : null;
    if (!parent) errors.parent = "本番のキャンペーンが見つかりません";
    else parentId = parent.id;
  }
  if (Object.keys(errors).length || !slug || !chapter) return { errors };
  const result = await insertCampaign(env.DB, {
    chapterId: chapter.chapterId,
    chapterSlug: chapter.chapterSlug,
    parentCampaignId: parentId,
    slug,
    name,
    eventAt,
    venue: String(form.get("venue") ?? "").trim() || null,
    budgetTotalYen: budget,
    playbookVersion: PLAYBOOK_VERSION,
    creator: { id: user.id, name: user.name, email: user.email },
  });
  if (!result.ok) return { errors: { slug: "この URL はもう使われています" } };
  return redirect(`/c/${slug}/brief`);
}
