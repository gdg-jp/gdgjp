import { data, redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { isValidEmail, nowIso } from "~/lib/utils";
import type { Route } from "./+types/settings.contributors";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  if (access.chapter.role !== "organizer") throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!isValidEmail(email))
    return data({ error: "有効なメールアドレスを入力してください。" }, { status: 400 });
  if (form.get("intent") === "remove")
    await context.cloudflare.env.DB.prepare(
      "DELETE FROM sns_contributors WHERE chapter_id = ? AND user_email = ?",
    )
      .bind(access.chapter.chapterId, email)
      .run();
  else
    await context.cloudflare.env.DB.prepare(
      "INSERT INTO sns_contributors (chapter_id, user_email, granted_by_user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(chapter_id, user_email) DO NOTHING",
    )
      .bind(access.chapter.chapterId, email, access.user.id, nowIso())
      .run();
  throw redirect("/settings");
}
