import { redirect } from "react-router";
import { chapterCookie, requireChapterAccess, safeReturnTo } from "~/lib/access.server";
import type { Route } from "./+types/api.chapter";

export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireChapterAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const chapterId = Number(form.get("chapterId"));
  const allowed =
    access.isAdmin || access.chapters.some((chapter) => chapter.chapterId === chapterId);
  if (!allowed) {
    throw new Response("Forbidden", { status: 403 });
  }
  const referer = request.headers.get("Referer");
  const returnTo = safeReturnTo(referer ? new URL(referer).pathname : "/") ?? "/";
  return redirect(returnTo, {
    headers: { "Set-Cookie": chapterCookie(chapterId) },
  });
}
