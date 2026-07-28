import { requireSnsAccess } from "~/lib/access.server";
import { getPost } from "~/lib/db.server";
import { claimAndPublish } from "~/lib/publish.server";
import type { Route } from "./+types/api.posts";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const postId = String(form.get("postId") ?? "");
  const post = await getPost(context.cloudflare.env.DB, postId);
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  if (form.get("intent") === "publish") {
    await claimAndPublish(context.cloudflare.env, postId);
    return Response.json({ ok: true });
  }
  throw new Response("Bad request", { status: 400 });
}
