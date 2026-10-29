import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { requireUserWithChapter } from "~/features/auth/access.server";
import type { Project } from "./project";
import { getProject } from "./projects.server";
import { normalizeSlug } from "./slug";

/**
 * Gate the admin page (`/admin/:slug`): signed in, has a chapter, and is a
 * member of the chapter that owns this project.
 */
export async function requireProjectAccess(
  env: Env,
  request: Request,
  rawSlug: string | undefined,
): Promise<{ user: AuthUser; chapters: UserChapter[]; project: Project }> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) throw new Response(null, { status: 404 });

  const { user, chapters } = await requireUserWithChapter(env, request);
  const project = await getProject(env.DB, slug);
  if (!project) throw new Response(null, { status: 404 });
  if (!chapters.some((c) => c.chapterId === project.chapterId)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { user, chapters, project };
}
