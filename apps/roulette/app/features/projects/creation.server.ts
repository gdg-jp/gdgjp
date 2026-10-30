import { redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { createProject } from "./projects.server";
import { normalizeSlug } from "./slug";

export type CreateErrors = { name?: string; slug?: string; chapter?: string };

export const MAX_PROJECT_NAME = 80;

/** Create a project from the list page's dialog, then open its admin page. */
export async function createProjectFromForm(env: Env, request: Request) {
  const { user, chapters } = await requireUserWithChapter(env, request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const rawSlug = String(form.get("slug") ?? "").trim();
  const slug = normalizeSlug(rawSlug);
  const chapterId = Number.parseInt(String(form.get("chapterId") ?? ""), 10);
  const chapter = chapters.find((c) => c.chapterId === chapterId) ?? chapters[0];

  const errors: CreateErrors = {};
  if (!name) errors.name = "プロジェクト名を入れてください";
  else if (name.length > MAX_PROJECT_NAME)
    errors.name = `${MAX_PROJECT_NAME} 文字以内にしてください`;
  if (!rawSlug) errors.slug = "URL を入れてください";
  else if (!slug)
    errors.slug = "英小文字・数字・ハイフンで 1〜40 文字にしてください（使えない語もあります）";
  if (!chapter) errors.chapter = "チャプターを選んでください";
  if (errors.name || errors.slug || errors.chapter || !slug || !chapter) return { errors };

  const result = await createProject(env.DB, {
    slug,
    name,
    chapterId: chapter.chapterId,
    chapterSlug: chapter.chapterSlug,
    createdBy: user.id,
  });
  if (!result.ok)
    return { errors: { slug: "この URL はすでに使われています" } satisfies CreateErrors };
  throw redirect(`/admin/${slug}`);
}
