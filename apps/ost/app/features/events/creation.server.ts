import { requireUserWithChapter } from "~/features/auth/access.server";
import { createEvent } from "./events.server";
import { normalizeSlug } from "./slug";

export async function createEventFromForm(env: Env, request: Request) {
  const { user, chapters } = await requireUserWithChapter(env, request);
  const form = await request.formData();

  const title = String(form.get("title") ?? "").trim();
  const slug = normalizeSlug(form.get("slug"));
  const chapterId = Number.parseInt(String(form.get("chapterId") ?? ""), 10);
  const chapter = chapters.find((c) => c.chapterId === chapterId);

  if (!title) return { error: "イベント名を入力してください。" };
  if (!slug) {
    return { error: "URL には英小文字・数字・ハイフンのみ使えます（1〜40文字、予約語は不可）。" };
  }
  if (!chapter) return { error: "チャプターを選択してください。" };

  const result = await createEvent(env.DB, {
    slug,
    title,
    chapterId: chapter.chapterId,
    chapterSlug: chapter.chapterSlug,
    createdBy: user.id,
  });
  if (!result.ok) {
    return { error: `URL「${slug}」は既に使われています。` };
  }
  return { created: result.event.slug };
}
