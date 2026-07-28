import { redirect } from "react-router";
import { chapterCookie, requireSnsAccess, safeReturnTo } from "~/lib/access.server";
import type { Route } from "./+types/api.chapter";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const chapterId = Number(form.get("chapterId"));
  if (!access.chapters.some((chapter) => chapter.chapterId === chapterId))
    throw new Response("Forbidden", { status: 403 });
  return redirect(
    safeReturnTo(
      request.headers.get("Referer")
        ? new URL(request.headers.get("Referer") as string).pathname
        : "/posts",
    ),
    { headers: { "Set-Cookie": chapterCookie(chapterId) } },
  );
}
