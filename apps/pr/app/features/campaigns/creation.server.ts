import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import { jstDate } from "~/features/schedule/calendar";
import { insertCampaign, takenSlugs } from "./campaign.repository.server";
import { slugFromName } from "./slug";

export type CreateErrors = Partial<Record<"name", string>>;

/**
 * A new event needs only a name (a working title is fine): the URL is made from it, the host is
 * the sidebar's chapter, and everything else comes from what the assistant reads afterwards.
 */
export async function createCampaignFromForm(
  env: Env,
  request: Request,
  user: AuthUser,
  chapter: UserChapter,
): Promise<{ errors: CreateErrors } | Response> {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 120) return { errors: { name: "1〜120 文字で入力してください" } };
  const date = jstDate(Math.floor(Date.now() / 1000));
  for (let attempt = 0; attempt < 3; attempt++) {
    const base = slugFromName(name, date, () => false);
    const taken = await takenSlugs(env.DB, base);
    const slug = slugFromName(name, date, (s) => taken.has(s));
    const result = await insertCampaign(env.DB, {
      chapterId: chapter.chapterId,
      chapterSlug: chapter.chapterSlug,
      parentCampaignId: null,
      slug,
      name,
      eventAt: null,
      venue: null,
      budgetTotalYen: 0,
      playbookVersion: PLAYBOOK_VERSION,
      creator: { id: user.id, name: user.name, email: user.email },
    });
    if (result.ok) return redirect(`/c/${slug}`);
  }
  return { errors: { name: "作れませんでした。もう一度お試しください" } };
}
