import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { requireUserWithChapter } from "~/features/auth/access.server";
import type { OstEvent } from "./event";
import { getEventBySlug } from "./events.server";
import { normalizeSlug } from "./slug";

/**
 * Gate an event admin surface (`/:slug/screen|tables|edit`): signed in, has a
 * chapter, and is a member of the chapter that owns this event.
 */
export async function requireEventAccess(
  env: Env,
  request: Request,
  rawSlug: string | undefined,
): Promise<{ user: AuthUser; chapters: UserChapter[]; event: OstEvent }> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) throw new Response(null, { status: 404 });

  const { user, chapters } = await requireUserWithChapter(env, request);
  const event = await getEventBySlug(env.DB, slug);
  if (!event) throw new Response(null, { status: 404 });
  if (!chapters.some((c) => c.chapterId === event.chapterId)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { user, chapters, event };
}
