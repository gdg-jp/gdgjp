import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import {
  createTag,
  deleteTag,
  listTagsForChapterWithCounts,
  listTagsForUserWithCounts,
  updateTag,
} from "~/features/tags";
import { normalizeColor } from "~/features/tags/tag-colors";
import type { PageRequestArgs } from "~/http/request";

export async function requireAuthAndChapter(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);
  return { env, user, chapter };
}

export async function loader(args: PageRequestArgs) {
  const { env, user, chapter } = await requireAuthAndChapter(args);
  const [userTags, chapterTags] = await Promise.all([
    listTagsForUserWithCounts(env.DB, user.id),
    listTagsForChapterWithCounts(env.DB, chapter.chapterId),
  ]);
  return {
    user: { email: user.email, image: user.image, name: user.name },
    userTags,
    chapterTags,
    chapter,
  };
}

export type ActionData = { ok: true } | { error: string };

export async function action(args: PageRequestArgs): Promise<ActionData | null> {
  const { env, user, chapter } = await requireAuthAndChapter(args);
  const form = await args.request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return { error: "Invalid tag id." };
    await deleteTag(env.DB, id);
    return { ok: true };
  }

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const color = normalizeColor(String(form.get("color") ?? ""));
    const scope = String(form.get("scope") ?? "user");
    if (!name) return { error: "Name is required." };
    if (name.length > 32) return { error: "Name must be 32 characters or less." };

    if (scope === "chapter") {
      const result = await createTag(env.DB, {
        name,
        color,
        ownerChapterId: chapter.chapterId,
      });
      if (!result.ok) return { error: `Tag "${name}" already exists.` };
      return { ok: true };
    }
    const result = await createTag(env.DB, {
      name,
      color,
      ownerUserId: user.id,
    });
    if (!result.ok) return { error: `Tag "${name}" already exists.` };
    return { ok: true };
  }

  if (intent === "update") {
    const id = Number(form.get("id"));
    const name = String(form.get("name") ?? "").trim();
    const color = normalizeColor(String(form.get("color") ?? ""));
    if (!Number.isInteger(id) || id <= 0) return { error: "Invalid tag id." };
    if (!name) return { error: "Name is required." };
    if (name.length > 32) return { error: "Name must be 32 characters or less." };
    const result = await updateTag(env.DB, { id, name, color });
    if (!result.ok) return { error: `Tag "${name}" already exists.` };
    return { ok: true };
  }

  return { error: "Unknown action." };
}

export type TagsPageData = Awaited<ReturnType<typeof loader>>;
export type TagsPageAction = Awaited<ReturnType<typeof action>>;
